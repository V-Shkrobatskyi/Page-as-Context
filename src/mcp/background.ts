// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { browser, type Browser } from 'wxt/browser';
import { readMcpContext } from './capture';
import { MCP_SETTINGS_KEY, resolveMcpSettings, saveMcpSettings, type McpSettings } from './settings';
import { assertAction, redactionMode } from '../policy/model';
import { hasMcpTransmissionConsent } from './permissions';
import { OperationLedger, WRITE_TOOLS, actionArguments } from './operations';
import { sourceAllowed } from '../policy/sources';
import type { ActionSnapshot, ActionOutcome } from '../adapters/actions/contract';
import { technicalEvent } from '../diagnostics/client';
import { MCP_STATE_CHANGED } from './ui-events';

const INSTANCE_KEY = 'mcp-instance-v1', CLIENTS_KEY = 'mcp-clients-v1';
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/u.test(value);
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(value);
interface Client { id: string; hash: string; name?: string }
interface Grant { id: string; clientId: string; tabId: number; origin: string; expires: number; revision: string; write: boolean; sessionApproval: boolean; busy?: boolean }
interface Source { tabId: number; url: string; expires: number }
interface NativeRequest { type: 'request'; id: string; instanceId: string; browser: string; credentialId: string; credentialSecret: string; request: { tool: string; arguments?: Record<string, unknown> } }

/** Owns transient access. Restart, Stop, policy changes and disconnect discard all grants. */
export function createMcpController() {
  let port: Browser.runtime.Port | undefined, instance: string | undefined, transport = 'disconnected';
  const sources = new Map<string, Source>(), grants = new Map<string, Grant>(), pending = new Map<string, AbortController>();
  const pairing = new Map<string, { id: string; hash: string; code: string; expires: number; name?: string }>();
  const snapshots = new Map<string, ActionSnapshot>(), ledger = new OperationLedger();
  const busyTabs = new Set<number>();
  const pendingClients = new Map<string, string>();
  const approvals = new Map<string, { grant: Grant; action: string; target: string; expires: number; tabId?: number; answer: (allow: boolean) => void }>();
  let generation = 0;
  let pairingExpiry: ReturnType<typeof setTimeout> | undefined;
  const notifyUi = () => {
    // No code, credential, client identity or page metadata is broadcast.
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
  const invalidate = () => { generation++; const clients = new Set([...grants.values()].map(grant => grant.clientId)); grants.clear(); for (const client of clients) notifyTools(client); for (const controller of pending.values()) controller.abort(); pending.clear();
    for (const snapshot of snapshots.values()) snapshot.dispose(); snapshots.clear();
    for (const approval of [...approvals.values()]) approval.answer(false); ledger.clear(); };
  const stop = () => { invalidate(); pairing.clear(); schedulePairingExpiry(); sources.clear(); const previous = port; port = undefined; transport = 'disconnected'; previous?.disconnect(); notifyUi(); };
  const identity = async () => {
    if (instance) return instance;
    const stored = await browser.storage.local.get(INSTANCE_KEY);
    if (stored[INSTANCE_KEY] === undefined) { instance = crypto.randomUUID(); await browser.storage.local.set({ [INSTANCE_KEY]: instance }); }
    else if (validId(stored[INSTANCE_KEY])) instance = stored[INSTANCE_KEY];
    else throw new Error('invalid-instance');
    return instance!;
  };
  const clients = async (): Promise<Client[]> => {
    const stored = await browser.storage.local.get(CLIENTS_KEY); const value = stored[CLIENTS_KEY] ?? [];
    if (!Array.isArray(value) || value.length > 32 || value.some(client => !client || !validId(client.id) || typeof client.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(client.hash) || client.name !== undefined && !validName(client.name)) ||
      new Set(value.map(client => client.id)).size !== value.length) throw new Error('invalid-clients');
    return value;
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
    if (!effective.settings.enabled || !effective.modeAllowed || !await hasMcpTransmissionConsent(effective.settings.mode === 'read-write') || request.instanceId !== await identity() || request.browser !== import.meta.env.BROWSER ||
      effective.snapshot.policy.McpAllowedClientIds && !effective.snapshot.policy.McpAllowedClientIds.includes(request.credentialId)) throw new Error('not-connected');
    const client = (await clients()).find(client => client.id === request.credentialId);
    if (!client || client.hash !== await digest(request.credentialSecret)) throw new Error('not-connected');
    return effective;
  };
  const requestApproval = (grant: Grant, action: string, target: string, signal: AbortSignal): Promise<boolean> => new Promise(resolve => {
    const id = crypto.randomUUID();
    const answer = (allow: boolean) => {
      if (!approvals.has(id)) return;
      const approval = approvals.get(id)!; approvals.delete(id); clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (approval.tabId !== undefined) void browser.tabs.remove(approval.tabId).catch(() => {});
      resolve(allow);
    };
    const abort = () => answer(false), timer = setTimeout(() => answer(false), 45000);
    const approval = { grant, action, target, expires: Date.now() + 45000, answer, tabId: undefined as number | undefined };
    approvals.set(id, approval); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { answer(false); return; }
    void browser.tabs.create({ url: browser.runtime.getURL('/mcp-approval.html') + '#' + id }).then(tab => {
      if (!approvals.has(id)) { if (tab.id !== undefined) void browser.tabs.remove(tab.id).catch(() => {}); return; }
      approval.tabId = tab.id;
    }, () => answer(false));
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
      }
      return { status: 'pending', code: value.code };
    }
    const effective = await authorizeClient(request);
    const allowedWrites = Object.entries(WRITE_TOOLS).filter(([, action]) => (effective.snapshot.policy.McpAllowedActions ?? ['click', 'fill', 'select-option', 'set-checked']).includes(action)).map(([tool]) => tool);
    const writeAllowed = effective.settings.mode === 'read-write' && (effective.snapshot.policy.McpAllowedModes ?? ['read-only', 'read-write']).includes('read-write');
    if (request.request.tool === 'list-tools') return { tools: ['get_connection_status', 'read_page_context',
      ...(writeAllowed && [...grants.values()].some(grant => grant.clientId === request.credentialId && grant.write && grant.expires > Date.now() && grant.revision === effective.revision) ? allowedWrites : [])] };
    const isWrite = Object.hasOwn(WRITE_TOOLS, request.request.tool);
    const action = isWrite ? actionArguments(request.request.tool, args) : undefined;
    if (!validId(args.connectionId) || !isWrite && Object.keys(args).some(key => key !== 'connectionId')) throw new Error('invalid-request');
    const grant = grants.get(args.connectionId);
    const authorize = () => {
      if (ticket !== generation || controller.signal.aborted || !port || !grant || grants.get(grant.id) !== grant || grant.clientId !== request.credentialId ||
        grant.expires <= Date.now() || grant.revision !== effective.revision) throw new Error('not-connected');
    };
    authorize();
    const tab = await browser.tabs.get(grant!.tabId);
    if (!tab.url || new URL(tab.url).origin !== grant!.origin || tab.incognito || tab.discarded || !sourceAllowed(tab.url, effective.controls.sources)) throw new Error('not-connected');
    const mode = grant!.write && writeAllowed ? 'read-write' : 'read-only';
    const capabilities = ['read_page_context', ...(mode === 'read-write' ? allowedWrites : [])];
    if (request.request.tool === 'get_connection_status') return { connectionId: grant!.id, mode, capabilities, expiresAt: grant!.expires, busy: !!grant!.busy,
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
            const target = await browser.tabs.get(grant!.tabId);
            if (current.revision !== grant!.revision || current.settings.mode !== 'read-write' || !target.url || target.incognito || target.discarded ||
              new URL(target.url).origin !== grant!.origin || !sourceAllowed(target.url, current.controls.sources)) throw new Error('policy-blocked');
            authorize();
          };
          await validate();
          if (!grant!.sessionApproval) {
            const target = snapshot.targets.get(action.elementRef)!;
            if (!await requestApproval(grant!, action.action, `${target.role}${target.name ? ': ' + target.name.slice(0, 1000) : ''}`, controller.signal)) return receipt({ status: 'rejected', error: 'approval-denied' });
          }
          await validate();
          const outcome = await snapshot.run(action, controller.signal, validate);
          disposeSnapshot(grant!.id);
          technicalEvent({ code: 'mcp-write', result: outcome.status === 'applied' ? 'success' : 'error', reason: outcome.status === 'applied' ? 'none' : 'failed' });
          if (outcome.status !== 'applied') return receipt(outcome);
          try { const result = await capture(); return { ...receipt(outcome), snapshotId: result.snapshotId, snapshot: result }; }
          catch { return { ...receipt(outcome), snapshotUnavailable: 'post-action-capture-unavailable' }; }
        } catch { return receipt({ status: 'rejected', error: controller.signal.aborted ? 'approval-denied' : 'policy-blocked' }); }
        finally { if (snapshots.get(grant!.id) === snapshot) disposeSnapshot(grant!.id); grant!.busy = false; busyTabs.delete(grant!.tabId); }
      });
    }
    if (request.request.tool !== 'read_page_context') throw new Error('read-only');
    if (grant!.busy || busyTabs.has(grant!.tabId)) throw new Error('connection-busy');
    grant!.busy = true; busyTabs.add(grant!.tabId);
    try { const result = await capture(); technicalEvent({ code: 'mcp-read', result: 'success' }); return result; }
    finally { grant!.busy = false; busyTabs.delete(grant!.tabId); }
  };
  const start = async () => {
    if (port) return;
    const effective = await resolveMcpSettings(); assertAction(effective.snapshot.policy, 'mcp-read');
    if (!effective.settings.enabled || !effective.modeAllowed || !await hasMcpTransmissionConsent(effective.settings.mode === 'read-write') || !(await browser.permissions.contains({ permissions: ['nativeMessaging'] }))) throw new Error('permission-required');
    if ((await browser.runtime.getPlatformInfo()).os === 'android') throw new Error('unsupported-platform');
    const current = browser.runtime.connectNative('org.page_as_context.bridge'); port = current; transport = 'connecting';
    notifyUi();
    current.onDisconnect.addListener(() => { void browser.runtime.lastError; if (port === current) { port = undefined; transport = 'disconnected'; invalidate(); pairing.clear(); schedulePairingExpiry(); notifyUi(); } });
    const readiness = setTimeout(() => { if (port === current && transport !== 'ready') stop(); }, 5000);
    current.onMessage.addListener((raw: unknown) => {
      if (port !== current || !raw || typeof raw !== 'object') return;
      const value = raw as NativeRequest & { protocol?: unknown };
      if (value.type as string === 'ready' && value.protocol === 1) { clearTimeout(readiness); transport = 'ready'; notifyUi(); return; }
      if (value.type as string === 'cancel') { pending.get(value.id)?.abort(); return; }
      if (value.type as string === 'client-disconnected') {
        void authorizeClient(value).then(() => {
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
        const allowed = ['read-only', 'invalid-request', 'operation-id-reused', 'operation-limit', 'connection-busy', 'unsupported-combination', 'response-limit'];
        if (port === current && ticket === generation && !controller.signal.aborted) nativeResult(current, value.id, { error: error instanceof Error && allowed.includes(error.message) ? error.message : 'request-rejected' });
      }).catch(() => stop()).finally(() => { clearTimeout(timeout); pending.delete(value.id); pendingClients.delete(value.id); });
    });
    current.postMessage({ type: 'register', protocol: 1, browser: import.meta.env.BROWSER, instanceId: await identity() });
  };
  const clearTab = (tabId: number, removed = false) => {
    for (const approval of [...approvals.values()]) if (removed && approval.tabId === tabId || approval.grant.tabId === tabId) approval.answer(false);
    for (const [id, source] of sources) if (source.tabId === tabId) { sources.delete(id); disposeSnapshot('preview-' + id); }
    for (const [id, grant] of grants) if (grant.tabId === tabId) { grants.delete(id); disposeSnapshot(id); notifyTools(grant.clientId); for (const controller of pending.values()) controller.abort(); }
  };
  browser.tabs.onRemoved?.addListener(tabId => clearTab(tabId, true));
  browser.tabs.onUpdated?.addListener((tabId, change) => {
    if (change.url) for (const [id, approval] of approvals) if (approval.tabId === tabId && change.url !== browser.runtime.getURL('/mcp-approval.html') + '#' + id) approval.answer(false);
    if (change.url || change.status === 'loading' || change.discarded) clearTab(tabId);
  });
  browser.permissions?.onRemoved?.addListener(() => stop());
  browser.storage.onChanged?.addListener((changes, area) => {
    if (area === 'managed' || area === 'local' && ['data-controls-v1', 'capture-sources-v1', 'popup-settings', 'redaction-filters-v1', MCP_SETTINGS_KEY, CLIENTS_KEY].some(key => key in changes)) {
      invalidate();
      if (area === 'managed' || changes[MCP_SETTINGS_KEY]) { const previous = port; port = undefined; transport = 'disconnected'; previous?.disconnect(); }
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
      if (current.revision !== approval.grant.revision || grants.get(approval.grant.id) !== approval.grant) { approval.answer(false); throw new Error('approval-expired'); }
      if (raw.action === 'approval-read') return { ok: true, action: approval.action, target: approval.target, expires: approval.expires };
      if (raw.action === 'approval-answer' && typeof raw.allow === 'boolean') { approval.answer(raw.allow); return { ok: true }; }
      throw new Error('invalid-request');
    }
    if (raw.action === 'stop') { stop(); return { ok: true }; }
    if (raw.action === 'revoke' && settingsPage && validId(raw.clientId)) {
      stop(); await browser.storage.local.set({ [CLIENTS_KEY]: (await clients()).filter(client => client.id !== raw.clientId) }); return { ok: true };
    }
    const effective = await resolveMcpSettings();
    assertAction(effective.snapshot.policy, 'mcp-read');
    if (raw.action === 'source' && popup) {
      const tab = (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      if (tab?.id === undefined || tab.incognito || !tab.url || !/^https?:\/\//u.test(tab.url)) throw new Error('invalid-source');
      if (sources.size >= 16) { for (const id of sources.keys()) disposeSnapshot('preview-' + id); sources.clear(); }
      const id = crypto.randomUUID(); sources.set(id, { tabId: tab.id, url: tab.url, expires: Date.now() + 30 * 60000 });
      const settingsTab = await browser.tabs.create({ url: browser.runtime.getURL('/mcp.html') + '#' + id }); return { ok: true, sourceId: id, settingsTabId: settingsTab.id };
    }
    if (!settingsPage) throw new Error('invalid-route');
    if (raw.action === 'rename' && validId(raw.clientId) && validName(raw.name)) {
      if (effective.snapshot.policy.McpSettingsLocked || effective.snapshot.policy.UserPreferencesSaveAllowed === false) throw new Error('policy-blocked');
      const known = await clients();
      if (!known.some(client => client.id === raw.clientId)) throw new Error('invalid-clients');
      await browser.storage.local.set({ [CLIENTS_KEY]: known.map(client => client.id === raw.clientId ? { ...client, name: raw.name } : client) });
      return { ok: true };
    }
    if (raw.action === 'read') {
      const source = validId(raw.sourceId) ? sources.get(raw.sourceId) : undefined;
      const selected = source && source.expires > Date.now() ? await browser.tabs.get(source.tabId).catch(() => undefined) : undefined;
      const selectedTitle = selected && selected.url === source?.url && !selected.incognito && !selected.discarded ? selected.title?.slice(0, 300) || 'Untitled tab' : undefined;
      const connections = await Promise.all([...grants.values()].map(async grant => {
        const tab = await browser.tabs.get(grant.tabId).catch(() => undefined);
        return { id: grant.id, clientId: grant.clientId, expires: grant.expires, mode: grant.write ? 'read-write' : 'read-only',
          ...(tab && !tab.incognito && !tab.discarded ? { tabTitle: tab.title?.slice(0, 300) || 'Untitled tab' } : {}) };
      }));
      return { ok: true, instanceId: await identity(), browser: import.meta.env.BROWSER, transport,
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
      clients: (await clients()).map(client => ({ id: client.id, ...(client.name ? { name: client.name } : {}) })),
      pending: [...pairing.values()].filter(value => value.expires > Date.now()).map(value => ({ id: value.id, code: value.code, ...(value.name ? { name: value.name } : {}) })),
      selectedTab: selectedTitle ? { title: selectedTitle } : null, connections };
    }
    if (raw.action === 'apply') { await saveMcpSettings(raw.settings, String(raw.revision)); return { ok: true }; }
    if (raw.action === 'start') { await start(); return { ok: true }; }
    if (raw.action === 'approve' && validId(raw.clientId)) {
      if (effective.snapshot.policy.McpSettingsLocked || effective.snapshot.policy.UserPreferencesSaveAllowed === false) throw new Error('policy-blocked');
      const request = pairing.get(raw.clientId);
      if (!request || request.expires <= Date.now() || raw.code !== request.code ||
        effective.snapshot.policy.McpAllowedClientIds && !effective.snapshot.policy.McpAllowedClientIds.includes(request.id)) throw new Error('pairing-expired');
      const known = await clients(); if (known.length >= 32) throw new Error('client-limit');
      await browser.storage.local.set({ [CLIENTS_KEY]: [...known.filter(client => client.id !== request.id), { id: request.id, hash: request.hash, ...(request.name ? { name: request.name } : {}) }] });
      pairing.delete(request.id); schedulePairingExpiry(); notifyUi(); return { ok: true };
    }
    const source = validId(raw.sourceId) ? sources.get(raw.sourceId) : undefined;
    if (!source || source.expires <= Date.now()) throw new Error('source-required');
    const tab = await browser.tabs.get(source.tabId);
    if (tab.url !== source.url || tab.incognito || tab.discarded) throw new Error('page-changed');
    if (raw.action === 'connect' && validId(raw.clientId)) {
      if (!port || transport !== 'ready' || !effective.settings.enabled || !(await clients()).some(client => client.id === raw.clientId) ||
        effective.snapshot.policy.McpAllowedClientIds && !effective.snapshot.policy.McpAllowedClientIds.includes(raw.clientId)) throw new Error('not-connected');
      for (const [id, grant] of grants) if (grant.clientId === raw.clientId) { grants.delete(id); disposeSnapshot(id); }
      const write = effective.settings.mode === 'read-write' && raw.allowWrite === true;
      if (write) assertAction(effective.snapshot.policy, 'mcp-write');
      const id = crypto.randomUUID(); grants.set(id, { id, clientId: raw.clientId, tabId: source.tabId, origin: new URL(source.url).origin,
        expires: Date.now() + (effective.snapshot.policy.McpMaxSessionMinutes ?? 30) * 60000, revision: effective.revision, write,
        sessionApproval: write && effective.settings.writeApproval === 'session' && effective.sessionApprovalAllowed });
      notifyTools(raw.clientId);
      notifyUi();
      return { ok: true, connectionId: id };
    }
    if (raw.action === 'test') {
      if (busyTabs.has(source.tabId)) throw new Error('connection-busy');
      busyTabs.add(source.tabId);
      const ticket = generation, controller = new AbortController();
      const id = crypto.randomUUID(); pending.set(id, controller);
      const timer = setTimeout(() => controller.abort(), 14000);
      try {
        const owner = 'preview-' + String(raw.sourceId); disposeSnapshot(owner);
        const result = await readMcpContext(source.tabId, () => { if (ticket !== generation || sources.get(String(raw.sourceId)) !== source) throw new Error('page-changed'); },
          true, controller.signal, raw.draft as McpSettings | undefined, { owner, write: true, expires: source.expires, retain: snapshot => snapshots.set(owner, snapshot) });
        return { ok: true, result, revision: effective.revision };
      } finally { clearTimeout(timer); pending.delete(id); busyTabs.delete(source.tabId); }
    }
    throw new Error('invalid-request');
  };
  return { ui, stop };
}
