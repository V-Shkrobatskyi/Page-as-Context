// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import './style.css';
import { browser, type Browser } from 'wxt/browser';
import type { CompressionLevel } from '@/src/core/contracts';
import type { McpSettings } from '@/src/mcp/settings';
import type { ExportPreferences } from '@/src/policy/model';
import { requestMcpPermissions } from '@/src/mcp/permissions';
import { MCP_STATE_CHANGED } from '@/src/mcp/ui-events';

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = get('status'), output = get<HTMLTextAreaElement>('output');
const sourceId = location.hash.slice(1);
if (/^[a-zA-Z0-9_-]{16,80}$/u.test(sourceId)) get<HTMLAnchorElement>('filters').href = '/filters.html#return=mcp&source=' + sourceId;
let revision = '', capturedRevision = '', generation = 0, modified = false, disposed = false, appliedEnabled = false, loaded = false;
let locked = true, testAllowed = false, copyAllowed = false, saveAllowed = false;
let fieldLocks = { format: false, compression: false, redaction: false }, savedData: McpSettings['data'];
let downloadUrl: string | undefined;
let connectionRefresh: ReturnType<typeof setTimeout> | undefined;
const unavailableMessage = 'MCP request unavailable. Check permissions, organization policies and the source tab, then refresh.';
const requestErrors = new Map([
  ['source-required', 'The selected tab is missing or expired. Open the extension popup on the page you want to share and choose Connect MCP again.'],
  ['page-changed', 'The selected page changed. Open its extension popup and choose Connect MCP again.'],
  ['not-connected', 'This client has no active helper connection. Refresh status, then use Start helper connection if needed.'],
  ['permission-required', 'Browser permission is required. Use Start helper connection and approve the requested permissions.'],
  ['invalid-source', 'Select a regular HTTP or HTTPS page through the extension popup, then choose Connect MCP.'],
]);
class McpUiError extends Error {
  constructor(code: unknown) { super(typeof code === 'string' ? requestErrors.get(code) ?? unavailableMessage : unavailableMessage); }
}
async function request(action: string, fields: Record<string, unknown> = {}): Promise<any> {
  const result = await browser.runtime.sendMessage({ type: 'mcp-ui-v1', action, ...fields });
  if (!result?.ok) throw new McpUiError(result?.code); return result;
}
function clear() { generation++; capturedRevision = ''; output.value = ''; get('captured').textContent = ''; get<HTMLButtonElement>('copy').disabled = true; get<HTMLButtonElement>('save').disabled = true; }
function draft(): McpSettings {
  return { version: 1, enabled: get<HTMLInputElement>('enabled').checked, mode: get<HTMLSelectElement>('mode').value as McpSettings['mode'],
    writeApproval: get<HTMLSelectElement>('write-approval').value as McpSettings['writeApproval'], inherit: get<HTMLInputElement>('inherit').checked,
    preferences: { format: get<HTMLSelectElement>('format').value as ExportPreferences['format'], compression: get<HTMLSelectElement>('compression').value as CompressionLevel, redactSensitiveData: get<HTMLInputElement>('redact').checked }, ...(savedData ? { data: savedData } : {}) };
}
function controls() {
  for (const id of ['enabled', 'mode', 'inherit', 'apply', 'apply-access', 'write-approval']) get<HTMLInputElement | HTMLButtonElement>(id).disabled = locked;
  for (const id of ['format', 'compression', 'redact']) get<HTMLInputElement>(id).disabled = locked || get<HTMLInputElement>('inherit').checked;
  if (fieldLocks.format) get<HTMLSelectElement>('format').disabled = true;
  if (fieldLocks.compression) get<HTMLSelectElement>('compression').disabled = true;
  if (fieldLocks.redaction) get<HTMLInputElement>('redact').disabled = true;
  get<HTMLButtonElement>('test').disabled = !testAllowed || !sourceId;
  get<HTMLButtonElement>('start').disabled = !appliedEnabled;
  for (const id of ['draft-state', 'draft-state-access']) get(id).textContent = modified ? 'Draft — external sessions still use applied settings' : 'Applied';
}
const button = (text: string, action: () => Promise<void>) => {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
  element.addEventListener('click', () => void run(action)); return element;
};
function clientRow(identity: string, name: string | undefined, tab: string) {
  const row = document.createElement('div'); row.className = 'client-row';
  const label = document.createElement('div'); label.className = 'client-identity';
  const title = document.createElement('strong'); title.className = 'client-name'; title.textContent = name ?? 'Unnamed MCP client';
  const id = document.createElement('span'); id.className = 'client-id'; id.textContent = identity;
  const source = document.createElement('span'); source.className = 'client-tab'; source.textContent = tab;
  label.append(title, id, source);
  const actions = document.createElement('div'); actions.className = 'action-group'; row.append(label, actions);
  return { row, actions };
}
function emptyState(text: string) {
  const element = document.createElement('p'); element.className = 'empty-state'; element.textContent = text; return element;
}
async function load() {
  const ticket = generation, result = await request('read', { sourceId }); if (disposed || ticket !== generation) return;
  revision = result.revision; locked = result.locked; testAllowed = result.testAllowed; copyAllowed = result.copyAllowed; saveAllowed = result.saveAllowed;
  appliedEnabled = result.settings.enabled;
  for (const option of get<HTMLSelectElement>('mode').options) option.disabled = !result.allowedModes.includes(option.value);
  get<HTMLSelectElement>('write-approval').options[1]!.disabled = !result.sessionApprovalAllowed;
  fieldLocks = result.locks; savedData = result.settings.data;
  for (const option of get<HTMLSelectElement>('format').options) option.disabled = !result.allowedFormats.includes(option.value);
  for (const option of get<HTMLSelectElement>('compression').options) option.disabled = !result.allowedCompression.includes(option.value);
  get('managed-filters').textContent = `Required built-in filters: ${result.requiredBuiltinFilters.length ? result.requiredBuiltinFilters.join(', ') : 'none'} · Managed custom rules: ${result.managedRuleCount}. Mandatory rules cannot be disabled here.`;
  get('transport').textContent = `Helper: ${result.transport}`;
  if (!loaded) { status.textContent = result.settings.enabled ? 'MCP is enabled. Connect the helper and select a client for the source tab.' : 'MCP is off. Local output tests remain available when permitted.'; loaded = true; }
  get('instance').textContent = `Browser: ${result.browser} · Instance: ${result.instanceId}`;
  if (!modified) {
    const settings = result.settings as McpSettings, preferences = result.preferences;
    get<HTMLInputElement>('enabled').checked = settings.enabled; get<HTMLInputElement>('inherit').checked = settings.inherit;
    get<HTMLSelectElement>('mode').value = settings.mode;
    get<HTMLSelectElement>('write-approval').value = result.sessionApprovalAllowed ? settings.writeApproval ?? 'each-action' : 'each-action';
    get<HTMLSelectElement>('format').value = preferences.format; get<HTMLSelectElement>('compression').value = preferences.compression;
    get<HTMLInputElement>('redact').checked = preferences.redactSensitiveData;
  }
  const selectedTabLabel = result.selectedTab ? `Selected tab (not connected): ${result.selectedTab.title}` : 'No source tab selected.';
  get('pairing').replaceChildren(...result.pending.map((value: { id: string; code: string; name?: string }) => {
    const { row, actions } = clientRow(`Code: ${value.code} · Client ID: ${value.id}`, value.name, selectedTabLabel);
    const approve = button('Approve pairing', async () => { await request('approve', { clientId: value.id, code: value.code }); await load(); }); approve.disabled = locked; actions.append(approve); return row;
  }));
  if (!result.pending.length) get('pairing').append(emptyState('No pending pairing requests.'));
  const allowWrite = result.settings.mode === 'read-write' && result.allowedModes.includes('read-write');
  const connectionMode = allowWrite ? 'read and write' : 'read only';
  get('connection-mode-note').textContent = allowWrite
    ? 'Connecting grants this client reading and supported actions on the selected tab. The applied write approval setting controls action prompts. Clicks can submit data or cause irreversible changes.'
    : 'Connecting grants this client read-only access to the selected tab. Page actions are unavailable. Apply Read and write mode before connecting if you want to allow actions.';
  get('clients').replaceChildren(...result.clients.map((value: { id: string; name?: string }) => {
    const connection = result.connections.find((connection: { clientId: string }) => connection.clientId === value.id);
    const { row, actions } = clientRow(`Client ID: ${value.id}`, value.name, connection ? `Connected tab: ${connection.tabTitle ?? 'Title unavailable'}` : selectedTabLabel);
    const connect = button(`Connect selected tab (${connectionMode})`, async () => { const result = await request('connect', { clientId: value.id, sourceId, allowWrite }); status.textContent = `Connected. Give your assistant connectionId: ${result.connectionId}`; await load(); }); connect.disabled = !sourceId;
    connect.setAttribute('aria-describedby', 'connection-mode-note');
    actions.append(connect, button('Revoke', async () => { clear(); await request('revoke', { clientId: value.id }); await load(); }));
    const editor = document.createElement('details'); editor.className = 'client-name-editor';
    const summary = document.createElement('summary'); summary.textContent = 'Edit client name';
    const label = document.createElement('label'); label.textContent = 'Display name';
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 80; input.required = true; input.value = value.name ?? ''; input.placeholder = 'For example, ChatGPT — Firefox'; input.disabled = locked; label.append(input);
    const save = button('Save name', async () => {
      if (!input.reportValidity()) return;
      await request('rename', { clientId: value.id, name: input.value.trim() }); clear(); await load();
      status.textContent = 'Client name saved. Reconnect the selected tab if needed.';
    }); save.disabled = locked;
    const note = document.createElement('p'); note.className = 'note'; note.textContent = "Changing this client's name ends its tab connections. Reconnect the tab after saving.";
    editor.append(summary, label, save, note); row.append(editor); return row;
  }));
  if (!result.clients.length) get('clients').append(emptyState('No approved clients yet. Pair a client through the helper to get started.'));
  get('connections').textContent = result.connections.map((value: { id: string; expires: number; mode: string }) => `Connection ${value.id} · ${value.mode} · Expires ${new Date(value.expires).toLocaleTimeString()}`).join('\n');
  get('source').textContent = result.selectedTab ? `Selected tab: ${result.selectedTab.title}. Navigation or closure requires a new connection.` : 'Open the extension popup on the page you want to share and choose Connect MCP. This settings page is never used as the source.';
  controls();
  clearTimeout(connectionRefresh);
  connectionRefresh = undefined;
  if (result.transport === 'connecting') connectionRefresh = setTimeout(() => { connectionRefresh = undefined; void run(load); }, 500);
}
async function run(action: () => Promise<void>) { try { await action(); } catch (error) { clearTimeout(connectionRefresh); connectionRefresh = undefined; clear(); locked = true; testAllowed = false; appliedEnabled = false; controls(); status.textContent = error instanceof McpUiError ? error.message : unavailableMessage; } }
get('preferences').addEventListener('input', () => { modified = true; clear(); controls(); });
get('preferences').addEventListener('submit', event => { event.preventDefault(); void run(async () => { clear(); await request('apply', { settings: draft(), revision }); modified = false; await load(); status.textContent = 'Settings applied. A running helper reconnects once if permissions allow. Reconnect the selected tab; use Start helper connection if the helper stays disconnected.'; }); });
get('start').addEventListener('click', () => void run(async () => {
  const granted = await requestMcpPermissions(get<HTMLSelectElement>('mode').value === 'read-write');
  if (!granted) throw new Error('permission-required');
  await request('start'); await load();
}));
get('stop').addEventListener('click', () => void run(async () => { clear(); await request('stop'); await load(); status.textContent = 'MCP access stopped. Previously delivered data cannot be recalled.'; }));
get('refresh').addEventListener('click', () => void run(load));
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
  if (area === 'managed' || area === 'local' && ['mcp-settings-v1', 'mcp-clients-v1', 'popup-settings', 'redaction-filters-v1', 'capture-sources-v1', 'data-controls-v1'].some(key => key in changes)) { clear(); void run(load); }
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
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(connectionRefresh); connectionRefresh = undefined; clear(); browser.storage.onChanged.removeListener(changed); browser.runtime.onMessage.removeListener(stateChanged); browser.tabs.onUpdated.removeListener(navigation); browser.tabs.onRemoved.removeListener(navigation); if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void run(load);
