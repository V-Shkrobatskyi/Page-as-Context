// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { browser, type Browser } from 'wxt/browser';
import { readMcpContext } from './capture';
import { MCP_SETTINGS_KEY, resolveMcpSettings, saveMcpSettings, automaticMcp, mcpWritesEnabled, autoDisconnectMilliseconds, type McpSettings } from './settings';
import { assertAction, redactionMode } from '../policy/model';
import { hasMcpTransmissionConsent, mcpBrowserPermissions } from './permissions';
import { OperationLedger, WRITE_TOOLS, actionArguments } from './operations';
import { sourceAllowed } from '../policy/sources';
import type { ActionSnapshot, ActionOutcome } from '../adapters/actions/contract';
import { technicalEvent } from '../diagnostics/client';
import { redactSemanticTree } from '../core/privacy/redact';
import { MCP_STATE_CHANGED } from './ui-events';
import { getMcpTab, McpTabMetadataUnavailable } from './tab';

const INSTANCE_KEY = 'mcp-instance-v1', CLIENTS_KEY = 'mcp-clients-v1', PAUSE_KEY = 'mcp-paused-v1';
const RETRY_ALARM = 'mcp-reconnect', EXPIRY_ALARM = 'mcp-expiry';
const UNLIMITED_EXPIRY = 8640000000000000;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/u.test(value);
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(value);
interface Client { id: string; hash: string; name?: string; shared?: boolean }
function validateClients(value: unknown): Client[] {
  if (!Array.isArray(value) || value.length > 32 || value.some(client => !client || !validId(client.id) || client.shared !== undefined && typeof client.shared !== 'boolean' || typeof client.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(client.hash) || client.name !== undefined && !validName(client.name)) ||
    new Set(value.map(client => client.id)).size !== value.length) throw new Error('invalid-clients');
  return value;
}
interface Grant { id: string; clientId: string; clientHash: string; tabId: number; origin: string; expires: number; revision: string; write: boolean; sessionApproval: boolean; busy?: boolean }
interface Share { ref: string; tabId: number; origin: string; url: string; expires: number; revision: string; write: boolean; idleMs: number; hardExpires: number; loading?: boolean }
interface Source { tabId: number; url: string; expires: number }
interface NativeRequest { type: 'request'; id: string; instanceId: string; browser: string; credentialId: string; credentialSecret: string; request: { tool: string; arguments?: Record<string, unknown> } }

/** Owns browser-session sharing intent and credential-bound execution grants. */
export function createMcpController() {
  let port: Browser.runtime.Port | undefined, instance: string | undefined, transport = 'disconnected';
  const shares = new Map<number, Share>();
  const tabEpochs = new Map<number, number>();
  const pendingTabs = new Map<string, number>();
  let paused = false, halted = false, retries = 0, automatic = false, iconRevision = 0;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const sources = new Map<string, Source>(), grants = new Map<string, Grant>(), pending = new Map<string, AbortController>();
  const deniedPairing = new Map<string, { hash: string; expires: number }>();
  const pairing = new Map<string, { id: string; hash: string; code: string; expires: number; name?: string }>();
  const snapshots = new Map<string, ActionSnapshot>(), ledger = new OperationLedger();
  const busyTabs = new Set<number>();
  const pendingClients = new Map<string, string>();
  const approvals = new Map<string, { grant: Grant; action: string; target: string; expires: number; tabId?: number; answer: (allow: boolean, reason?: 'approval-timeout' | 'approval-unavailable') => void }>();
  let generation = 0;
  let clientRegistryRevision = 0;
  let pairingExpiry: ReturnType<typeof setTimeout> | undefined;
  let pairingTabId: number | undefined, openingPairingTab: Promise<void> | undefined;
  const showPairingTab = () => {
    if (openingPairingTab) return;
    const ticket = generation;
    openingPairingTab = (async () => {
      const base = browser.runtime.getURL('/mcp.html'), url = base + '#clients-heading';
      const previous = pairingTabId === undefined ? undefined : await browser.tabs.get(pairingTabId).catch(() => undefined);
      if (ticket !== generation || !pairing.size) return;
      if (previous?.id !== undefined && previous.url?.split('#')[0] === base) await browser.tabs.update(previous.id, { url, active: true });
      else { const tab = await browser.tabs.create({ url, active: true }); pairingTabId = tab.id; }
    })().catch(() => { /* Pairing remains available from the MCP settings link. */ }).finally(() => { openingPairingTab = undefined; });
  };
  const notifyUi = () => {
    // No code, credential, client identity or page metadata is broadcast.
    void updateIcons();
    try { void Promise.resolve(browser.runtime.sendMessage({ type: MCP_STATE_CHANGED })).catch(() => {}); } catch { /* No settings page is open. */ }
  };
  const schedulePairingExpiry = () => {
    clearTimeout(pairingExpiry); pairingExpiry = undefined;
    if (!pairing.size) return;
    const expires = Math.min(...[...pairing.values()].map(value => value.expires));
    pairingExpiry = setTimeout(() => {
      for (const [id, value] of pairing) if (value.expires <= Date.now()) pairing.delete(id);
      schedulePairingExpiry(); notifyUi();
    }, Math.max(1, expires - Date.now()));
  };
  const notifyTools = (clientId: string) => { try { port?.postMessage({ type: 'tools-changed', credentialId: clientId }); } catch { /* Disconnect invalidates live grants. */ } };
  const disposeSnapshot = (owner: string) => { snapshots.get(owner)?.dispose(); snapshots.delete(owner); };
  const revokeClientAccess = (clientId: string) => {
    clientRegistryRevision++;
    for (const [id, grant] of grants) if (grant.clientId === clientId) {
      grants.delete(id); disposeSnapshot(id); ledger.clearGrant(id);
    }
    for (const approval of [...approvals.values()]) if (approval.grant.clientId === clientId) approval.answer(false);
    for (const [id, client] of pendingClients) if (client === clientId) pending.get(id)?.abort();
    pairing.delete(clientId); schedulePairingExpiry(); notifyTools(clientId);
  };
  const invalidate = () => { generation++; const clients = new Set([...grants.values()].map(grant => grant.clientId)); grants.clear(); for (const client of clients) notifyTools(client); for (const controller of pending.values()) controller.abort(); pending.clear();
    for (const snapshot of snapshots.values()) snapshot.dispose(); snapshots.clear();
    for (const approval of [...approvals.values()]) approval.answer(false); ledger.clear(); };
  const stop = () => { deniedPairing.clear(); halted = true; retries = 0; void browser.alarms?.clear(RETRY_ALARM); shares.clear(); clearTimeout(expiryTimer); void browser.alarms?.clear(EXPIRY_ALARM); invalidate(); pairing.clear(); schedulePairingExpiry(); sources.clear(); const previous = port; port = undefined; transport = 'disconnected'; previous?.disconnect(); notifyUi(); };
  const identity = async () => {
    if (instance) return instance;
    const stored = await browser.storage.local.get(INSTANCE_KEY);
    if (stored[INSTANCE_KEY] === undefined) { instance = crypto.randomUUID(); await browser.storage.local.set({ [INSTANCE_KEY]: instance }); }
    else if (validId(stored[INSTANCE_KEY])) instance = stored[INSTANCE_KEY];
    else throw new Error('invalid-instance');
    return instance!;
  };
  const clients = async (): Promise<Client[]> => {
    const stored = await browser.storage.local.get(CLIENTS_KEY);
    return validateClients(stored[CLIENTS_KEY] ?? []);
  };
  const dropGrant = (grant: Grant) => {
    grants.delete(grant.id); disposeSnapshot(grant.id); ledger.clearGrant(grant.id);
    for (const approval of [...approvals.values()]) if (approval.grant === grant) approval.answer(false);
    for (const [id, tabId] of pendingTabs) if (tabId === grant.tabId && pendingClients.get(id) === grant.clientId) pending.get(id)?.abort();
    notifyTools(grant.clientId);
  };
  const expire = () => {
    for (const [tabId, share] of shares) if (share.expires <= Date.now()) shares.delete(tabId);
    for (const grant of [...grants.values()]) if (grant.expires <= Date.now()) dropGrant(grant);
    scheduleExpiry(); notifyUi();
  };
  const scheduleExpiry = () => {
    clearTimeout(expiryTimer); void browser.alarms?.clear(EXPIRY_ALARM);
    const deadlines = [...shares.values(), ...grants.values()].map(value => value.expires).filter(expires => expires < UNLIMITED_EXPIRY);
    if (!deadlines.length) return;
    const when = Math.max(Date.now() + 1, Math.min(...deadlines));
    expiryTimer = setTimeout(expire, Math.min(2147483647, when - Date.now()));
    void browser.alarms?.create(EXPIRY_ALARM, { when });
  };
  const updateIcons = async () => {
    if (!browser.action?.setIcon) return;
    const revision = ++iconRevision;
    try {
      const tabs = await browser.tabs.query({});
      if (revision !== iconRevision) return;
      for (const tab of tabs) {
        if (revision !== iconRevision) return;
        if (tab.id === undefined) continue;
        const live = !paused && !halted && transport === 'ready';
        const candidates = [...grants.values()].filter(grant => grant.tabId === tab.id && grant.expires > Date.now());
        const share = shares.get(tab.id);
        const selected = !paused && !halted && share && share.expires > Date.now() ? share.write ? 'write' : 'read' : undefined;
        const mode = selected ?? (live && candidates.length ? candidates.some(grant => grant.write) ? 'write' : 'read' : 'off');
        const detail = paused ? 'Paused' : halted ? 'Off' : transport !== 'ready' && shares.has(tab.id) ? 'Reconnecting' : mode === 'write' ? 'Write (read and actions)' : mode === 'read' ? 'Read' : 'Off';
        await Promise.all([browser.action.setIcon({ tabId: tab.id, path: { 16: '/icon/16.png', 32: '/icon/32.png' } }),
          browser.action.setBadgeBackgroundColor({ tabId: tab.id, color: mode === 'write' ? '#E60000' : '#FFFF00' }),
          browser.action.setBadgeText({ tabId: tab.id, text: mode === 'write' ? 'W' : mode === 'read' ? 'R' : '' }),
          browser.action.setBadgeTextColor?.({ tabId: tab.id, color: mode === 'write' ? '#FFFFFF' : '#000000' }),
          browser.action.setTitle({ tabId: tab.id, title: `Page as Context — AI: ${detail}` })]);
      }
    } catch { /* A closing tab must not prevent revocation or background startup. */ }
  };
  const syncShares = async () => {
    const ticket = generation, registry = clientRegistryRevision;
    const effective = await resolveMcpSettings(), known = await clients();
    if (ticket !== generation || registry !== clientRegistryRevision || paused || halted || transport !== 'ready' || !automaticMcp(effective.settings) || !effective.settings.enabled || !effective.modeAllowed || !await hasMcpTransmissionConsent(!automaticMcp(effective.settings) && effective.settings.mode === 'read-write')) return;
    const writeConsent = await hasMcpTransmissionConsent(true);
    let changed = false;
    for (const [tabId, share] of shares) {
      const ref = share.ref;
      let tab: Awaited<ReturnType<typeof getMcpTab>> | undefined;
      try { tab = await getMcpTab(tabId); }
      catch (error) {
        if (error instanceof McpTabMetadataUnavailable) {
          if (ticket === generation && registry === clientRegistryRevision && shares.get(tabId) === share && share.ref === ref) clearTab(tabId);
          continue;
        }
      }
      if (ticket !== generation || registry !== clientRegistryRevision) return;
      if (shares.get(tabId) !== share || share.ref !== ref || share.loading) continue;
      if (!tab?.url || !/^https?:\/\//u.test(tab.url) || tab.incognito || tab.discarded || share.expires <= Date.now() || share.revision !== effective.revision || !sourceAllowed(tab.url, effective.controls.sources)) {
        changed = true; shares.delete(tabId); for (const grant of [...grants.values()]) if (grant.tabId === tabId) dropGrant(grant); continue;
      }
      if (tab.url !== share.url || tab.status === 'loading') {
        // Browser tab state may arrive before onUpdated's URL notification.
        // Keep sharing intent, but invalidate all work tied to the old document.
        share.url = tab.url; share.origin = new URL(tab.url).origin;
        share.ref = crypto.randomUUID(); share.loading = tab.status === 'loading';
        clearTab(tabId); changed = true;
        if (share.loading) continue;
      }
      for (const client of known.filter(client => !effective.snapshot.policy.McpAllowedClientIds || effective.snapshot.policy.McpAllowedClientIds.includes(client.id))) {
        if ([...grants.values()].some(grant => grant.clientId === client.id && grant.tabId === tabId)) continue;
        const write = share.write && writeConsent && mcpWritesEnabled(effective.settings) && (effective.snapshot.policy.McpAllowedModes ?? ['read-only', 'read-write']).includes('read-write');
        changed = true; const id = crypto.randomUUID();
        grants.set(id, { id, clientId: client.id, clientHash: client.hash, tabId, origin: share.origin, expires: share.expires, revision: effective.revision, write,
          sessionApproval: false });
        notifyTools(client.id);
      }
    }
    if (changed) { scheduleExpiry(); notifyUi(); }
  };
  const recover = async () => {
    const ticket = generation;
    const stored = await browser.storage.local.get(PAUSE_KEY);
    if (ticket !== generation) return;
    paused = stored[PAUSE_KEY] !== undefined && stored[PAUSE_KEY] !== false;
    const effective = await resolveMcpSettings();
    if (ticket !== generation) return;
    automatic = automaticMcp(effective.settings); notifyUi();
    if (!automatic || !effective.settings.enabled || halted || port) return;
    try { await start(); } catch { transport = 'permission-required'; notifyUi(); }
  };
  const scheduleReconnect = () => {
    if (!automatic || halted || retries >= 5) return;
    const delay = [1000, 3000, 10000, 30000, 60000][retries++]!;
    transport = retries === 1 ? 'setup-required' : 'reconnecting';
    void browser.alarms?.create(RETRY_ALARM, { when: Date.now() + delay });
  };
  const nativeResult = (target: Browser.runtime.Port, id: string, value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.length > 4 * 1024 * 1024) throw new Error('response-limit');
    const total = Math.ceil(bytes.length / 65536);
    for (let index = 0; index < total; index++) {
      const chunk = bytes.subarray(index * 65536, (index + 1) * 65536);
      let binary = ''; for (const byte of chunk) binary += String.fromCharCode(byte);
      target.postMessage({ type: 'result-chunk', id, index, total, data: btoa(binary) });
    }
  };
  const authorizeClient = async (request: NativeRequest) => {
    const effective = await resolveMcpSettings(); assertAction(effective.snapshot.policy, 'mcp-read');
    if (paused || halted || transport !== 'ready' || !effective.settings.enabled || !effective.modeAllowed || !await hasMcpTransmissionConsent(!automaticMcp(effective.settings) && effective.settings.mode === 'read-write') || request.instanceId !== await identity() || request.browser !== import.meta.env.BROWSER ||
      effective.snapshot.policy.McpAllowedClientIds && !effective.snapshot.policy.McpAllowedClientIds.includes(request.credentialId)) throw new Error('not-connected');
    const client = (await clients()).find(client => client.id === request.credentialId);
    if (!client || client.hash !== await digest(request.credentialSecret)) throw new Error('not-connected');
    return { ...effective, clientHash: client.hash, client };
  };
  const requestApproval = (grant: Grant, action: string, target: string, signal: AbortSignal, windowId?: number): Promise<'allowed' | 'approval-denied' | 'approval-timeout' | 'approval-unavailable'> => new Promise(resolve => {
    const id = crypto.randomUUID();
    const answer = (allow: boolean, reason: 'approval-denied' | 'approval-timeout' | 'approval-unavailable' = 'approval-denied') => {
      if (!approvals.has(id)) return;
      const approval = approvals.get(id)!; approvals.delete(id); clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (approval.tabId !== undefined) void browser.tabs.remove(approval.tabId).catch(() => {});
      resolve(allow ? 'allowed' : reason);
    };
    const abort = () => answer(false), timer = setTimeout(() => answer(false, 'approval-timeout'), 45000);
    const approval = { grant, action, target, expires: Date.now() + 45000, answer, tabId: undefined as number | undefined };
    approvals.set(id, approval); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { answer(false); return; }
    void browser.tabs.create({ url: browser.runtime.getURL('/mcp-approval.html') + '#' + id, active: true, ...(windowId === undefined ? {} : { windowId }) }).then(tab => {
      if (!approvals.has(id)) { if (tab.id !== undefined) void browser.tabs.remove(tab.id).catch(() => {}); return; }
      approval.tabId = tab.id;
      if (tab.windowId !== undefined) void browser.windows?.update(tab.windowId, { focused: true }).catch(() => {});
    }, () => answer(false, 'approval-unavailable'));
  });
  const execute = async (request: NativeRequest, controller: AbortController, ticket: number) => {
    const args = request.request.arguments ?? {};
    if (request.request.tool === 'pair') {
      const effective = await resolveMcpSettings(); assertAction(effective.snapshot.policy, 'mcp-read');
      if (!effective.settings.enabled || request.instanceId !== await identity() || request.browser !== import.meta.env.BROWSER ||
        effective.snapshot.policy.UserPreferencesSaveAllowed === false || effective.snapshot.policy.McpSettingsLocked ||
        effective.snapshot.policy.McpAllowedClientIds && !effective.snapshot.policy.McpAllowedClientIds.includes(request.credentialId) ||
        Object.keys(args).some(key => key !== 'name') || args.name !== undefined && !validName(args.name)) throw new Error('policy-blocked');
      const hash = await digest(request.credentialSecret);
      for (const [id, denied] of deniedPairing) if (denied.expires <= Date.now()) deniedPairing.delete(id);
      if (deniedPairing.get(request.credentialId)?.hash === hash) return { status: 'rejected' };
      if ((await clients()).some(client => client.id === request.credentialId && client.hash === hash)) return { status: 'approved' };
      for (const [id, value] of pairing) if (value.expires < Date.now()) pairing.delete(id);
      let value = pairing.get(request.credentialId);
      if (value && value.hash !== hash || !value && pairing.size >= 8) throw new Error('pairing-limit');
      if (!value) {
        const bytes = crypto.getRandomValues(new Uint8Array(4));
        value = { id: request.credentialId, hash, code: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase(), expires: Date.now() + 120000,
          ...(typeof args.name === 'string' ? { name: args.name } : {}) };
        pairing.set(request.credentialId, value);
        schedulePairingExpiry(); notifyUi();
        if (automaticMcp(effective.settings)) showPairingTab();
      }
      return { status: 'pending', code: value.code };
    }
    const effective = await authorizeClient(request);
    const allowedWrites = Object.entries(WRITE_TOOLS).filter(([, action]) => (effective.snapshot.policy.McpAllowedActions ?? ['click', 'fill', 'select-option', 'set-checked']).includes(action)).map(([tool]) => tool);
    const writeAllowed = mcpWritesEnabled(effective.settings) && (effective.snapshot.policy.McpAllowedModes ?? ['read-only', 'read-write']).includes('read-write');
    if (request.request.tool === 'list-tools') return { tools: ['list_shared_tabs', 'resolve_shared_tab', 'get_connection_status', 'read_page_context',
      ...(writeAllowed && [...grants.values()].some(grant => grant.clientId === request.credentialId && grant.write && grant.expires > Date.now() && grant.revision === effective.revision) ? allowedWrites : [])] };
    if (request.request.tool === 'list_shared_tabs' || request.request.tool === 'resolve_shared_tab') {
      if (Object.keys(args).some(key => !['selector', 'tabRef'].includes(key)) || request.request.tool === 'list_shared_tabs' && Object.keys(args).length ||
        args.selector !== undefined && !['last-focused', 'active-per-window', 'only'].includes(String(args.selector)) || args.tabRef !== undefined && !validId(args.tabRef) || args.selector !== undefined && args.tabRef !== undefined) throw new Error('invalid-request');
      await syncShares();
      const focused = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      const tabs = [];
      const windowRefs = new Map<number, string>();
      for (const grant of grants.values()) {
        if (grant.clientId !== request.credentialId || grant.clientHash !== effective.clientHash || grant.expires <= Date.now() || grant.revision !== effective.revision) continue;
        const tab = await getMcpTab(grant.tabId).catch(() => undefined);
        if (!tab?.url || tab.incognito || tab.discarded || !sourceAllowed(tab.url, effective.controls.sources) || new URL(tab.url).origin !== grant.origin) continue;
        if (!windowRefs.has(tab.windowId)) windowRefs.set(tab.windowId, crypto.randomUUID());
        tabs.push({ tabRef: shares.get(grant.tabId)?.ref ?? grant.id, windowRef: windowRefs.get(tab.windowId), connectionId: grant.id,
          mode: grant.write ? 'read-write' : 'read-only', expiresAt: grant.expires === UNLIMITED_EXPIRY ? null : grant.expires, activeInWindow: tab.active,
          lastFocusedWindow: tab.windowId === focused[0]?.windowId, lastFocusedTab: tab.id === focused[0]?.id,
          ...(effective.data.includeTitle ? { title: effective.preferences.redactSensitiveData ? redactSemanticTree({ schemaVersion: 1, title: tab.title?.slice(0, 300) || 'Untitled tab', root: { role: 'page', children: [] } }, effective.filters).tree.title : tab.title?.slice(0, 300) || 'Untitled tab' } : {}) });
      }
      const current = await authorizeClient(request);
      if (controller.signal.aborted || ticket !== generation || current.revision !== effective.revision || tabs.some(tab => !grants.has(tab.connectionId))) throw new Error('not-connected');
      if (request.request.tool === 'list_shared_tabs') return { tabs };
      const selected = args.tabRef ? tabs.filter(tab => tab.tabRef === args.tabRef) : args.selector === 'last-focused' ? tabs.filter(tab => tab.lastFocusedTab) : args.selector === 'active-per-window' ? tabs.filter(tab => tab.activeInWindow) : tabs;
      if (!selected.length) return { error: 'tab-not-shared', instructions: 'Choose Read or Write in the extension popup on the requested tab.' };
      if (args.selector !== 'active-per-window' && selected.length > 1) return { error: 'ambiguous-tab', tabs: selected };
      return { tabs: selected };
    }
    const isWrite = Object.hasOwn(WRITE_TOOLS, request.request.tool);
    const action = isWrite ? actionArguments(request.request.tool, args) : undefined;
    if (!validId(args.connectionId) || !isWrite && Object.keys(args).some(key => key !== 'connectionId')) throw new Error('invalid-request');
    const grant = grants.get(args.connectionId);
    const authorize = () => {
      if (ticket !== generation || controller.signal.aborted || !port || !grant || grants.get(grant.id) !== grant || grant.clientId !== request.credentialId || grant.clientHash !== effective.clientHash ||
        grant.expires <= Date.now() || grant.revision !== effective.revision) throw new Error('not-connected');
    };
    authorize();
    const refreshActivity = () => {
      const now = Date.now(), share = grant && shares.get(grant.tabId);
      if (!automaticMcp(effective.settings) || paused || halted || ticket !== generation || controller.signal.aborted || !grant || grants.get(grant.id) !== grant ||
        grant.expires <= now || !share || share.expires <= now || share.revision !== grant.revision) return;
      share.expires = Math.min(now + share.idleMs, share.hardExpires);
      for (const peer of grants.values()) if (peer.tabId === grant.tabId && peer.revision === share.revision && peer.expires > now) peer.expires = share.expires;
      scheduleExpiry(); notifyUi();
    };
    pendingTabs.set(request.id, grant!.tabId);
    const tab = await getMcpTab(grant!.tabId);
    if (!tab.url || new URL(tab.url).origin !== grant!.origin || tab.incognito || tab.discarded || !sourceAllowed(tab.url, effective.controls.sources)) throw new Error('not-connected');
    const mode = grant!.write && writeAllowed ? 'read-write' : 'read-only';
    const capabilities = ['read_page_context', ...(mode === 'read-write' ? allowedWrites : [])];
    if (request.request.tool === 'get_connection_status') return { connectionId: grant!.id, mode, capabilities, expiresAt: grant!.expires === UNLIMITED_EXPIRY ? null : grant!.expires, busy: !!grant!.busy,
      inputMechanism: import.meta.env.BROWSER === 'firefox' ? 'programmatic-dom-events' : 'cdp-pointer-and-native-dom-setters',
      frameActions: 'accessible-same-origin; transformed or cross-origin frame targets unsupported', customAriaWidgets: false };
    const capture = async () => {
      disposeSnapshot(grant!.id);
      const result = await readMcpContext(grant!.tabId, authorize, false, controller.signal, undefined, { owner: grant!.id, write: mode === 'read-write', expires: grant!.expires,
        retain: snapshot => snapshots.set(grant!.id, snapshot) });
      authorize(); return { ...result, connectionId: grant!.id };
    };
    if (action) {
      if (mode !== 'read-write' || !allowedWrites.includes(request.request.tool)) throw new Error('read-only');
      assertAction(effective.snapshot.policy, 'mcp-write');
      return ledger.execute(grant!.id, action, async () => {
        const receipt = (outcome: ActionOutcome) => ({ operationId: action.operationId, ...outcome });
        if (grant!.busy || busyTabs.has(grant!.tabId)) return receipt({ status: 'rejected', error: 'connection-busy' });
        grant!.busy = true; busyTabs.add(grant!.tabId);
        const snapshot = snapshots.get(grant!.id);
        try {
          if (!snapshot || snapshot.snapshotId !== action.snapshotId || snapshot.expires <= Date.now() || !snapshot.targets.has(action.elementRef)) return receipt({ status: 'rejected', error: 'stale-snapshot' });
          const validate = async () => {
            authorize(); const current = await authorizeClient(request); assertAction(current.snapshot.policy, 'mcp-write');
            const target = await getMcpTab(grant!.tabId);
            if (current.revision !== grant!.revision || !mcpWritesEnabled(current.settings) || !target.url || target.incognito || target.discarded ||
              new URL(target.url).origin !== grant!.origin || !sourceAllowed(target.url, current.controls.sources)) throw new Error('policy-blocked');
            authorize();
          };
          await validate();
          if (!grant!.sessionApproval || !effective.sessionApprovalAllowed) {
            const target = snapshot.targets.get(action.elementRef)!;
            const approval = await requestApproval(grant!, action.action, `${target.role}${target.name ? ': ' + target.name.slice(0, 1000) : ''}`, controller.signal, tab.windowId);
            if (approval !== 'allowed') return receipt({ status: 'rejected', error: approval });
          }
          await validate();
          const outcome = await snapshot.run(action, controller.signal, validate);
          for (const peer of grants.values()) if (peer.tabId === grant!.tabId) disposeSnapshot(peer.id);
          technicalEvent({ code: 'mcp-write', result: outcome.status === 'applied' ? 'success' : 'error', reason: outcome.status === 'applied' ? 'none' : 'failed' });
          if (outcome.status !== 'applied') return receipt(outcome);
          refreshActivity();
          try { const result = await capture(); return { ...receipt(outcome), snapshotId: result.snapshotId, snapshot: result }; }
          catch { return { ...receipt(outcome), snapshotUnavailable: 'post-action-capture-unavailable' }; }
        } catch { return receipt({ status: 'rejected', error: controller.signal.aborted ? 'approval-denied' : 'policy-blocked' }); }
        finally { if (snapshots.get(grant!.id) === snapshot) disposeSnapshot(grant!.id); grant!.busy = false; busyTabs.delete(grant!.tabId); }
      });
    }
    if (request.request.tool !== 'read_page_context') throw new Error('read-only');
    if (grant!.busy || busyTabs.has(grant!.tabId)) throw new Error('connection-busy');
    grant!.busy = true; busyTabs.add(grant!.tabId);
    try { const result = await capture(); refreshActivity(); technicalEvent({ code: 'mcp-read', result: 'success' }); return result; }
    finally { grant!.busy = false; busyTabs.delete(grant!.tabId); }
  };
  const start = async (ticket = generation) => {
    if (port || ticket !== generation) return;
    const effective = await resolveMcpSettings(); assertAction(effective.snapshot.policy, 'mcp-read');
    if (!effective.settings.enabled || !effective.modeAllowed || !await hasMcpTransmissionConsent(!automaticMcp(effective.settings) && effective.settings.mode === 'read-write') || !(await browser.permissions.contains({ permissions: mcpBrowserPermissions() }))) throw new Error('permission-required');
    if ((await browser.runtime.getPlatformInfo()).os === 'android') throw new Error('unsupported-platform');
    const instanceId = await identity();
    // Stop, permission removal or a newer settings change cancels a pending start.
    if (port || ticket !== generation) return;
    automatic = automaticMcp(effective.settings);
    const current = browser.runtime.connectNative('org.page_as_context.bridge'); port = current; transport = 'connecting';
    notifyUi();
    const connectionLost = () => { void browser.runtime.lastError; if (port === current) { port = undefined; transport = 'disconnected'; for (const share of shares.values()) share.write = false; invalidate(); pairing.clear(); schedulePairingExpiry(); scheduleReconnect(); notifyUi(); } };
    current.onDisconnect.addListener(connectionLost);
    const readiness = setTimeout(() => { if (port === current && transport !== 'ready') { current.disconnect(); connectionLost(); } }, 5000);
    current.onMessage.addListener((raw: unknown) => {
      if (port !== current || !raw || typeof raw !== 'object') return;
      const value = raw as NativeRequest & { protocol?: unknown };
      if (value.type as string === 'ready' && value.protocol === 1) { clearTimeout(readiness); transport = 'ready'; retries = 0; void browser.alarms?.clear(RETRY_ALARM); void syncShares().catch(() => notifyUi()); notifyUi(); return; }
      if (value.type as string === 'cancel') { pending.get(value.id)?.abort(); return; }
      if (value.type as string === 'client-disconnected') {
        void authorizeClient(value).then(() => {
          for (const share of shares.values()) share.write = false;
          for (const [id, grant] of grants) if (grant.clientId === value.credentialId) {
            grants.delete(id); disposeSnapshot(id);
            for (const approval of [...approvals.values()]) if (approval.grant === grant) approval.answer(false);
          }
          for (const [id, client] of pendingClients) if (client === value.credentialId) pending.get(id)?.abort();
          notifyUi();
        }, () => {});
        return;
      }
      if (value.type !== 'request' || !validId(value.id) || !validId(value.credentialId) || typeof value.credentialSecret !== 'string' || value.credentialSecret.length !== 43 ||
        !value.request || typeof value.request.tool !== 'string' || !value.request.arguments || typeof value.request.arguments !== 'object' || Array.isArray(value.request.arguments) ||
        new TextEncoder().encode(JSON.stringify(value)).length > 65536 || pending.size >= 16 || pending.has(value.id)) { stop(); return; }
      const controller = new AbortController(), ticket = generation; pending.set(value.id, controller); pendingClients.set(value.id, value.credentialId);
      const timeout = setTimeout(() => controller.abort(), Object.hasOwn(WRITE_TOOLS, value.request.tool) ? 85000 : 14000);
      void execute(value, controller, ticket).then(result => {
        if (port === current && ticket === generation && !controller.signal.aborted) nativeResult(current, value.id, result);
      }, (error: unknown) => {
        const allowed = ['read-only', 'invalid-request', 'operation-id-reused', 'operation-limit', 'connection-busy', 'unsupported-combination', 'response-limit', 'tab-not-shared', 'ambiguous-tab'];
        if (port === current && ticket === generation && !controller.signal.aborted) nativeResult(current, value.id, { error: error instanceof Error && allowed.includes(error.message) ? error.message : 'request-rejected' });
      }).catch(() => stop()).finally(() => { clearTimeout(timeout); pending.delete(value.id); pendingClients.delete(value.id); pendingTabs.delete(value.id); });
    });
    current.postMessage({ type: 'register', protocol: 1, browser: import.meta.env.BROWSER, instanceId });
  };
  const clearTab = (tabId: number, removed = false) => {
    tabEpochs.set(tabId, (tabEpochs.get(tabId) ?? 0) + 1);
    for (const approval of [...approvals.values()]) if (removed && approval.tabId === tabId || approval.grant.tabId === tabId) approval.answer(false);
    for (const [id, source] of sources) if (source.tabId === tabId) { sources.delete(id); disposeSnapshot('preview-' + id); }
    for (const grant of [...grants.values()]) if (grant.tabId === tabId) dropGrant(grant);
    for (const [id, target] of pendingTabs) if (target === tabId) pending.get(id)?.abort();
    notifyUi();
  };
  browser.tabs.onRemoved?.addListener(tabId => { shares.delete(tabId); clearTab(tabId, true); tabEpochs.delete(tabId); scheduleExpiry(); });
  browser.tabs.onUpdated?.addListener((tabId, change) => {
    if (change.url) for (const [id, approval] of approvals) if (approval.tabId === tabId && change.url !== browser.runtime.getURL('/mcp-approval.html') + '#' + id) approval.answer(false);
    if (change.url || change.status === 'loading' || change.discarded) {
      const share = shares.get(tabId);
      if (share) {
        if (change.discarded || change.url && !/^https?:\/\//u.test(change.url)) shares.delete(tabId);
        else {
          // Keep the tab's selected mode and deadline, but never reuse document grants.
          share.ref = crypto.randomUUID();
          if (change.status === 'loading') share.loading = true;
          if (change.url) { share.url = change.url; share.origin = new URL(change.url).origin; }
        }
      }
      clearTab(tabId);
    }
    if (change.status === 'complete') { const share = shares.get(tabId); if (share) share.loading = false; }
    if (change.status === 'complete' || change.url && !shares.get(tabId)?.loading) void syncShares().catch(() => notifyUi());
  });
  browser.tabs.onActivated?.addListener(() => { void updateIcons(); });
  browser.alarms?.onAlarm.addListener(alarm => {
    if (alarm.name === RETRY_ALARM) void recover().catch(() => notifyUi());
    if (alarm.name === EXPIRY_ALARM) expire();
  });
  browser.permissions?.onRemoved?.addListener(() => stop());
  browser.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes[CLIENTS_KEY]) {
      clientRegistryRevision++;
      try {
        const previous = validateClients(changes[CLIENTS_KEY].oldValue ?? []);
        const next = validateClients(changes[CLIENTS_KEY].newValue ?? []);
        for (const client of previous) {
          const current = next.find(value => value.id === client.id);
          if (!current || current.hash !== client.hash || current.name !== client.name || current.shared !== client.shared) revokeClientAccess(client.id);
        }
      } catch { stop(); }
      void syncShares().catch(() => notifyUi());
    }
    if (area === 'managed' || area === 'local' && ['data-controls-v1', 'capture-sources-v1', 'popup-settings', 'redaction-filters-v1', MCP_SETTINGS_KEY].some(key => key in changes)) {
      const reconnect = area === 'local' && !!changes[MCP_SETTINGS_KEY] && !!port;
      shares.clear(); invalidate();
      if (area === 'managed' || changes[MCP_SETTINGS_KEY]) {
        const previous = port; port = undefined; transport = 'disconnected'; previous?.disconnect(); notifyUi();
        // One attempt only, with existing permissions. Never restore grants or replay actions.
        halted = false; retries = 0;
        if (reconnect) void start(generation).catch(() => notifyUi());
        else void recover().catch(() => notifyUi());
      }
    }
  });

  const ui = async (raw: Record<string, unknown>, sender: Browser.runtime.MessageSender) => {
    // An extension-owned popup page may also be opened as a tab. Content-script
    // senders must never qualify merely by claiming an extension page URL.
    const popup = sender.url === browser.runtime.getURL('/popup.html') && (!sender.tab || sender.tab.url === sender.url);
    const settingsPage = sender.url?.split('#')[0] === browser.runtime.getURL('/mcp.html');
    const approvalPage = sender.url?.split('#')[0] === browser.runtime.getURL('/mcp-approval.html');
    if (sender.id !== browser.runtime.id || !popup && !settingsPage && !approvalPage) throw new Error('invalid-sender');
    if (approvalPage) {
      const id = sender.url!.split('#')[1], approval = id ? approvals.get(id) : undefined;
      if (!approval || approval.expires <= Date.now() || sender.tab?.id !== approval.tabId) throw new Error('approval-expired');
      const current = await resolveMcpSettings(); assertAction(current.snapshot.policy, 'mcp-write');
      if (approvals.get(id!) !== approval || approval.expires <= Date.now() || approval.grant.expires <= Date.now() || current.revision !== approval.grant.revision || grants.get(approval.grant.id) !== approval.grant) { approval.answer(false); throw new Error('approval-expired'); }
      if (raw.action === 'approval-read') return { ok: true, action: approval.action, target: approval.target, expires: approval.expires,
        sessionApprovalAllowed: current.sessionApprovalAllowed && approval.grant.write };
      if (raw.action === 'approval-answer' && typeof raw.allow === 'boolean') {
        if (raw.scope !== undefined && (raw.scope !== 'connection' || !raw.allow)) throw new Error('invalid-request');
        if (raw.scope === 'connection') {
          if (!current.sessionApprovalAllowed || !approval.grant.write) { approval.answer(false); throw new Error('policy-blocked'); }
          approval.grant.sessionApproval = true;
        }
        approval.answer(raw.allow); if (raw.scope === 'connection') notifyUi(); return { ok: true };
      }
      throw new Error('invalid-request');
    }
    if (raw.action === 'stop') { stop(); return { ok: true }; }
    if (raw.action === 'pause' || raw.action === 'resume') {
      paused = raw.action === 'pause';
      for (const share of shares.values()) share.write = false;
      invalidate(); await browser.storage.local.set({ [PAUSE_KEY]: paused });
      if (!paused) { halted = false; await recover(); await syncShares(); }
      notifyUi(); return { ok: true };
    }
    if (raw.action === 'revoke' && settingsPage && validId(raw.clientId)) {
      await browser.storage.local.set({ [CLIENTS_KEY]: (await clients()).filter(client => client.id !== raw.clientId) });
      revokeClientAccess(raw.clientId); notifyUi(); return { ok: true };
    }
    const effective = await resolveMcpSettings();
    assertAction(effective.snapshot.policy, 'mcp-read');
    if (raw.action === 'settings' && popup) {
      const source = validId(raw.sourceId) ? sources.get(raw.sourceId) : undefined;
      const fragment = source && source.expires > Date.now() ? '#' + raw.sourceId : '';
      await browser.tabs.create({ url: browser.runtime.getURL('/mcp.html') + fragment }); return { ok: true };
    }
    if (raw.action === 'popup-read' && popup) {
      const tab = (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      const live = !paused && !halted && transport === 'ready';
      const current = [...grants.values()].filter(grant => grant.tabId === tab?.id && grant.expires > Date.now());
      const share = tab?.id === undefined ? undefined : shares.get(tab.id);
      const selected = automaticMcp(effective.settings) && !paused && !halted && share && share.expires > Date.now() ? share.write ? 'write' : 'read' : undefined;
      let sourceId: string | undefined;
      if (tab?.id !== undefined && tab.url && /^https?:\/\//u.test(tab.url) && !tab.incognito) {
        sourceId = [...sources].find(([, source]) => source.tabId === tab.id && source.url === tab.url && source.expires > Date.now())?.[0];
        if (!sourceId) { if (sources.size >= 16) { for (const [id, source] of sources) if (source.expires <= Date.now()) { sources.delete(id); disposeSnapshot('preview-' + id); } }
          if (sources.size < 16) { sourceId = crypto.randomUUID(); sources.set(sourceId, { tabId: tab.id, url: tab.url, expires: Date.now() + 30 * 60000 }); } }
      }
      return { ok: true, sourceId, automatic: automaticMcp(effective.settings), enabled: effective.settings.enabled, transport, paused,
        locked: effective.snapshot.policy.McpSettingsLocked === true || effective.snapshot.policy.UserPreferencesSaveAllowed === false,
        mode: selected ?? (live && current.length ? current.some(grant => grant.write) ? 'write' : 'read' : 'off'),
        writeAllowed: mcpWritesEnabled(effective.settings) && (effective.snapshot.policy.McpAllowedModes ?? ['read-only', 'read-write']).includes('read-write'),
        validTab: !!tab?.url && /^https?:\/\//u.test(tab.url) && !tab.incognito && !tab.discarded && sourceAllowed(tab.url, effective.controls.sources),
        pending: [...pairing.values()].filter(value => value.expires > Date.now()).map(({ id, code, name }) => ({ id, code, name })),
        shares: [...shares.values()].filter(share => share.expires > Date.now()).map(share => ({ tabRef: share.ref, mode: share.write ? 'write' : 'read' })),
        clients: (await clients()).filter(client => automaticMcp(effective.settings) || client.shared).map(client => ({ id: client.id, name: client.name })) };
    }
    if (raw.action === 'share' && popup) {
      if (!automaticMcp(effective.settings) || !['off', 'read', 'write'].includes(String(raw.mode))) throw new Error('invalid-request');
      const ticket = generation, registry = clientRegistryRevision;
      const source = validId(raw.sourceId) ? sources.get(raw.sourceId) : undefined;
      if (!source || source.expires <= Date.now()) throw new Error('source-required');
      const epoch = tabEpochs.get(source.tabId) ?? 0;
      const tab = await getMcpTab(source.tabId);
      if (tab?.id === undefined || tab.url !== source.url) throw new Error('invalid-source');
      if (raw.mode === 'off') { shares.delete(tab.id); clearTab(tab.id); scheduleExpiry(); return { ok: true }; }
      if (paused || !effective.settings.enabled || !effective.modeAllowed || !tab.url || !/^https?:\/\//u.test(tab.url) || tab.incognito || tab.discarded || !sourceAllowed(tab.url, effective.controls.sources)) throw new Error('invalid-source');
      const write = raw.mode === 'write';
      if (write) { assertAction(effective.snapshot.policy, 'mcp-write'); if (!mcpWritesEnabled(effective.settings) || !(effective.snapshot.policy.McpAllowedModes ?? ['read-only', 'read-write']).includes('read-write')) throw new Error('read-only'); }
      if (!await hasMcpTransmissionConsent(write)) throw new Error('permission-required');
      halted = false;
      if (write) await start();
      const currentTab = await getMcpTab(tab.id);
      const currentSettings = await resolveMcpSettings();
      if (ticket !== generation || epoch !== (tabEpochs.get(tab.id) ?? 0) || registry !== clientRegistryRevision || paused || currentTab.url !== tab.url || currentTab.discarded || currentTab.incognito || effective.revision !== currentSettings.revision) throw new Error('page-changed');
      if (write && transport !== 'ready') throw new Error('not-connected');
      if (!shares.has(tab.id) && shares.size >= 64) throw new Error('sharing-limit');
      clearTab(tab.id);
      const now = Date.now(), idleMs = autoDisconnectMilliseconds(effective.settings);
      const hardExpires = effective.snapshot.policy.McpMaxSessionMinutes === undefined ? UNLIMITED_EXPIRY : now + effective.snapshot.policy.McpMaxSessionMinutes * 60000;
      shares.set(tab.id, { ref: crypto.randomUUID(), tabId: tab.id, origin: new URL(tab.url).origin, url: tab.url,
        expires: Math.min(now + idleMs, hardExpires), revision: effective.revision, write, idleMs, hardExpires });
      await syncShares();
      for (const grant of grants.values()) if (grant.tabId === tab.id && grant.write) grant.sessionApproval = effective.settings.writeApproval === 'session' && effective.sessionApprovalAllowed;
      scheduleExpiry(); notifyUi();
      if (!write) void recover().catch(() => notifyUi());
      return { ok: true };
    }
    if (raw.action === 'unshare' && settingsPage && validId(raw.tabRef)) {
      const share = [...shares.values()].find(share => share.ref === raw.tabRef);
      if (share) { shares.delete(share.tabId); clearTab(share.tabId); scheduleExpiry(); }
      return { ok: true };
    }
    if (raw.action === 'membership' && settingsPage && validId(raw.clientId) && typeof raw.shared === 'boolean') {
      if (effective.snapshot.policy.McpSettingsLocked || effective.snapshot.policy.UserPreferencesSaveAllowed === false) throw new Error('policy-blocked');
      const known = await clients(); if (!known.some(client => client.id === raw.clientId)) throw new Error('invalid-clients');
      await browser.storage.local.set({ [CLIENTS_KEY]: known.map(client => client.id === raw.clientId ? { ...client, shared: raw.shared as boolean } : client) });
      revokeClientAccess(raw.clientId); await syncShares(); notifyUi(); return { ok: true };
    }
    if (raw.action === 'source' && popup) {
      if (!effective.settings.enabled) {
        await browser.tabs.create({ url: browser.runtime.getURL('/mcp.html'), active: true });
        return { ok: true };
      }
      const tab = (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      if (tab?.url && !/^https?:\/\//u.test(tab.url)) throw new Error('unsupported-page');
      if (tab?.id === undefined || tab.incognito || !tab.url || !/^https?:\/\//u.test(tab.url)) throw new Error('invalid-source');
      if (sources.size >= 16) { for (const id of sources.keys()) disposeSnapshot('preview-' + id); sources.clear(); }
      const id = crypto.randomUUID(); sources.set(id, { tabId: tab.id, url: tab.url, expires: Date.now() + 30 * 60000 });
      const settingsTab = await browser.tabs.create({ url: browser.runtime.getURL('/mcp.html') + '#' + id }); return { ok: true, sourceId: id, settingsTabId: settingsTab.id };
    }
    if (!settingsPage && !(popup && ['approve', 'deny', 'start'].includes(String(raw.action)))) throw new Error('invalid-route');
    if (raw.action === 'connection-approval' && settingsPage && validId(raw.tabRef) && validId(raw.connectionId) && typeof raw.skip === 'boolean') {
      const share = [...shares.values()].find(value => value.ref === raw.tabRef);
      const grant = grants.get(raw.connectionId);
      if (!share || !grant || share.loading || grant.tabId !== share.tabId || share.expires <= Date.now() || grant.expires <= Date.now() || grant.revision !== effective.revision || paused || halted || transport !== 'ready') throw new Error('not-connected');
      assertAction(effective.snapshot.policy, 'mcp-write');
      if (!effective.settings.enabled || !effective.modeAllowed || !grant.write || !mcpWritesEnabled(effective.settings) || !(effective.snapshot.policy.McpAllowedModes ?? ['read-only', 'read-write']).includes('read-write') || !effective.sessionApprovalAllowed || effective.snapshot.policy.McpSettingsLocked || effective.snapshot.policy.UserPreferencesSaveAllowed === false) throw new Error('policy-blocked');
      grant.sessionApproval = raw.skip;
      notifyUi(); return { ok: true };
    }
    if (raw.action === 'rename' && validId(raw.clientId) && validName(raw.name)) {
      if (effective.snapshot.policy.McpSettingsLocked || effective.snapshot.policy.UserPreferencesSaveAllowed === false) throw new Error('policy-blocked');
      const known = await clients();
      if (!known.some(client => client.id === raw.clientId)) throw new Error('invalid-clients');
      await browser.storage.local.set({ [CLIENTS_KEY]: known.map(client => client.id === raw.clientId ? { ...client, name: raw.name } : client) });
      revokeClientAccess(raw.clientId);
      return { ok: true };
    }
    if (raw.action === 'read') {
      const source = validId(raw.sourceId) ? sources.get(raw.sourceId) : undefined;
      const selected = source && source.expires > Date.now() ? await getMcpTab(source.tabId).catch(() => undefined) : undefined;
      const selectedTitle = selected && selected.url === source?.url && !selected.incognito && !selected.discarded ? selected.title?.slice(0, 300) || 'Untitled tab' : undefined;
      const connections = await Promise.all([...grants.values()].map(async grant => {
        const tab = await getMcpTab(grant.tabId).catch(() => undefined);
        return { id: grant.id, clientId: grant.clientId, expires: grant.expires, mode: grant.write ? 'read-write' : 'read-only',
          ...(tab && !tab.incognito && !tab.discarded ? { tabTitle: tab.title?.slice(0, 300) || 'Untitled tab' } : {}) };
      }));
      const sharedClients = await clients();
      const sharedTabs = await Promise.all([...shares.values()].map(async share => {
        const tab = await getMcpTab(share.tabId).catch(() => undefined);
        return { tabRef: share.ref, mode: share.write ? 'write' : 'read', expires: share.expires === UNLIMITED_EXPIRY ? null : share.expires, title: effective.data.includeTitle ? tab?.title?.slice(0, 300) || 'Untitled tab' : 'Shared tab',
          connections: [...grants.values()].filter(grant => grant.tabId === share.tabId && grant.expires > Date.now() && grant.revision === effective.revision).map(grant => ({
            connectionId: grant.id, name: sharedClients.find(client => client.id === grant.clientId)?.name ?? 'AI client', write: grant.write,
            skipPrompts: grant.sessionApproval && effective.sessionApprovalAllowed,
          })) };
      }));
      return { ok: true, sharedTabs, instanceId: await identity(), browser: import.meta.env.BROWSER, transport, paused,
      settings: effective.settings, preferences: effective.preferences, revision: effective.revision,
      sessionApprovalAllowed: effective.sessionApprovalAllowed, allowedModes: effective.snapshot.policy.McpAllowedModes ?? ['read-only', 'read-write'],
      locked: effective.snapshot.policy.McpSettingsLocked === true || effective.snapshot.policy.UserPreferencesSaveAllowed === false,
      locks: { format: effective.snapshot.policy.ForcedExportFormat !== undefined, compression: effective.snapshot.policy.ForcedCompression !== undefined,
        redaction: redactionMode(effective.snapshot.policy) !== 'user-controlled' },
      allowedFormats: effective.snapshot.policy.AllowedExportFormats ?? ['semantic-text', 'markdown'],
      allowedCompression: effective.snapshot.policy.AllowedCompressionLevels ?? ['without', 'detailed', 'compact', 'maximum'],
      requiredBuiltinFilters: effective.snapshot.policy.RequiredBuiltinFilters ?? [], managedRuleCount: effective.snapshot.policy.ManagedRedactionRules?.length ?? 0,
      testAllowed: effective.snapshot.policy.McpTestAllowed !== false && effective.snapshot.policy.PreviewAllowed !== false,
      copyAllowed: effective.snapshot.policy.ClipboardExportAllowed !== false, saveAllowed: effective.snapshot.policy.FileExportAllowed !== false,
      clients: (await clients()).map(client => ({ id: client.id, shared: client.shared === true, ...(client.name ? { name: client.name } : {}) })),
      pending: [...pairing.values()].filter(value => value.expires > Date.now()).map(value => ({ id: value.id, code: value.code, ...(value.name ? { name: value.name } : {}) })),
      selectedTab: selectedTitle ? { title: selectedTitle } : null, connections };
    }
    if (raw.action === 'apply') { await saveMcpSettings(raw.settings, String(raw.revision)); return { ok: true }; }
    if (raw.action === 'start') { halted = false; retries = 0; await start(); return { ok: true }; }
    if (raw.action === 'deny' && validId(raw.clientId)) { const request = pairing.get(raw.clientId); if (request) deniedPairing.set(raw.clientId, { hash: request.hash, expires: request.expires }); pairing.delete(raw.clientId); schedulePairingExpiry(); notifyUi(); return { ok: true }; }
    if (raw.action === 'approve' && validId(raw.clientId)) {
      if (effective.snapshot.policy.McpSettingsLocked || effective.snapshot.policy.UserPreferencesSaveAllowed === false) throw new Error('policy-blocked');
      const request = pairing.get(raw.clientId);
      if (!request || request.expires <= Date.now() || raw.code !== request.code ||
        effective.snapshot.policy.McpAllowedClientIds && !effective.snapshot.policy.McpAllowedClientIds.includes(request.id)) throw new Error('pairing-expired');
      const known = await clients(); if (known.length >= 32) throw new Error('client-limit');
      await browser.storage.local.set({ [CLIENTS_KEY]: [...known.filter(client => client.id !== request.id), { id: request.id, hash: request.hash, shared: raw.shared === true, ...(request.name ? { name: request.name } : {}) }] });
      pairing.delete(request.id); schedulePairingExpiry(); await syncShares(); notifyUi(); return { ok: true };
    }
    const source = validId(raw.sourceId) ? sources.get(raw.sourceId) : undefined;
    if (!source || source.expires <= Date.now()) throw new Error('source-required');
    const tab = await getMcpTab(source.tabId);
    if (tab.url !== source.url || tab.incognito || tab.discarded) throw new Error('page-changed');
    if (raw.action === 'connect' && validId(raw.clientId)) {
      const clientRevision = clientRegistryRevision;
      const client = (await clients()).find(client => client.id === raw.clientId);
      if (!port || transport !== 'ready' || paused || halted || !effective.settings.enabled || !effective.modeAllowed || !client ||
        clientRevision !== clientRegistryRevision ||
        effective.snapshot.policy.McpAllowedClientIds && !effective.snapshot.policy.McpAllowedClientIds.includes(raw.clientId)) throw new Error('not-connected');
      for (const [id, grant] of grants) if (grant.clientId === raw.clientId && grant.tabId === source.tabId) dropGrant(grant);
      const write = mcpWritesEnabled(effective.settings) && raw.allowWrite === true;
      if (write) { assertAction(effective.snapshot.policy, 'mcp-write'); if (!await hasMcpTransmissionConsent(true)) throw new Error('permission-required'); }
      const id = crypto.randomUUID(); grants.set(id, { id, clientId: raw.clientId, clientHash: client.hash, tabId: source.tabId, origin: new URL(source.url).origin,
        expires: Date.now() + (effective.snapshot.policy.McpMaxSessionMinutes ?? 30) * 60000, revision: effective.revision, write,
        sessionApproval: write && effective.settings.writeApproval === 'session' && effective.sessionApprovalAllowed });
      scheduleExpiry(); notifyTools(raw.clientId);
      notifyUi();
      return { ok: true, connectionId: id };
    }
    if (raw.action === 'test') {
      if (busyTabs.has(source.tabId)) throw new Error('connection-busy');
      busyTabs.add(source.tabId);
      const ticket = generation, controller = new AbortController();
      const id = crypto.randomUUID(); pending.set(id, controller); pendingTabs.set(id, source.tabId);
      const timer = setTimeout(() => controller.abort(), 14000);
      try {
        const owner = 'preview-' + String(raw.sourceId); disposeSnapshot(owner);
        const result = await readMcpContext(source.tabId, () => { if (ticket !== generation || sources.get(String(raw.sourceId)) !== source) throw new Error('page-changed'); },
          true, controller.signal, raw.draft as McpSettings | undefined, { owner, write: true, expires: source.expires, retain: snapshot => snapshots.set(owner, snapshot) });
        return { ok: true, result, revision: effective.revision };
      } finally { clearTimeout(timer); pending.delete(id); pendingTabs.delete(id); busyTabs.delete(source.tabId); }
    }
    throw new Error('invalid-request');
  };
  return { ui, stop, initialize: recover, refreshAction: updateIcons };
}
