// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import './style.css';
import { browser, type Browser } from 'wxt/browser';
import type { CompressionLevel } from '@/src/core/contracts';
import { defaultAutoDisconnect, type McpSettings, type McpAutoDisconnect } from '@/src/mcp/settings';
import type { ExportPreferences } from '@/src/policy/model';
import { requestMcpPermissions } from '@/src/mcp/permissions';
import { MCP_ACTIONS, type McpAction } from '@/src/mcp/policy';
import { MCP_STATE_CHANGED } from '@/src/mcp/ui-events';
import { downloadBlob } from '@/src/save-context';
import { isDownloadCancellation } from '@/src/download-errors';
import { hfsLauncher } from '@/src/mcp/launchers';
import { setupSettingHelp } from './setting-help';

const disposeSettingHelp = setupSettingHelp();
window.addEventListener('pagehide', disposeSettingHelp, { once: true });

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = get('status'), output = get<HTMLTextAreaElement>('output');
const sourceId = location.hash.slice(1);
if (/^[a-zA-Z0-9_-]{16,80}$/u.test(sourceId)) get<HTMLAnchorElement>('filters').href = '/filters.html#return=mcp&source=' + sourceId;
let revision = '', capturedRevision = '', generation = 0, modified = false, disposed = false, appliedEnabled = false, loaded = false;
let automatic = false;
let locked = true, testAllowed = false, copyAllowed = false, saveAllowed = false;
let fieldLocks = { format: false, compression: false, redaction: false }, savedData: McpSettings['data'];
let downloadUrl: string | undefined;
let hfsConfigurationDownload: number | undefined;
let savingHfsConfiguration = false;
let pendingHfsFiles: { configuration: string; launcher: string; downloadId: number } | undefined;
let addingHttpClient = false;
let connectionRefresh: ReturnType<typeof setTimeout> | undefined;
let countdownTimer: ReturnType<typeof setInterval> | undefined;
let hfsState = 'disconnected', hfsLeaseRetryAt = 0, hfsPaused = false, refreshedHfsDeadline = 0;
const hfsLeaseNotice = 'This browser instance already has a live HFS lease.';
const hfsCheckingNotice = 'Checking HFS connection status…';
function updateHfsStatus() {
  const waiting = hfsState === 'provider-already-connected' && hfsLeaseRetryAt > 0;
  const seconds = Math.max(0, Math.ceil((hfsLeaseRetryAt - Date.now()) / 1000));
  const notice = seconds > 0 ? `${hfsLeaseNotice} Retry in ${seconds} sec.` : automatic ? hfsCheckingNotice : `${hfsLeaseNotice} Waiting period ended.`;
  const text = `HFS: ${waiting ? notice : hfsState}${hfsPaused ? ' · all page access paused' : ''}`;
  if (get('hfs-status').textContent !== text) get('hfs-status').textContent = text;
  if (status.textContent?.startsWith(hfsLeaseNotice) || status.textContent === hfsCheckingNotice) {
    const message = waiting ? notice : hfsState === 'connecting' ? hfsCheckingNotice : `HFS: ${hfsState}`;
    if (status.textContent !== message) status.textContent = message;
  }
}
function updateCountdowns() {
  for (const cell of document.querySelectorAll<HTMLTableCellElement>('#shared-tabs [data-expires]')) {
    const remaining = Math.max(0, Number(cell.dataset.expires) - Date.now());
    const text = remaining < 60000 ? `${Math.ceil(remaining / 1000)} sec` : `${Math.ceil(remaining / 60000)} min`;
    if (cell.textContent !== text) { cell.textContent = text; cell.setAttribute('aria-label', `Auto-disconnect in ${text}`); }
  }
}
const unavailableMessage = 'MCP request unavailable. Check permissions, organization policies and the source tab, then refresh.';
const requestErrors = new Map([
  ['source-required', 'The selected tab is missing or expired. Open the extension popup on the page you want to share and choose Connect MCP again.'],
  ['page-changed', 'The selected page changed. Open its extension popup and choose Connect MCP again.'],
  ['not-connected', 'This client has no active helper connection. Refresh status, then use Start helper connection if needed.'],
  ['permission-required', 'Browser permission is required. Use Start helper connection and approve the requested permissions.'],
  ['hfs-configuration-required', 'Generate or join an HFS installation, apply its endpoint, then Retry HFS.'],
  ['hfs-configuration-exists', 'This browser already has an HFS installation. Keep its endpoint or reset HTTP access before replacing it.'],
  ['unsupported-hfs-platform', 'HFS setup files are available for macOS, Windows and Linux.'],
  ['invalid-hfs-endpoint', 'Use http://127.0.0.1 with an explicit port from 1024 to 65535.'],
  ['relay-authentication-failed', 'HFS authentication failed. Check the private installation config and selected endpoint.'],
  ['provider-already-connected', 'This browser instance already has a live HFS lease. Wait up to 45 seconds after a crash, then retry.'],
  ['invalid-source', 'Select a regular HTTP or HTTPS page through the extension popup, then choose Connect MCP.'],
]);
class McpUiError extends Error {
  constructor(readonly code: unknown) { super(typeof code === 'string' ? requestErrors.get(code) ?? unavailableMessage : unavailableMessage); }
}
async function request(action: string, fields: Record<string, unknown> = {}): Promise<any> {
  const result = await browser.runtime.sendMessage({ type: 'mcp-ui-v1', action, ...fields });
  if (!result?.ok) throw new McpUiError(result?.code); return result;
}
function clear() { generation++; capturedRevision = ''; output.value = ''; get('captured').textContent = ''; get<HTMLButtonElement>('copy').disabled = true; get<HTMLButtonElement>('save').disabled = true; }
function draft(): McpSettings {
  const unit = get<HTMLSelectElement>('timeout-unit').value as McpAutoDisconnect['unit'];
  const amount = Number(get<HTMLInputElement>('timeout-amount').value);
  return { version: 1, nativeEnabled: get<HTMLInputElement>('native-enabled').checked, hfs: { enabled: get<HTMLInputElement>('hfs-enabled').checked, endpoint: get<HTMLInputElement>('hfs-endpoint').value }, connection: get<HTMLSelectElement>('connection').value as 'automatic' | 'manual', enabled: get<HTMLInputElement>('enabled').checked, mode: get<HTMLSelectElement>('mode').value as McpSettings['mode'],
    autoDisconnect: { unit, amount: unit === 'unlimited' && (!Number.isSafeInteger(amount) || amount < 1 || amount > 999) ? 1 : amount },
    maxActions: Number(get<HTMLInputElement>('max-actions').value),
    writeApproval: get<HTMLSelectElement>('write-approval').value as McpSettings['writeApproval'], inherit: get<HTMLInputElement>('inherit').checked,
    preferences: { format: get<HTMLSelectElement>('format').value as ExportPreferences['format'], compression: get<HTMLSelectElement>('compression').value as CompressionLevel, redactSensitiveData: get<HTMLInputElement>('redact').checked }, ...(savedData ? { data: savedData } : {}) };
}
function controls() {
  for (const id of ['enabled', 'connection', 'mode', 'inherit', 'apply', 'apply-access', 'apply-hfs', 'apply-native', 'write-approval', 'native-enabled', 'hfs-enabled', 'hfs-endpoint']) get<HTMLInputElement | HTMLButtonElement>(id).disabled = locked;
  get<HTMLSelectElement>('write-approval').disabled = locked || get<HTMLSelectElement>('mode').value === 'read-only';
  get<HTMLInputElement>('max-actions').disabled = locked || get<HTMLSelectElement>('mode').value === 'read-only';
  const automaticDraft = get<HTMLSelectElement>('connection').value === 'automatic';
  get('auto-disconnect-setting').hidden = !automaticDraft;
  get<HTMLSelectElement>('timeout-unit').disabled = locked || !automaticDraft;
  get<HTMLInputElement>('timeout-amount').disabled = locked || !automaticDraft || get<HTMLSelectElement>('timeout-unit').value === 'unlimited';
  for (const id of ['format', 'compression', 'redact']) get<HTMLInputElement>(id).disabled = locked || get<HTMLInputElement>('inherit').checked;
  if (fieldLocks.format) get<HTMLSelectElement>('format').disabled = true;
  if (fieldLocks.compression) get<HTMLSelectElement>('compression').disabled = true;
  if (fieldLocks.redaction) get<HTMLInputElement>('redact').disabled = true;
  for (const id of ['hfs-generate', 'hfs-retry', 'hfs-add-client', 'hfs-import', 'hfs-reset']) get<HTMLInputElement | HTMLButtonElement>(id).disabled = locked;
  get<HTMLButtonElement>('hfs-generate').disabled = locked || savingHfsConfiguration || !get<HTMLInputElement>('hfs-enabled').checked;
  get<HTMLButtonElement>('hfs-add-client').disabled = locked || addingHttpClient || !get<HTMLInputElement>('hfs-enabled').checked;
  get<HTMLButtonElement>('test').disabled = !testAllowed || !sourceId;
  get<HTMLButtonElement>('start').disabled = !appliedEnabled;
  for (const id of ['draft-state', 'draft-state-access', 'draft-state-hfs', 'draft-state-native']) get(id).textContent = modified ? 'Draft — external sessions still use applied settings' : 'Applied';
}
const button = (text: string, action: () => Promise<void>) => {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
  element.addEventListener('click', () => void run(action)); return element;
};
function clientRow(identity: string, name: string | undefined, tab?: string, addedAt?: number) {
  const row = document.createElement('div'); row.className = 'client-row';
  const label = document.createElement('div'); label.className = 'client-identity';
  const title = document.createElement('strong'); title.className = 'client-name'; title.textContent = name ?? 'Unnamed MCP client';
  const id = document.createElement('span'); id.className = 'client-id'; id.textContent = identity;
  if (typeof addedAt === 'number' && Number.isSafeInteger(addedAt) && addedAt > 0 && addedAt <= 8640000000000000) {
    const time = document.createElement('time'), date = new Date(addedAt);
    time.dateTime = date.toISOString(); time.title = date.toLocaleString();
    time.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    id.append(' · Added: ', time);
  }
  label.append(title, id);
  if (tab) { const source = document.createElement('span'); source.className = 'client-tab'; source.textContent = tab; label.append(source); }
  const actions = document.createElement('div'); actions.className = 'action-group'; row.append(label, actions);
  return { row, actions };
}
function emptyState(text: string) {
  const element = document.createElement('p'); element.className = 'empty-state'; element.textContent = text; return element;
}
async function load() {
  const ticket = generation, result = await request('read', { sourceId }); if (disposed || ticket !== generation) return;
  revision = result.revision; locked = result.locked; testAllowed = result.testAllowed; copyAllowed = result.copyAllowed; saveAllowed = result.saveAllowed;
  appliedEnabled = result.settings.enabled; automatic = result.settings.connection === 'automatic';
  get('start').textContent = automatic ? 'Retry connection' : 'Start helper connection';
  get('pause').textContent = result.paused ? 'Resume' : 'Pause all';
  get('pause').dataset.paused = String(result.paused === true);
  for (const option of get<HTMLSelectElement>('mode').options) option.disabled = !result.allowedModes.includes(option.value);
  get<HTMLSelectElement>('write-approval').options[1]!.disabled = !result.sessionApprovalAllowed;
  fieldLocks = result.locks; savedData = result.settings.data;
  for (const option of get<HTMLSelectElement>('format').options) option.disabled = !result.allowedFormats.includes(option.value);
  for (const option of get<HTMLSelectElement>('compression').options) option.disabled = !result.allowedCompression.includes(option.value);
  get('managed-filters').textContent = `Required built-in filters: ${result.requiredBuiltinFilters.length ? result.requiredBuiltinFilters.join(', ') : 'none'} · Managed custom rules: ${result.managedRuleCount}. Mandatory rules cannot be disabled here.`;
  get('transport').textContent = `Helper: ${result.transports?.native ?? result.transport}`;
  if (!loaded) { status.textContent = result.settings.enabled ? 'MCP is enabled. Connect an AI app and share a tab.' : 'MCP is off. Local output tests remain available when permitted.'; loaded = true; }
  get('instance').textContent = `Browser: ${result.browser} · Instance: ${result.instanceId} · Extension ID: ${browser.runtime.id}`;
  get<HTMLButtonElement>('copy-instance').disabled = false;
  if (!modified) {
    const settings = result.settings as McpSettings, preferences = result.preferences;
    get<HTMLInputElement>('enabled').checked = settings.enabled;
    get<HTMLInputElement>('native-enabled').checked = settings.nativeEnabled !== false;
    get<HTMLInputElement>('hfs-enabled').checked = settings.hfs?.enabled === true;
    get<HTMLInputElement>('hfs-endpoint').value = settings.hfs?.endpoint ?? 'http://127.0.0.1:39861'; get<HTMLInputElement>('inherit').checked = settings.inherit;
    get<HTMLSelectElement>('mode').value = settings.mode;
    get<HTMLInputElement>('max-actions').value = String(settings.maxActions ?? 10);
    get<HTMLSelectElement>('connection').value = settings.connection ?? 'manual';
    const timeout = settings.autoDisconnect ?? defaultAutoDisconnect();
    get<HTMLInputElement>('timeout-amount').value = String(timeout.amount);
    get<HTMLSelectElement>('timeout-unit').value = timeout.unit;
    get<HTMLSelectElement>('write-approval').value = result.sessionApprovalAllowed ? settings.writeApproval ?? 'each-action' : 'each-action';
    get<HTMLSelectElement>('format').value = preferences.format; get<HTMLSelectElement>('compression').value = preferences.compression;
    get<HTMLInputElement>('redact').checked = preferences.redactSensitiveData;
  }
  hfsState = result.transports?.hfs ?? 'disconnected'; hfsPaused = result.paused === true;
  hfsLeaseRetryAt = typeof result.hfsLeaseRetryAt === 'number' && Number.isFinite(result.hfsLeaseRetryAt) ? result.hfsLeaseRetryAt : 0;
  updateHfsStatus();
  get('http-clients').replaceChildren(...(result.httpClients ?? []).map((profile: { id: string; name: string; approved?: boolean }) => {
    const { row, actions } = clientRow(`Client ID: ${profile.id}`, profile.name);
    const copyValue = (label: string, field: 'url' | 'authorization') => {
      const control = button(label, async () => {
        try {
          const result = await request('hfs-client-value', { clientId: profile.id, field });
          await navigator.clipboard.writeText(result.value);
          status.textContent = 'Copied';
        } catch { status.textContent = 'Could not copy. Check clipboard access and refresh client settings.'; }
      });
      control.disabled = locked || !profile.approved || result.httpClipboardAllowed === false;
      if (!profile.approved) control.title = 'Authorize this client before copying connection details.';
      return control;
    };
    const exportConfig = button(profile.approved ? 'Export config' : 'Authorize & export', async () => {
      try {
        const allowed = import.meta.env.BROWSER !== 'firefox' || await browser.permissions.request({ permissions: ['downloads'] });
        if (!allowed) { status.textContent = 'Allow downloads to export the client configuration.'; return; }
        const config = await request('hfs-export-client', { clientId: profile.id });
        await downloadBlob(new Blob([config.content], { type: 'application/json;charset=utf-8' }), config.filename);
        await load(); status.textContent = 'Client configuration exported. Keep the JSON private.';
      } catch (error) {
        await load();
        status.textContent = isDownloadCancellation(error) ? 'Client config save cancelled. The client remains authorized.'
          : 'Could not export client configuration. Check the client list and try again.';
      }
    });
    exportConfig.disabled = locked;
    actions.append(copyValue('Copy URL', 'url'), copyValue('Copy Authorization', 'authorization'), exportConfig,
      button('Revoke', async () => { await request('revoke', { clientId: profile.id }); await load(); }));
    return row;
  }));
  const selectedTabLabel = result.selectedTab ? `Selected tab (not connected): ${result.selectedTab.title}` : 'No source tab selected.';
  get('pairing').replaceChildren(...result.pending.map((value: { id: string; code: string; name?: string }) => {
    const { row, actions } = clientRow(`Code: ${value.code} · Client ID: ${value.id}`, value.name);
    actions.classList.add('pairing-actions');
    const information = document.createElement('div'); information.className = 'pairing-info';
    const label = document.createElement('label'), shared = document.createElement('input'); shared.type = 'checkbox'; label.append(shared, ' Include this app in shared tab access');
    if (!automatic) information.append(label);
    else information.textContent = 'Pairing grants no tab access. Afterwards choose AI: Read or Write again in the source tab popup to include this app.';
    row.querySelector('.client-identity')!.append(information);
    const approve = button('Approve pairing', async () => { await request('approve', { clientId: value.id, code: value.code, shared: shared.checked }); await load(); }); approve.className = 'primary-action'; approve.disabled = locked; actions.append(approve, button('Deny', async () => { await request('deny', { clientId: value.id }); await load(); })); return row;
  }));
  if (!result.pending.length) get('pairing').append(emptyState('No pending pairing requests.'));
  const allowWrite = result.settings.mode === 'read-write' && result.allowedModes.includes('read-write');
  const connectionMode = allowWrite ? 'read and write' : 'read only';
  get('connection-mode-note').textContent = allowWrite
    ? 'Connecting grants this client reading and supported actions on the selected tab. The applied write approval setting controls action prompts. Clicks can submit data or cause irreversible changes.'
    : 'Connecting grants this client read-only access to the selected tab. Page actions are unavailable. Apply Read and write mode before connecting if you want to allow actions.';
  get('clients').replaceChildren(...result.clients.map((value: { id: string; name?: string; shared?: boolean; transport?: string; actions?: McpAction[]; addedAt?: number }) => {
    const connection = result.connections.find((connection: { clientId: string }) => connection.clientId === value.id);
    const { row, actions } = clientRow(`Client ID: ${value.id}`, value.name, connection ? `Connected tab: ${connection.tabTitle ?? 'Title unavailable'}` : selectedTabLabel, value.addedAt);
    const connect = button(`Connect selected tab (${connectionMode})`, async () => { const result = await request('connect', { clientId: value.id, sourceId, allowWrite }); status.textContent = `Connected. Give your assistant connectionId: ${result.connectionId}`; await load(); }); connect.disabled = !sourceId;
    connect.setAttribute('aria-describedby', 'connection-mode-note');
    connect.hidden = automatic;
    actions.append(connect, button('Revoke', async () => { clear(); await request('revoke', { clientId: value.id }); await load(); }));
    const editor = document.createElement('details'); editor.className = 'client-name-editor';
    const summary = document.createElement('summary'); summary.textContent = 'Client settings';
    const label = document.createElement('label'); label.textContent = 'Display name';
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 80; input.required = true; input.value = value.name ?? ''; input.placeholder = 'For example, ChatGPT — Firefox'; input.disabled = locked; label.append(input);
    const save = button('Save name', async () => {
      if (!input.reportValidity()) return;
      await request('rename', { clientId: value.id, name: input.value.trim() }); clear(); await load();
      status.textContent = 'Client name saved. Reconnect the selected tab if needed.';
    }); save.disabled = locked;
    const note = document.createElement('p'); note.className = 'note'; note.textContent = "Changing this client's name ends its tab connections. Reconnect the tab after saving.";
    const nameFields = document.createElement('div'); nameFields.className = 'client-name-fields'; nameFields.append(label, save);
    const tools = document.createElement('fieldset'), legend = document.createElement('legend'); tools.className = 'client-action-options'; legend.textContent = 'Allowed actions';
    const choices = document.createElement('div'); choices.className = 'client-action-choices';
    tools.append(legend, choices);
    for (const action of MCP_ACTIONS) {
      const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = action;
      checkbox.checked = (value.actions ?? [...MCP_ACTIONS]).includes(action); checkbox.disabled = locked;
      label.append(checkbox, ` ${{ click: 'Click', fill: 'Fill', 'select-option': 'Select option', 'set-checked': 'Set checked' }[action]}`); choices.append(label);
    }
    const applyActions = button('Save allowed actions', async () => {
      const actions = [...tools.querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value);
      await request('client-actions', { clientId: value.id, actions }); await load();
    }); applyActions.disabled = locked;
    const saveActions = document.createElement('div'); saveActions.className = 'action-group client-action-save'; saveActions.append(applyActions);
    tools.append(saveActions);
    const transportLabel = document.createElement('p'); transportLabel.className = 'note'; transportLabel.textContent = `Transport: ${value.transport === 'hfs' ? 'Local HTTP (HFS)' : 'Native helper'}`;
    row.querySelector('.client-identity')!.append(transportLabel);
    editor.append(summary, nameFields, note, tools); row.append(editor); return row;
  }));
  if (!result.clients.length) get('clients').append(emptyState('No approved clients yet. Pair a client through the helper to get started.'));
  clearInterval(countdownTimer); countdownTimer = undefined;
  get('shared-tabs').replaceChildren(...(result.sharedTabs ?? []).map((tab: { tabRef: string; title: string; mode: string; expires: number | null; connections?: { connectionId: string; name: string; write: boolean; skipPrompts: boolean }[] }) => {
    const row = document.createElement('tr'), title = document.createElement('td'), mode = document.createElement('td'), remaining = document.createElement('td'), action = document.createElement('td');
    title.textContent = tab.title; mode.textContent = tab.mode === 'write' ? 'Write' : 'Read';
    const approvals = document.createElement('td'); approvals.className = 'shared-tab-approvals';
    for (const connection of tab.connections ?? []) {
      const label = document.createElement('label'), checkbox = document.createElement('input'), name = document.createElement('span');
      label.className = 'shared-client-approval'; checkbox.type = 'checkbox'; checkbox.checked = connection.skipPrompts;
      checkbox.disabled = locked || !result.sessionApprovalAllowed || !connection.write || result.paused || result.transport !== 'ready';
      name.textContent = connection.name;
      checkbox.setAttribute('aria-label', `Skip prompts for ${connection.name} in ${tab.title}`);
      checkbox.addEventListener('change', () => {
        checkbox.disabled = true;
        void run(async () => {
          try { await request('connection-approval', { tabRef: tab.tabRef, connectionId: connection.connectionId, skip: checkbox.checked }); await load(); }
          catch (error) { checkbox.checked = connection.skipPrompts; throw error; }
        });
      });
      label.append(checkbox, name); approvals.append(label);
    }
    if (!approvals.childElementCount) approvals.textContent = '—';
    remaining.className = 'shared-tab-remaining';
    if (tab.expires === null) { remaining.textContent = 'Unlimited'; remaining.setAttribute('aria-label', 'Auto-disconnect: Unlimited'); }
    else { remaining.dataset.expires = String(tab.expires); remaining.title = `Expires ${new Date(tab.expires).toLocaleString()}`; }
    action.append(button('Off', async () => { await request('unshare', { tabRef: tab.tabRef }); await load(); }));
    row.append(title, mode, approvals, remaining, action); return row;
  }));
  updateCountdowns();
  if (document.querySelector('#shared-tabs [data-expires]') || hfsState === 'provider-already-connected' && hfsLeaseRetryAt > 0) countdownTimer = setInterval(() => {
    updateCountdowns(); updateHfsStatus();
    if (hfsState === 'provider-already-connected' && hfsLeaseRetryAt > 0 && hfsLeaseRetryAt <= Date.now() && refreshedHfsDeadline !== hfsLeaseRetryAt) {
      refreshedHfsDeadline = hfsLeaseRetryAt; void run(load);
    }
  }, 1000);
  get('source').textContent = result.selectedTab ? `Selected tab: ${result.selectedTab.title}. Navigation or closure requires a new connection.` : 'Open the extension popup on the page you want to share and choose Connect MCP. This settings page is never used as the source.';
  controls();
  clearTimeout(connectionRefresh);
  connectionRefresh = undefined;
  const leaseDue = hfsState === 'provider-already-connected' && hfsLeaseRetryAt > 0 && hfsLeaseRetryAt <= Date.now();
  if (result.transport === 'connecting' || hfsState === 'connecting' || leaseDue && (automatic || refreshedHfsDeadline !== hfsLeaseRetryAt)) {
    if (leaseDue) refreshedHfsDeadline = hfsLeaseRetryAt;
    connectionRefresh = setTimeout(() => { connectionRefresh = undefined; void run(load); }, 500);
  }
}
async function run(action: () => Promise<void>) { try { await action(); } catch (error) {
  if (error instanceof McpUiError && error.code === 'provider-already-connected') {
    clear(); status.textContent = error.message;
    await load().catch(() => {}); return;
  }
  clearTimeout(connectionRefresh); connectionRefresh = undefined; clear(); locked = true; testAllowed = false; appliedEnabled = false; controls(); status.textContent = error instanceof McpUiError ? error.message : unavailableMessage; } }
const markModified = () => { modified = true; clear(); controls(); };
get('preferences').addEventListener('input', markModified);
for (const id of ['native-enabled', 'hfs-enabled', 'hfs-endpoint']) get(id).addEventListener('input', markModified);
get('preferences').addEventListener('submit', event => { event.preventDefault(); const permission = draft().enabled ? requestMcpPermissions(draft().connection !== 'automatic' && draft().mode === 'read-write', draft()) : Promise.resolve(true); void run(async () => { if (!await permission) throw new Error('permission-required'); clear(); await request('apply', { settings: draft(), revision }); modified = false; await load(); status.textContent = automatic ? 'Settings applied. The bridge connects automatically. Choose Read or Write in the popup on the tab you want to share.' : 'Settings applied. Connect the selected tab; use Start helper connection if the helper stays disconnected.'; }); });
get('start').addEventListener('click', () => void run(async () => {
  const granted = await requestMcpPermissions(!automatic && get<HTMLSelectElement>('mode').value === 'read-write', draft());
  if (!granted) throw new Error('permission-required');
  await request('start'); await load();
}));
function saveHfsConfiguration() {
  if (savingHfsConfiguration || locked || !get<HTMLInputElement>('hfs-enabled').checked) return;
  savingHfsConfiguration = true;
  controls();
  const permission = import.meta.env.BROWSER === 'firefox' ? browser.permissions.request({ permissions: ['downloads'] }) : Promise.resolve(true);
  void (async () => {
    try {
      if (!await permission) { status.textContent = 'Allow downloads to save the HFS setup files.'; return; }
      const launcher = hfsLauncher((await browser.runtime.getPlatformInfo()).os);
      if (!launcher) throw new McpUiError('unsupported-hfs-platform');
      const result = await request('hfs-generate', { endpoint: get<HTMLInputElement>('hfs-endpoint').value });
      if (pendingHfsFiles?.configuration === result.content && pendingHfsFiles?.launcher === launcher.filename) {
        hfsConfigurationDownload = pendingHfsFiles.downloadId;
      } else {
        pendingHfsFiles = undefined;
        hfsConfigurationDownload = await downloadBlob(new Blob([result.content], { type: 'text/yaml;charset=utf-8' }), 'config.yaml');
        pendingHfsFiles = { configuration: result.content, launcher: launcher.filename, downloadId: hfsConfigurationDownload };
      }
      get<HTMLButtonElement>('hfs-show-config').disabled = false;
      await downloadBlob(new Blob([launcher.content], { type: 'application/octet-stream' }), launcher.filename);
      pendingHfsFiles = undefined;
      await load();
      status.textContent = 'HFS setup files saved. ' + launcher.filename + ' starts HFS from their folder.'
        + (launcher.needsExecutePermission ? ' Grant the launcher execute permission once; see Setup instructions.' : '');
    } catch (error) {
      const retry = pendingHfsFiles ? ' config.yaml is saved. Try again to download only the launcher.' : ' Try the download again.';
      status.textContent = (isDownloadCancellation(error) ? 'Setup file save cancelled.' : error instanceof McpUiError ? error.message : 'Could not save HFS setup files.') + retry;
    } finally { savingHfsConfiguration = false; controls(); }
  })();
}
get('hfs-generate').addEventListener('click', saveHfsConfiguration);
get('hfs-add-client').addEventListener('click', () => {
  if (addingHttpClient || locked || !get<HTMLInputElement>('hfs-enabled').checked) return;
  addingHttpClient = true; controls();
  void (async () => {
    try {
      await request('hfs-add-client', { endpoint: get<HTMLInputElement>('hfs-endpoint').value, name: get<HTMLInputElement>('hfs-client-name').value.trim() });
      await load();
      status.textContent = 'HTTP client added and authorized. Use Copy URL and Copy Authorization, or Export config.';
    } catch (error) { status.textContent = error instanceof McpUiError ? error.message : 'Could not add HTTP client. Refresh the client list before trying again.'; }
    finally { addingHttpClient = false; controls(); }
  })();
});
get('hfs-show-config').addEventListener('click', () => {
  if (hfsConfigurationDownload === undefined) return;
  void (async () => {
    try {
      const items = await browser.downloads.search({ id: hfsConfigurationDownload });
      if (!items[0]?.exists) throw new Error('file-unavailable');
      const shown: unknown = await browser.downloads.show(hfsConfigurationDownload!);
      if (shown === false) throw new Error('file-unavailable');
    } catch {
      status.textContent = 'Could not show the configuration. It may have been moved or removed. Open its saved folder manually, or generate and save it again.';
    }
  })();
});
get('hfs-import').addEventListener('click', () => void run(async () => {
  const input = get<HTMLInputElement>('hfs-provider-secret'), providerSecret = input.value.trim(); input.value = '';
  await request('hfs-import', { endpoint: get<HTMLInputElement>('hfs-endpoint').value, providerSecret }); await load(); status.textContent = 'Installation joined. Apply Local HTTP settings, then retry HFS.';
}));
get('hfs-reset').addEventListener('click', () => void run(async () => { await request('hfs-reset'); pendingHfsFiles = undefined; hfsConfigurationDownload = undefined; get<HTMLButtonElement>('hfs-show-config').disabled = true; await load(); }));
get('hfs-stop').addEventListener('click', () => void run(async () => { await request('hfs-stop'); await load(); }));
get('hfs-retry').addEventListener('click', () => {
  const permission = requestMcpPermissions(!automatic && draft().mode === 'read-write', { nativeEnabled: false, hfs: { ...draft().hfs!, enabled: true } });
  void run(async () => { if (!await permission) throw new Error('permission-required'); await request('hfs-retry'); await load(); });
});
get('pause').addEventListener('click', () => void run(async () => { await request(get('pause').dataset.paused === 'true' ? 'resume' : 'pause'); await load(); }));
get('stop').addEventListener('click', () => void run(async () => { clear(); await request('stop'); await load(); status.textContent = 'MCP access stopped. Previously delivered data cannot be recalled.'; }));
get('refresh').addEventListener('click', () => void run(load));
get('copy-instance').addEventListener('click', () => {
  const info = get('instance').textContent;
  if (!info) return;
  void (async () => {
    try {
      await navigator.clipboard.writeText(info);
      status.textContent = 'Browser setup info copied.';
    } catch {
      status.textContent = 'Could not copy setup info. Check clipboard access or copy it from Setup and browser instance.';
    }
  })();
});
get('test').addEventListener('click', () => void run(async () => {
  clear(); const ticket = generation;
  const result = await request('test', { sourceId, ...(modified ? { draft: draft() } : {}) });
  if (disposed || ticket !== generation) return;
  capturedRevision = result.revision;
  output.value = JSON.stringify(result.result, null, 2); get('captured').textContent = `${modified ? 'Draft' : 'Applied'} · Captured ${new Date().toLocaleString()} · ${new TextEncoder().encode(output.value).length} bytes. Capture again after page changes.`;
  get<HTMLButtonElement>('copy').disabled = !copyAllowed; get<HTMLButtonElement>('save').disabled = !saveAllowed;
}));
async function authorizeExport(destination: 'copy' | 'save') {
  const current = await request('read');
  if (capturedRevision !== current.revision || !current.testAllowed || !(destination === 'copy' ? current.copyAllowed : current.saveAllowed)) throw new Error('Settings changed.');
}
get('copy').addEventListener('click', () => void run(async () => { if (!copyAllowed || !output.value) return; await authorizeExport('copy'); await navigator.clipboard.writeText(output.value); }));
get('save').addEventListener('click', () => void run(async () => {
  if (!saveAllowed || !output.value) return; await authorizeExport('save');
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([output.value], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = downloadUrl; link.download = 'page-as-context-mcp-preview.json'; link.click();
}));
const changed = (changes: Record<string, unknown>, area: string) => {
  if (area === 'managed' || area === 'local' && ['mcp-settings-v1', 'mcp-clients-v1', 'mcp-hfs-installation-v1', 'popup-settings', 'redaction-filters-v1', 'capture-sources-v1', 'data-controls-v1'].some(key => key in changes)) { clear(); void run(load); }
};
browser.storage.onChanged.addListener(changed);
const stateChanged = (message: unknown, sender: Browser.runtime.MessageSender) => {
  if (!disposed && sender.id === browser.runtime.id && !sender.tab && message && typeof message === 'object' &&
    (message as { type?: unknown }).type === MCP_STATE_CHANGED) { clear(); void run(load); }
};
browser.runtime.onMessage.addListener(stateChanged);
// A tab event can invalidate the initial read while this page is still opening.
const navigation = () => { clear(); void run(load); };
browser.tabs.onUpdated.addListener(navigation); browser.tabs.onRemoved.addListener(navigation);
window.addEventListener('pagehide', () => { disposed = true; clearInterval(countdownTimer); countdownTimer = undefined; clearTimeout(connectionRefresh); connectionRefresh = undefined; clear(); browser.storage.onChanged.removeListener(changed); browser.runtime.onMessage.removeListener(stateChanged); browser.tabs.onUpdated.removeListener(navigation); browser.tabs.onRemoved.removeListener(navigation); if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void run(load);
