// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ api: {} as any, stored: {} as Record<string, unknown>, capture: vi.fn(), action: vi.fn(), snapshots: [] as any[] }));
vi.mock('wxt/browser', () => ({ browser: fixture.api }));
vi.mock('@/src/adapters/capture', () => ({ captureActiveTab: fixture.capture }));
vi.mock('@/src/adapters/actions/snapshot', () => ({ createActionSnapshot: async (tabId: number, lease: any) => {
  const value = { ...lease, tabId, targets: new Map(), run: fixture.action, dispose: vi.fn() }; fixture.snapshots.push(value); return value;
} }));
import { createMcpController } from '@/src/mcp/background';
import type { Browser } from 'wxt/browser';
const event = () => { const listeners = new Set<(...args: any[]) => void>(); return { addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn), emit: (...args: any[]) => { for (const fn of listeners) fn(...args); } }; };
const nativePort = () => ({ onMessage: event(), onDisconnect: event(), postMessage: vi.fn(), disconnect: vi.fn() });
const url = (path: string) => `chrome-extension://test${path}`;
const page = { id: 'extension', url: url('/mcp.html') };
const popup = { id: 'extension', url: url('/popup.html') };
let controller: ReturnType<typeof createMcpController>, port: any;
beforeEach(() => {
  fixture.capture.mockReset();
  fixture.action.mockReset().mockResolvedValue({ status: 'applied' }); fixture.snapshots = [];
  vi.stubEnv('BROWSER', 'chrome');
  fixture.stored = { 'mcp-settings-v1': { version: 1, enabled: true, mode: 'read-only', inherit: true } };
  const changed = event();
  port = nativePort();
  Object.assign(fixture.api, { alarms: { create: vi.fn(async () => {}), clear: vi.fn(async () => true), onAlarm: event() }, action: { setIcon: vi.fn(async () => {}), setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}), setBadgeTextColor: vi.fn(async () => {}), setTitle: vi.fn(async () => {}) }, storage: { managed: { get: vi.fn(async () => ({})) }, local: {
    get: vi.fn(async () => ({ ...fixture.stored })), set: vi.fn(async (values: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: fixture.stored[key], newValue }]));
      Object.assign(fixture.stored, values); changed.emit(changes, 'local');
    }),
  }, onChanged: changed }, runtime: { id: 'extension', getURL: url, getPlatformInfo: vi.fn(async () => ({ os: 'mac' })), connectNative: vi.fn(() => port), sendMessage: vi.fn() },
  permissions: { contains: vi.fn(async () => true), getAll: vi.fn(async () => ({ data_collection: ['websiteContent', 'browsingActivity', 'personalCommunications'] })), request: vi.fn(), onRemoved: event() },
  tabs: { query: vi.fn(async () => [{ id: 7, url: 'https://example.test/' }]), get: vi.fn(async () => ({ id: 7, url: 'https://example.test/' })), create: vi.fn(async () => ({ id: 9 })), remove: vi.fn(async () => {}), onUpdated: event(), onRemoved: event() } });
  fixture.capture.mockResolvedValue({ ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [{ role: 'button', name: 'Synthetic read result', children: [] }] } } });
  controller = createMcpController();
});
afterEach(() => { controller.stop(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function call(tool: string, args: Record<string, unknown> = {}, secret = 'a'.repeat(43), clientId = 'synthetic_client_001') {
  const id = crypto.randomUUID();
  const state = await controller.ui({ action: 'read' }, page);
  port.onMessage.emit({ type: 'request', id, instanceId: state.instanceId, browser: import.meta.env.BROWSER, credentialId: clientId, credentialSecret: secret, request: { tool, arguments: args } });
  await vi.waitFor(() => expect(port.postMessage.mock.calls.some(([value]: any) => value.type === 'result-chunk' && value.id === id)).toBe(true));
  const chunks = port.postMessage.mock.calls.map(([value]: any) => value).filter((value: any) => value.id === id).sort((a: any, b: any) => a.index - b.index);
  return JSON.parse(Buffer.concat(chunks.map((chunk: any) => Buffer.from(chunk.data, 'base64'))).toString());
}
async function connect(allowWrite = false, pairingArgs: Record<string, unknown> = {}, clientId = 'synthetic_client_001', secret = 'a'.repeat(43)) {
  const source = await controller.ui({ action: 'source' }, popup);
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  const pairing = await call('pair', pairingArgs, secret, clientId); expect(pairing.status).toBe('pending');
  await controller.ui({ action: 'approve', clientId, code: pairing.code }, page);
  return controller.ui({ action: 'connect', sourceId: source.sourceId, clientId, allowWrite }, page);
}
it('rejects forged callers and content-script routes', async () => {
  for (const sender of [{ ...page, id: 'other' }, { ...page, url: 'https://example.test/' }, { ...popup, tab: { id: 7 } }]) await expect(controller.ui({ action: 'source' }, sender as Browser.runtime.MessageSender)).rejects.toThrow();
  expect(fixture.capture).not.toHaveBeenCalled();
});

function writeMode(session = false) {
  fixture.stored['mcp-settings-v1'] = { version: 1, enabled: true, mode: 'read-write', inherit: true, writeApproval: session ? 'session' : 'each-action' };
  if (session) fixture.api.storage.managed.get.mockResolvedValue({ McpWriteApproval: 'session' });
  fixture.capture.mockImplementation(async (_tab: unknown, _time: unknown, _selection: unknown, _signal: unknown, controls: any) => ({ ok: true,
    tree: { schemaVersion: 1, root: { role: 'page', children: [{ role: 'button', name: 'Synthetic action', ...(controls.actions ? { actionRef: '11111111-1111-4111-8111-111111111111' } : {}), children: [] }] } } }));
}
it('requires explicit write grant and each-action browser approval, never client approval flags', async () => {
  writeMode(); const grant = await connect(true);
  const snapshot = await call('read_page_context', { connectionId: grant.connectionId });
  const args = { connectionId: grant.connectionId, snapshotId: snapshot.snapshotId, elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() };
  const action = call('click_element', args);
  await vi.waitFor(() => expect(fixture.api.tabs.create.mock.calls.some(([details]: any[]) => details.url.includes('/mcp-approval.html#'))).toBe(true));
  expect(fixture.action).not.toHaveBeenCalled();
  const details = fixture.api.tabs.create.mock.calls.find(([details]: any[]) => details.url.includes('/mcp-approval.html#'))![0];
  fixture.api.tabs.onUpdated.emit(9, { status: 'loading', url: details.url });
  const sender = { id: 'extension', url: details.url, tab: { id: 9 } } as Browser.runtime.MessageSender;
  expect((await controller.ui({ action: 'approval-read' }, sender)).target).toContain('Synthetic action');
  await controller.ui({ action: 'approval-answer', allow: true }, sender);
  expect((await action).status).toBe('applied'); expect(fixture.action).toHaveBeenCalledTimes(1);
  expect((await call('click_element', args)).status).toBe('applied'); expect(fixture.action).toHaveBeenCalledTimes(1);
  expect((await call('click_element', { ...args, approved: true })).error).toBe('invalid-request');
});
it('preserves an applied result when post-action capture fails and denies session mode without a write grant', async () => {
  writeMode(true); const grant = await connect(true);
  const snapshot = await call('read_page_context', { connectionId: grant.connectionId }); fixture.capture.mockRejectedValueOnce(new Error('capture failed'));
  const args = { connectionId: grant.connectionId, snapshotId: snapshot.snapshotId, elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() };
  const result = await call('click_element', args); expect(result.status).toBe('applied'); expect(result.snapshotUnavailable).toBe('post-action-capture-unavailable');
  expect(fixture.snapshots[0].dispose).toHaveBeenCalled();
  const readGrant = await controller.ui({ action: 'connect', sourceId: fixture.api.tabs.create.mock.calls[0][0].url.split('#')[1], clientId: 'synthetic_client_001' }, page);
  expect((await call('click_element', { ...args, connectionId: readGrant.connectionId })).error).toBe('read-only');
});
it('pairing plus explicit source grant allows only that client to read; no arbitrary targets or writes', async () => {
  const connected = await connect();
  expect((await call('read_page_context', { connectionId: connected.connectionId })).context).toContain('Synthetic read result');
  expect(fixture.capture.mock.calls[0]![0].id).toBe(7);
  expect((await call('read_page_context', { connectionId: connected.connectionId }, 'b'.repeat(43))).error).toBe('request-rejected');
  expect((await call('read_page_context', { connectionId: connected.connectionId, tabId: 8 })).error).toBe('invalid-request');
  expect((await call('click_element', { connectionId: connected.connectionId })).error).toBe('invalid-request');
});

it('rejects a validly shaped write request when the connection only grants reading', async () => {
  const grant = await connect();
  expect((await call('click_element', { connectionId: grant.connectionId, snapshotId: crypto.randomUUID(), elementRef: crypto.randomUUID(), operationId: crypto.randomUUID() })).error).toBe('read-only');
  expect(fixture.action).not.toHaveBeenCalled();
  expect(fixture.api.tabs.create.mock.calls.some(([details]: any[]) => details.url.includes('/mcp-approval.html#'))).toBe(false);
});
it('refreshing settings during pending pairing preserves the native port and comparison code', async () => {
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  const pairing = await call('pair'); expect(pairing.status).toBe('pending');
  port.disconnect.mockClear();
  for (let refresh = 0; refresh < 3; refresh++) {
    const state = await controller.ui({ action: 'read' }, page);
    expect(state.transport).toBe('ready');
    expect(state.pending).toEqual([{ id: 'synthetic_client_001', code: pairing.code }]);
  }
  expect(port.disconnect).not.toHaveBeenCalled();
});
it('navigation invalidates grants and Stop cannot be overridden by a cached tool list', async () => {
  const connected = await connect();
  fixture.api.tabs.onUpdated.emit(7, { url: 'https://other.test/' });
  expect((await call('read_page_context', { connectionId: connected.connectionId })).error).toBe('request-rejected');
  await controller.ui({ action: 'stop' }, page);
  expect(port.disconnect).toHaveBeenCalled(); expect(fixture.capture).not.toHaveBeenCalled();
});
it('releases preview registries when a source navigates or the source limit is reached', async () => {
  writeMode();
  const first = await controller.ui({ action: 'source' }, popup);
  await controller.ui({ action: 'test', sourceId: first.sourceId }, page);
  fixture.api.tabs.onUpdated.emit(7, { status: 'loading' });
  expect(fixture.snapshots[0].dispose).toHaveBeenCalledOnce();
  const next = await controller.ui({ action: 'source' }, popup);
  await controller.ui({ action: 'test', sourceId: next.sourceId }, page);
  for (let index = 0; index < 16; index++) await controller.ui({ action: 'source' }, popup);
  expect(fixture.snapshots[1].dispose).toHaveBeenCalledOnce();
});
it('settings changes revoke live grants and no page result reaches persisted storage', async () => {
  const connected = await connect();
  fixture.api.storage.onChanged.emit({ 'redaction-filters-v1': { newValue: {} } }, 'local');
  expect((await call('read_page_context', { connectionId: connected.connectionId })).error).toBe('request-rejected');
  expect(JSON.stringify(fixture.stored)).not.toContain('Synthetic read result');
  expect(JSON.stringify(fixture.stored)).not.toContain('a'.repeat(43));
});

it.each(['revoke', 'rename', 'replace-credential'])('isolates %s to one client while preserving the helper, peer grant and replay protection', async change => {
  writeMode(true);
  const first = await connect(true);
  const firstSnapshot = await call('read_page_context', { connectionId: first.connectionId });
  const secondId = 'synthetic_client_002', secondSecret = 'b'.repeat(43);
  const second = await connect(true, { name: 'Other client' }, secondId, secondSecret);
  expect(fixture.snapshots[0].dispose).not.toHaveBeenCalled();
  expect((await call('get_connection_status', { connectionId: first.connectionId })).mode).toBe('read-write');
  const secondSnapshot = await call('read_page_context', { connectionId: second.connectionId }, secondSecret, secondId);
  const peerAction = { connectionId: second.connectionId, snapshotId: secondSnapshot.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() };
  expect((await call('click_element', peerAction, secondSecret, secondId)).status).toBe('applied');
  if (change === 'revoke') await controller.ui({ action: 'revoke', clientId: 'synthetic_client_001' }, page);
  else if (change === 'rename') await controller.ui({ action: 'rename', clientId: 'synthetic_client_001', name: 'Renamed client' }, page);
  else await fixture.api.storage.local.set({ 'mcp-clients-v1': (fixture.stored['mcp-clients-v1'] as any[]).map(client => client.id === 'synthetic_client_001' ? { ...client, hash: 'b'.repeat(64) } : client) });
  const state = await controller.ui({ action: 'read' }, page);
  expect(state.transport).toBe('ready');
  expect(state.connections!.map((value: any) => value.id)).toEqual([second.connectionId]);
  expect(state.clients).toContainEqual({ id: secondId, name: 'Other client', shared: false });
  if (change === 'revoke') expect(state.clients!.some((client: any) => client.id === 'synthetic_client_001')).toBe(false);
  expect(fixture.snapshots[0].dispose).toHaveBeenCalledOnce();
  expect(port.disconnect).not.toHaveBeenCalled();
  expect(fixture.api.runtime.connectNative).toHaveBeenCalledOnce();
  expect((await call('read_page_context', { connectionId: first.connectionId })).error).toBe('request-rejected');
  expect((await call('click_element', { connectionId: first.connectionId, snapshotId: firstSnapshot.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() })).error).toBe('request-rejected');
  expect((await call('click_element', peerAction, secondSecret, secondId)).status).toBe('applied');
  expect(fixture.action).toHaveBeenCalledOnce();
  expect((await call('read_page_context', { connectionId: second.connectionId }, secondSecret, secondId)).context).toContain('Synthetic action');
});

it('does not start a stopped helper when revoking an approved client', async () => {
  await connect(); controller.stop();
  await controller.ui({ action: 'revoke', clientId: 'synthetic_client_001' }, page);
  expect(fixture.api.runtime.connectNative).toHaveBeenCalledOnce();
  const state = await controller.ui({ action: 'read' }, page);
  expect(state.transport).toBe('disconnected'); expect(state.clients).toEqual([]);
});

it('cancels a revoked client approval while another client can still read', async () => {
  writeMode();
  const first = await connect(true);
  const secondId = 'synthetic_client_002', secondSecret = 'b'.repeat(43);
  const second = await connect(true, {}, secondId, secondSecret);
  const snapshot = await call('read_page_context', { connectionId: first.connectionId });
  const state = await controller.ui({ action: 'read' }, page);
  port.onMessage.emit({ type: 'request', id: crypto.randomUUID(), instanceId: state.instanceId, browser: 'chrome',
    credentialId: 'synthetic_client_001', credentialSecret: 'a'.repeat(43), request: { tool: 'click_element', arguments: {
      connectionId: first.connectionId, snapshotId: snapshot.snapshotId, elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID(),
    } } });
  await vi.waitFor(() => expect(fixture.api.tabs.create.mock.calls.some(([details]: any[]) => details.url.includes('/mcp-approval.html#'))).toBe(true));
  const approvalUrl = fixture.api.tabs.create.mock.calls.find(([details]: any[]) => details.url.includes('/mcp-approval.html#'))![0].url;
  await controller.ui({ action: 'revoke', clientId: 'synthetic_client_001' }, page);
  await expect(controller.ui({ action: 'approval-answer', allow: true }, { id: 'extension', url: approvalUrl, tab: { id: 9 } } as Browser.runtime.MessageSender)).rejects.toThrow('approval-expired');
  expect(fixture.api.tabs.remove).toHaveBeenCalledWith(9);
  expect(fixture.action).not.toHaveBeenCalled(); expect(port.disconnect).not.toHaveBeenCalled();
  expect((await call('read_page_context', { connectionId: second.connectionId }, secondSecret, secondId)).context).toContain('Synthetic action');
});

it('never lets replacement credentials inherit an old grant before a storage notification arrives', async () => {
  const connected = await connect();
  const replacementSecret = 'b'.repeat(43);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(replacementSecret))), byte => byte.toString(16).padStart(2, '0')).join('');
  fixture.stored['mcp-clients-v1'] = [{ id: 'synthetic_client_001', hash }];
  expect((await call('read_page_context', { connectionId: connected.connectionId }, replacementSecret)).error).toBe('request-rejected');
  expect(fixture.capture).not.toHaveBeenCalled();
});

it('rejects a Connect request whose client was revoked while its registry read was pending', async () => {
  await connect();
  const source = await controller.ui({ action: 'source' }, popup);
  const oldClients = fixture.stored['mcp-clients-v1'];
  let finish!: (value: Record<string, unknown>) => void, paused = false;
  fixture.api.storage.local.get.mockImplementation(async (keys: unknown) => {
    if (keys === 'mcp-clients-v1' && !paused) {
      paused = true; return new Promise(resolve => { finish = resolve; });
    }
    return { ...fixture.stored };
  });
  const result = controller.ui({ action: 'connect', sourceId: source.sourceId, clientId: 'synthetic_client_001' }, page)
    .then(() => 'unexpected-success', error => error.message);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await controller.ui({ action: 'revoke', clientId: 'synthetic_client_001' }, page);
  finish({ 'mcp-clients-v1': oldClients });
  expect(await result).toBe('not-connected');
  expect((await controller.ui({ action: 'read' }, page)).connections).toEqual([]);
  expect(port.disconnect).not.toHaveBeenCalled();
});

it('fails closed on a malformed client registry without automatically starting again', async () => {
  await connect();
  await fixture.api.storage.local.set({ 'mcp-clients-v1': [{ id: 'invalid' }] });
  expect(port.disconnect).toHaveBeenCalledOnce();
  expect(fixture.api.runtime.connectNative).toHaveBeenCalledOnce();
  await expect(controller.ui({ action: 'read' }, page)).rejects.toThrow('invalid-clients');
});

it.each([
  ['chrome', 'read-only'], ['chrome', 'read-write'], ['firefox', 'read-only'], ['firefox', 'read-write'],
] as const)('reconnects %s once after applying %s, retaining approval but discarding grants and snapshots', async (browser, mode) => {
  vi.stubEnv('BROWSER', browser);
  fixture.api.permissions.getAll.mockResolvedValue({ data_collection: ['websiteContent', 'browsingActivity', 'personalCommunications', 'websiteActivity'] });
  writeMode(true);
  const connected = await connect(true);
  const snapshot = await call('read_page_context', { connectionId: connected.connectionId });
  const before = await controller.ui({ action: 'read' }, page);
  const previous = port; port = nativePort();
  await controller.ui({ action: 'apply', revision: before.revision,
    settings: { version: 1, enabled: true, mode, inherit: true } }, page);
  await vi.waitFor(() => expect(fixture.api.runtime.connectNative).toHaveBeenCalledTimes(2));
  expect(previous.disconnect).toHaveBeenCalledOnce();
  expect(fixture.snapshots[0].dispose).toHaveBeenCalledOnce();
  port.onMessage.emit({ type: 'ready', protocol: 1 });
  previous.onDisconnect.emit();
  const after = await controller.ui({ action: 'read' }, page);
  expect(after.transport).toBe('ready'); expect(after.clients).toEqual(before.clients);
  expect(after.connections).toEqual([]);
  expect((await call('read_page_context', { connectionId: connected.connectionId })).error).toBe('request-rejected');
  expect((await call('click_element', { connectionId: connected.connectionId, snapshotId: snapshot.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() })).error).toBe('request-rejected');
  expect(fixture.action).not.toHaveBeenCalled(); expect(fixture.capture).toHaveBeenCalledOnce();
  expect(fixture.api.permissions.request).not.toHaveBeenCalled();
});

it.each(['never-started', 'stopped'])('does not auto-start a %s helper when settings are applied', async state => {
  if (state === 'stopped') { await controller.ui({ action: 'start' }, page); controller.stop(); }
  const before = await controller.ui({ action: 'read' }, page);
  await controller.ui({ action: 'apply', revision: before.revision,
    settings: { version: 1, enabled: true, mode: 'read-write', inherit: true } }, page);
  expect(fixture.api.runtime.connectNative).toHaveBeenCalledTimes(state === 'stopped' ? 1 : 0);
  expect((await controller.ui({ action: 'read' }, page)).transport).toBe('disconnected');
});

it('starts Chrome MCP with nativeMessaging and without tabs permission', async () => {
  fixture.api.permissions.contains.mockImplementation(async ({ permissions }: { permissions: string[] }) => !permissions.includes('tabs'));
  await controller.ui({ action: 'start' }, page);
  expect(fixture.api.runtime.connectNative).toHaveBeenCalledOnce();
  expect(fixture.api.permissions.contains).toHaveBeenCalledWith({ permissions: ['nativeMessaging'] });
  expect(fixture.api.permissions.request).not.toHaveBeenCalled();
});

it.each(['disabled', 'native-permission', 'firefox-write-consent', 'policy'])('leaves the helper disconnected after Apply when blocked by %s', async reason => {
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  if (reason === 'native-permission') fixture.api.permissions.contains.mockResolvedValue(false);
  if (reason === 'firefox-write-consent') vi.stubEnv('BROWSER', 'firefox');
  if (reason === 'policy') fixture.api.storage.managed.get.mockResolvedValue({ McpAllowed: false });
  fixture.api.runtime.sendMessage.mockClear();
  await fixture.api.storage.local.set({ 'mcp-settings-v1': {
    version: 1, enabled: reason !== 'disabled', mode: 'read-write', inherit: true,
  } });
  await vi.waitFor(() => expect(fixture.api.runtime.sendMessage).toHaveBeenCalledTimes(2));
  expect(fixture.api.runtime.connectNative).toHaveBeenCalledOnce();
  expect(fixture.api.permissions.request).not.toHaveBeenCalled();
  if (reason === 'policy') await expect(controller.ui({ action: 'read' }, page)).rejects.toThrow('disabled by your administrator');
  else expect((await controller.ui({ action: 'read' }, page)).transport).toBe('disconnected');
});

it.each(['disconnect', 'timeout', 'throw'])('does not retry a failed automatic reconnection after %s', async failure => {
  vi.useFakeTimers();
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  port = nativePort();
  if (failure === 'throw') fixture.api.runtime.connectNative.mockImplementationOnce(() => { throw new Error('native-host-unavailable'); });
  await fixture.api.storage.local.set({ 'mcp-settings-v1': { version: 1, enabled: true, mode: 'read-write', inherit: true } });
  await vi.waitFor(() => expect(fixture.api.runtime.connectNative).toHaveBeenCalledTimes(2));
  if (failure === 'disconnect') port.onDisconnect.emit();
  await vi.advanceTimersByTimeAsync(60000);
  expect(fixture.api.runtime.connectNative).toHaveBeenCalledTimes(2);
  expect((await controller.ui({ action: 'read' }, page)).transport).toBe('disconnected');
});

it.each(['stop', 'permission-removal', 'managed-change'])('cancels pending automatic reconnection on %s', async change => {
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  let finishPlatform!: (value: { os: string }) => void;
  fixture.api.runtime.getPlatformInfo.mockImplementationOnce(() => new Promise(resolve => { finishPlatform = resolve; }));
  await fixture.api.storage.local.set({ 'mcp-settings-v1': { version: 1, enabled: true, mode: 'read-write', inherit: true } });
  await vi.waitFor(() => expect(finishPlatform).toBeTypeOf('function'));
  if (change === 'stop') controller.stop();
  else if (change === 'permission-removal') fixture.api.permissions.onRemoved.emit({ permissions: ['nativeMessaging'] });
  else fixture.api.storage.onChanged.emit({ McpAllowed: { newValue: false } }, 'managed');
  finishPlatform({ os: 'mac' });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(fixture.api.runtime.connectNative).toHaveBeenCalledOnce();
  expect((await controller.ui({ action: 'read' }, page)).transport).toBe('disconnected');
});

it.each([undefined, 'session'] as const)('allows explicit bounded connection approval under policy %s', async policy => {
  writeMode(true);
  fixture.api.storage.managed.get.mockResolvedValue(policy ? { McpWriteApproval: policy } : {});
  expect((await controller.ui({ action: 'read' }, page)).sessionApprovalAllowed).toBe(true);
  const grant = await connect(true);
  const snapshot = await call('read_page_context', { connectionId: grant.connectionId });
  const result = await call('click_element', { connectionId: grant.connectionId, snapshotId: snapshot.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
  expect(result.status).toBe('applied');
  expect(fixture.action).toHaveBeenCalledTimes(1);
  expect(fixture.api.tabs.create.mock.calls.some(([details]: any[]) => details.url.includes('/mcp-approval.html#'))).toBe(false);
  fixture.api.storage.managed.get.mockResolvedValue({ McpWriteApproval: 'each-action' });
  fixture.api.storage.onChanged.emit({ McpWriteApproval: { newValue: 'each-action' } }, 'managed');
  expect((await controller.ui({ action: 'read' }, page)).connections).toEqual([]);
});

it.each(['manual', 'automatic'])('allows connection-scoped approval from the prompt in %s without changing settings', async connection => {
  writeMode();
  let connectionId: string;
  if (connection === 'automatic') {
    await automaticClient(); await share('write');
    connectionId = (await call('list_shared_tabs')).tabs[0].connectionId;
  } else connectionId = (await connect(true)).connectionId!;
  const saved = structuredClone(fixture.stored['mcp-settings-v1']);
  const snapshot = await call('read_page_context', { connectionId });
  const result = call('click_element', { connectionId, snapshotId: snapshot.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
  await vi.waitFor(() => expect(fixture.api.tabs.create.mock.calls.some(([details]: any[]) => details.url.includes('/mcp-approval.html#'))).toBe(true));
  const details = fixture.api.tabs.create.mock.calls.find(([details]: any[]) => details.url.includes('/mcp-approval.html#'))![0];
  const sender = { id: 'extension', url: details.url, tab: { id: 9 } } as Browser.runtime.MessageSender;
  expect((await controller.ui({ action: 'approval-read' }, sender)).sessionApprovalAllowed).toBe(true);
  await controller.ui({ action: 'approval-answer', allow: true, scope: 'connection' }, sender);
  const first = await result;
  expect(first.status).toBe('applied');
  const prompts = fixture.api.tabs.create.mock.calls.length;
  expect((await call('click_element', { connectionId, snapshotId: first.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() })).status).toBe('applied');
  expect(fixture.api.tabs.create.mock.calls).toHaveLength(prompts);
  expect(fixture.stored['mcp-settings-v1']).toEqual(saved);
  fixture.api.tabs.onUpdated.emit(7, { status: 'loading' });
  expect((await call('read_page_context', { connectionId })).error).toBe('request-rejected');
  if (connection === 'automatic') {
    fixture.api.tabs.onUpdated.emit(7, { status: 'complete' });
    const next = (await call('list_shared_tabs')).tabs[0];
    const fresh = await call('read_page_context', { connectionId: next.connectionId });
    const again = call('click_element', { connectionId: next.connectionId, snapshotId: fresh.snapshotId,
      elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
    await vi.waitFor(() => expect(fixture.api.tabs.create.mock.calls.length).toBe(prompts + 1));
    const url = fixture.api.tabs.create.mock.calls.at(-1)![0].url;
    await controller.ui({ action: 'approval-answer', allow: false }, { id: 'extension', url, tab: { id: 9 } } as Browser.runtime.MessageSender);
    expect((await again).error).toBe('approval-denied');
  }
});

it('toggles Skip prompts for only the selected live client/tab connection', async () => {
  writeMode(); await automaticClient(); await automaticClient('synthetic_client_002', 'b'.repeat(43)); await share('write');
  const initial = await controller.ui({ action: 'read' }, page);
  const tab = initial.sharedTabs![0]!, grant = tab.connections[0]!;
  const saved = structuredClone(fixture.stored['mcp-settings-v1']);
  await expect(controller.ui({ action: 'connection-approval', tabRef: tab.tabRef, connectionId: grant.connectionId, skip: true }, popup)).rejects.toThrow('invalid-route');
  await controller.ui({ action: 'connection-approval', tabRef: tab.tabRef, connectionId: grant.connectionId, skip: true }, page);
  const changed = (await controller.ui({ action: 'read' }, page)).sharedTabs![0]!;
  expect(changed.connections.map((value: any) => value.skipPrompts)).toEqual([true, false]);
  expect(changed.expires).toBe(tab.expires); expect(fixture.stored['mcp-settings-v1']).toEqual(saved);
  const fresh = await call('read_page_context', { connectionId: grant.connectionId });
  const action = await call('click_element', { connectionId: grant.connectionId, snapshotId: fresh.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
  expect(action.status).toBe('applied');
  expect(fixture.api.tabs.create.mock.calls.some(([details]: any[]) => details.url.includes('/mcp-approval.html#'))).toBe(false);
  await controller.ui({ action: 'connection-approval', tabRef: tab.tabRef, connectionId: grant.connectionId, skip: false }, page);
  const next = call('click_element', { connectionId: grant.connectionId, snapshotId: action.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
  await vi.waitFor(() => expect(fixture.api.tabs.create.mock.calls.some(([details]: any[]) => details.url.includes('/mcp-approval.html#'))).toBe(true));
  const url = fixture.api.tabs.create.mock.calls.at(-1)![0].url;
  await controller.ui({ action: 'approval-answer', allow: false }, { id: 'extension', url, tab: { id: 9 } } as Browser.runtime.MessageSender);
  expect((await next).error).toBe('approval-denied');
  fixture.api.tabs.onUpdated.emit(7, { status: 'loading' });
  await expect(controller.ui({ action: 'connection-approval', tabRef: tab.tabRef, connectionId: grant.connectionId, skip: true }, page)).rejects.toThrow('not-connected');
});

it.each(['read', 'policy', 'locked', 'save-blocked'])('rejects Skip prompts changes for %s', async reason => {
  await automaticClient(); await share(reason === 'read' ? 'read' : 'write');
  const tab = (await controller.ui({ action: 'read' }, page)).sharedTabs![0]!;
  if (reason === 'policy') fixture.api.storage.managed.get.mockResolvedValue({ McpWriteApproval: 'each-action' });
  if (reason === 'locked') fixture.api.storage.managed.get.mockResolvedValue({ McpSettingsLocked: true });
  if (reason === 'save-blocked') fixture.api.storage.managed.get.mockResolvedValue({ UserPreferencesSaveAllowed: false });
  await expect(controller.ui({ action: 'connection-approval', tabRef: tab.tabRef, connectionId: tab.connections[0]!.connectionId, skip: true }, page)).rejects.toThrow();
  expect((await controller.ui({ action: 'read' }, page)).sharedTabs![0]!.connections.every((connection: any) => !connection.skipPrompts)).toBe(true);
});

it('keeps prompt-granted connection approval isolated from other clients and tabs', async () => {
  writeMode(); await automaticClient(); await automaticClient('synthetic_client_002', 'b'.repeat(43));
  await share('write');
  const first = (await call('list_shared_tabs')).tabs[0];
  const snapshot = await call('read_page_context', { connectionId: first.connectionId });
  const action = call('click_element', { connectionId: first.connectionId, snapshotId: snapshot.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
  await vi.waitFor(() => expect(fixture.api.tabs.create.mock.calls.some(([details]: any[]) => details.url.includes('/mcp-approval.html#'))).toBe(true));
  const url = fixture.api.tabs.create.mock.calls.find(([details]: any[]) => details.url.includes('/mcp-approval.html#'))![0].url;
  await controller.ui({ action: 'approval-answer', allow: true, scope: 'connection' }, { id: 'extension', url, tab: { id: 9 } } as Browser.runtime.MessageSender);
  expect((await action).status).toBe('applied');
  fixture.api.tabs.query.mockResolvedValue([{ id: 8, url: 'https://example.test/' }]);
  fixture.api.tabs.get.mockImplementation(async (id: number) => ({ id, url: 'https://example.test/' }));
  await share('write');
  for (const [client, secret, index] of [['synthetic_client_002', 'b'.repeat(43), 0], ['synthetic_client_001', 'a'.repeat(43), 1]] as const) {
    const grant = (await call('list_shared_tabs', {}, secret, client)).tabs[index];
    const fresh = await call('read_page_context', { connectionId: grant.connectionId }, secret, client);
    const count = fixture.api.tabs.create.mock.calls.length;
    const result = call('click_element', { connectionId: grant.connectionId, snapshotId: fresh.snapshotId,
      elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() }, secret, client);
    await vi.waitFor(() => expect(fixture.api.tabs.create.mock.calls.length).toBe(count + 1));
    const promptUrl = fixture.api.tabs.create.mock.calls.at(-1)![0].url;
    await controller.ui({ action: 'approval-answer', allow: false }, { id: 'extension', url: promptUrl, tab: { id: 9 } } as Browser.runtime.MessageSender);
    expect((await result).error).toBe('approval-denied');
  }
});

it('requires per-action approval under managed policy even if the saved preference requests session approval', async () => {
  writeMode(true);
  fixture.api.storage.managed.get.mockResolvedValue({ McpWriteApproval: 'each-action' });
  expect((await controller.ui({ action: 'read' }, page)).sessionApprovalAllowed).toBe(false);
  const grant = await connect(true);
  const snapshot = await call('read_page_context', { connectionId: grant.connectionId });
  const result = call('click_element', { connectionId: grant.connectionId, snapshotId: snapshot.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
  await vi.waitFor(() => expect(fixture.api.tabs.create.mock.calls.some(([details]: any[]) => details.url.includes('/mcp-approval.html#'))).toBe(true));
  expect(fixture.action).not.toHaveBeenCalled();
  const details = fixture.api.tabs.create.mock.calls.find(([details]: any[]) => details.url.includes('/mcp-approval.html#'))![0];
  const sender = { id: 'extension', url: details.url, tab: { id: 9 } } as Browser.runtime.MessageSender;
  expect((await controller.ui({ action: 'approval-read' }, sender)).sessionApprovalAllowed).toBe(false);
  await expect(controller.ui({ action: 'approval-answer', allow: true, scope: 'connection' }, sender)).rejects.toThrow('policy-blocked');
  expect((await result).error).toBe('approval-denied');
  expect(fixture.action).not.toHaveBeenCalled();
});


it('keeps client names through approval and returns tab titles only to the local settings UI', async () => {
  fixture.api.tabs.get.mockResolvedValue({ id: 7, url: 'https://example.test/', title: 'Local test tab' });
  const grant = await connect(false, { name: 'ChatGPT — Firefox' });
  const source = await controller.ui({ action: 'source' }, popup);
  const state = await controller.ui({ action: 'read', sourceId: source.sourceId }, page);
  expect(state.clients).toEqual([{ id: 'synthetic_client_001', name: 'ChatGPT — Firefox', shared: false }]);
  expect(state.selectedTab).toEqual({ title: 'Local test tab' });
  expect(state.connections![0]).toMatchObject({ id: grant.connectionId, tabTitle: 'Local test tab' });
  expect(JSON.stringify(fixture.stored)).not.toContain('Local test tab');
  expect(JSON.stringify(await call('get_connection_status', { connectionId: grant.connectionId }))).not.toContain('Local test tab');
  const hash = fixture.stored['mcp-clients-v1'];
  await controller.ui({ action: 'rename', clientId: 'synthetic_client_001', name: 'My ChatGPT' }, page);
  expect((await controller.ui({ action: 'read' }, page)).clients![0]!.name).toBe('My ChatGPT');
  expect((fixture.stored['mcp-clients-v1'] as any[])[0].hash).toBe((hash as any[])[0].hash);
});

it('shows a pending client name without treating it as approval or a tab grant', async () => {
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  const pending = await call('pair', { name: 'Named MCP client' });
  const state = await controller.ui({ action: 'read' }, page);
  expect(state.pending).toEqual([{ id: 'synthetic_client_001', code: pending.code, name: 'Named MCP client' }]);
  expect(state.clients).toEqual([]); expect(state.connections).toEqual([]);
  for (const name of ['', 'x'.repeat(81), 'Name\nCode: FAKE']) expect((await call('pair', { name })).error).toBe('request-rejected');
});


it('broadcasts only a metadata-free change notification when pairing arrives and is approved', async () => {
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  fixture.api.runtime.sendMessage.mockClear();
  const pairing = await call('pair', { name: 'ChatGPT — Firefox' });
  expect(fixture.api.runtime.sendMessage.mock.calls).toEqual([[{ type: 'mcp-state-changed-v1' }]]);
  await call('pair');
  expect(fixture.api.runtime.sendMessage).toHaveBeenCalledTimes(1);
  await controller.ui({ action: 'approve', clientId: 'synthetic_client_001', code: pairing.code }, page);
  expect(fixture.api.runtime.sendMessage).toHaveBeenCalledTimes(2);
  expect((await controller.ui({ action: 'read' }, page)).pending).toEqual([]);
});

it('expires pending pairing requests and notifies the open settings page automatically', async () => {
  vi.useFakeTimers();
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  await call('pair');
  fixture.api.runtime.sendMessage.mockClear();
  await vi.advanceTimersByTimeAsync(120001);
  expect((await controller.ui({ action: 'read' }, page)).pending).toEqual([]);
  expect(fixture.api.runtime.sendMessage.mock.calls).toEqual([[{ type: 'mcp-state-changed-v1' }]]);
});

async function share(mode: string) { const state = await controller.ui({ action: 'popup-read' }, popup); return controller.ui({ action: 'share', mode, sourceId: state.sourceId }, popup); }
async function automaticClient(clientId = 'synthetic_client_001', secret = 'a'.repeat(43), shared = true) {
  fixture.stored['mcp-settings-v1'] = { version: 1, enabled: true, connection: 'automatic', mode: 'read-write', inherit: true };
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  const pair = await call('pair', { name: 'Synthetic AI' }, secret, clientId);
  await controller.ui({ action: 'approve', clientId, code: pair.code, shared }, popup);
}
it('defaults new installations to disabled Automatic while legacy settings remain Manual', async () => {
  delete fixture.stored['mcp-settings-v1'];
  expect((await controller.ui({ action: 'read' }, page)).settings).toMatchObject({ enabled: false, connection: 'automatic' });
  fixture.stored['mcp-settings-v1'] = { version: 1, enabled: true, mode: 'read-only', inherit: true };
  expect((await controller.ui({ action: 'popup-read' }, popup)).automatic).toBe(false);
});
it('shares multiple tabs with one client, discovers IDs and does not reveal unshared metadata', async () => {
  await automaticClient();
  fixture.api.tabs.get.mockImplementation(async (id: number) => ({ id, windowId: 1, active: id === 8, title: `Tab ${id}`, url: 'https://example.test/' }));
  await share('read');
  fixture.api.tabs.query.mockResolvedValue([{ id: 8, windowId: 1, active: true, url: 'https://example.test/' }]);
  await share('read');
  const result = await call('list_shared_tabs');
  expect(result.tabs).toHaveLength(2); expect(result.tabs.map((tab: any) => tab.title)).toEqual(['Tab 7', 'Tab 8']);
  expect((await call('read_page_context', { connectionId: result.tabs[1].connectionId })).context).toContain('Synthetic');
  fixture.api.tabs.query.mockResolvedValue([{ id: 99, windowId: 2, active: true, url: 'https://private.test/?secret=hidden', title: 'Private tab' }]);
  const active = await call('resolve_shared_tab', { selector: 'last-focused' });
  expect(active.error).toBe('tab-not-shared'); expect(JSON.stringify(active)).not.toContain('Private');
  expect((await call('resolve_shared_tab', { selector: 'only' })).error).toBe('ambiguous-tab');
});
it('automatically includes paired clients while keeping independent credentials and scoped revocation', async () => {
  await automaticClient(); await share('read');
  await automaticClient('synthetic_client_002', 'b'.repeat(43), false);
  expect((await call('list_shared_tabs', {}, 'b'.repeat(43), 'synthetic_client_002')).tabs).toHaveLength(1);
  const peer = (await call('list_shared_tabs', {}, 'b'.repeat(43), 'synthetic_client_002')).tabs[0];
  await controller.ui({ action: 'revoke', clientId: 'synthetic_client_001' }, page);
  expect((await call('read_page_context', { connectionId: peer.connectionId }, 'b'.repeat(43), 'synthetic_client_002')).context).toContain('Synthetic');
});
it('Off revokes every client on this tab without disconnecting the transport', async () => {
  await automaticClient(); await automaticClient('synthetic_client_002', 'b'.repeat(43));
  await share('write');
  expect((await call('list_shared_tabs')).tabs[0].mode).toBe('read-write');
  await share('off');
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
  expect((await call('list_shared_tabs', {}, 'b'.repeat(43), 'synthetic_client_002')).tabs).toEqual([]);
  expect((await controller.ui({ action: 'popup-read' }, popup)).transport).toBe('ready');
});
it.each(['read', 'write'])('retains Automatic %s through reload and cross-origin navigation without renewing expiry', async mode => {
  await automaticClient(); await share(mode);
  const first = (await call('list_shared_tabs')).tabs[0];
  fixture.api.tabs.onUpdated.emit(7, { status: 'loading' });
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
  fixture.api.tabs.onUpdated.emit(7, { status: 'complete' });
  const next = (await call('list_shared_tabs')).tabs[0];
  expect(next.mode).toBe(mode === 'write' ? 'read-write' : 'read-only');
  expect(next.expiresAt).toBe(first.expiresAt);
  expect(next.connectionId).not.toBe(first.connectionId); expect(next.tabRef).not.toBe(first.tabRef);
  expect((await call('read_page_context', { connectionId: first.connectionId })).error).toBe('request-rejected');
  fixture.api.tabs.onUpdated.emit(7, { status: 'loading', url: 'https://other.test/' });
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
  fixture.api.tabs.get.mockResolvedValue({ id: 7, url: 'https://other.test/' });
  fixture.api.tabs.onUpdated.emit(7, { status: 'complete' });
  const moved = (await call('list_shared_tabs')).tabs[0];
  expect(moved.mode).toBe(next.mode); expect(moved.expiresAt).toBe(first.expiresAt);
  expect(moved.connectionId).not.toBe(next.connectionId);
  expect((await call('read_page_context', { connectionId: moved.connectionId })).context).toContain('Synthetic');
  fixture.api.tabs.query.mockResolvedValue([{ id: 8, url: 'https://other.test/' }]);
  fixture.api.tabs.get.mockImplementation(async (id: number) => ({ id, url: 'https://other.test/' }));
  expect((await controller.ui({ action: 'popup-read' }, popup)).mode).toBe('off');
  expect((await call('list_shared_tabs')).tabs).toHaveLength(1);
});
it('keeps Chrome sharing after activeTab hides metadata across sites, without revealing other targets', async () => {
  await automaticClient(); await share('write');
  const first = (await call('list_shared_tabs')).tabs[0];
  vi.stubGlobal('chrome', { debugger: { getTargets: vi.fn(async () => [
    { type: 'page', tabId: 99, url: 'https://private.test/secret', title: 'Unshared secret' },
    { type: 'page', tabId: 7, url: 'https://other.test/', title: 'Shared destination' },
  ]) } });
  fixture.api.tabs.get.mockResolvedValue({ id: 7, windowId: 1, status: 'complete' });
  fixture.api.tabs.onUpdated.emit(7, { status: 'loading' });
  fixture.api.tabs.onUpdated.emit(7, { status: 'complete' });
  const result = await call('list_shared_tabs');
  expect(result.tabs).toHaveLength(1);
  expect(result.tabs[0]).toMatchObject({ mode: 'read-write', title: 'Shared destination', expiresAt: first.expiresAt });
  expect(JSON.stringify(result)).not.toMatch(/private|secret|https:/);
  expect((await call('read_page_context', { connectionId: first.connectionId })).error).toBe('request-rejected');
  expect((await call('read_page_context', { connectionId: result.tabs[0].connectionId })).context).toContain('Synthetic');
  expect(fixture.capture.mock.calls.at(-1)![0].url).toBe('https://other.test/');
});

it('preserves sharing intent but blocks old grants while Chrome target metadata is unavailable', async () => {
  await automaticClient(); await share('write');
  const first = (await call('list_shared_tabs')).tabs[0];
  const targets = vi.fn().mockRejectedValue(new Error('temporarily unavailable'));
  vi.stubGlobal('chrome', { debugger: { getTargets: targets } });
  fixture.api.tabs.get.mockResolvedValue({ id: 7, status: 'complete' });
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
  expect((await call('read_page_context', { connectionId: first.connectionId })).error).toBe('request-rejected');
  targets.mockResolvedValue([{ type: 'page', tabId: 7, url: 'https://other.test/', title: 'Destination' }]);
  const next = (await call('list_shared_tabs')).tabs[0];
  expect(next).toMatchObject({ mode: 'read-write', expiresAt: first.expiresAt });
  expect(next.connectionId).not.toBe(first.connectionId);
});

it.each(['complete', 'loading'])('retains Write if tabs.get observes navigation before its URL event (%s)', async status => {
  await automaticClient(); await share('write');
  const first = (await call('list_shared_tabs')).tabs[0];
  fixture.api.tabs.get.mockResolvedValue({ id: 7, url: 'https://other.test/', status });
  let tabs = (await call('list_shared_tabs')).tabs;
  if (status === 'loading') {
    expect(tabs).toEqual([]);
    fixture.api.tabs.get.mockResolvedValue({ id: 7, url: 'https://other.test/', status: 'complete' });
    fixture.api.tabs.onUpdated.emit(7, { status: 'complete' });
    tabs = (await call('list_shared_tabs')).tabs;
  }
  expect(tabs).toHaveLength(1);
  expect(tabs[0]).toMatchObject({ mode: 'read-write', expiresAt: first.expiresAt });
  expect(tabs[0].connectionId).not.toBe(first.connectionId);
  expect((await call('read_page_context', { connectionId: first.connectionId })).error).toBe('request-rejected');
  expect((await call('read_page_context', { connectionId: tabs[0].connectionId })).context).toContain('Synthetic');
});

it('invalidates old action snapshots on Automatic navigation and accepts a fresh read on the new site', async () => {
  writeMode(); await automaticClient(); await share('write');
  const first = (await call('list_shared_tabs')).tabs[0];
  const snapshot = await call('read_page_context', { connectionId: first.connectionId });
  fixture.api.tabs.get.mockResolvedValue({ id: 7, url: 'https://other.test/' });
  fixture.api.tabs.onUpdated.emit(7, { url: 'https://other.test/' });
  const next = (await call('list_shared_tabs')).tabs[0];
  expect(fixture.snapshots[0].dispose).toHaveBeenCalled();
  const result = await call('click_element', { connectionId: next.connectionId, snapshotId: snapshot.snapshotId,
    elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
  expect(result).toMatchObject({ status: 'rejected', error: 'stale-snapshot' });
  expect(fixture.action).not.toHaveBeenCalled();
  const fresh = await call('read_page_context', { connectionId: next.connectionId });
  expect(fresh.mode).toBe('read-write'); expect(fresh.snapshotId).not.toBe(snapshot.snapshotId);
});
it.each(['discard', 'close', 'restricted', 'blocked'])('clears Automatic access on %s after navigation changes', async reason => {
  if (reason === 'blocked') fixture.api.storage.managed.get.mockResolvedValue({ BlockedCaptureSources: ['https://blocked.test'] });
  await automaticClient(); await share('write');
  if (reason === 'close') fixture.api.tabs.onRemoved.emit(7);
  else if (reason === 'discard') fixture.api.tabs.onUpdated.emit(7, { discarded: true });
  else {
    const url = reason === 'restricted' ? 'chrome://extensions/' : 'https://blocked.test/';
    fixture.api.tabs.get.mockResolvedValue({ id: 7, url });
    fixture.api.tabs.onUpdated.emit(7, { url, status: 'complete' });
  }
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
});
it('Pause persists, blocks tools and Resume restores only reading', async () => {
  await automaticClient(); await share('write');
  await controller.ui({ action: 'pause' }, popup);
  expect(fixture.stored['mcp-paused-v1']).toBe(true);
  expect((await call('list_shared_tabs')).error).toBe('request-rejected');
  await controller.ui({ action: 'resume' }, popup);
  expect((await call('list_shared_tabs')).tabs[0].mode).toBe('read-only');
});
it('automatically starts the configured bridge and recovers Read after a transport loss', async () => {
  await automaticClient(); await share('write');
  const first = (await call('list_shared_tabs')).tabs[0];
  port.onDisconnect.emit();
  port = nativePort(); fixture.api.runtime.connectNative.mockReturnValue(port);
  await controller.initialize(); port.onMessage.emit({ type: 'ready', protocol: 1 });
  const next = (await call('list_shared_tabs')).tabs[0];
  expect(next.mode).toBe('read-only'); expect(next.connectionId).not.toBe(first.connectionId);
  expect(fixture.api.permissions.request).not.toHaveBeenCalled();
});
it('includes previously paired clients without opt-in and validates discovery arguments', async () => {
  await automaticClient('synthetic_client_001', 'a'.repeat(43), false);
  await share('read');
  expect((await call('list_shared_tabs')).tabs).toHaveLength(1);
  expect((await call('list_shared_tabs', { tabId: 7 })).error).toBe('invalid-request');
  expect((await call('resolve_shared_tab', { selector: 'only', tabRef: crypto.randomUUID() })).error).toBe('invalid-request');
});
it('honors title exclusions in discovery without exposing URLs', async () => {
  fixture.stored['data-controls-v1'] = { includeTitle: false, pageUrl: 'omit', linkUrls: 'omit', includeFormValues: false };
  await automaticClient(); await share('read');
  fixture.api.tabs.get.mockResolvedValue({ id: 7, windowId: 1, title: 'Hidden title', url: 'https://example.test/' });
  const tabs = (await call('list_shared_tabs')).tabs;
  expect(tabs).toHaveLength(1); expect(tabs[0]).not.toHaveProperty('title'); expect(tabs[0]).not.toHaveProperty('url');
});

it('keeps the full-size toolbar icon with contrasting R/W badges and clears them for Off', async () => {
  await automaticClient(); await share('write');
  await vi.waitFor(() => expect(fixture.api.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: 'W' }));
  expect(fixture.api.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ tabId: 7, color: '#E60000' });
  expect(fixture.api.action.setBadgeTextColor).toHaveBeenLastCalledWith({ tabId: 7, color: '#FFFFFF' });
  expect(fixture.api.action.setIcon).toHaveBeenCalledWith({ tabId: 7, path: { 16: '/icon/16.png', 32: '/icon/32.png' } });
  expect(fixture.api.action.setTitle).toHaveBeenCalledWith({ tabId: 7, title: 'Page as Context — AI: Write (read and actions)' });
  await share('read');
  await vi.waitFor(() => expect(fixture.api.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ tabId: 7, color: '#FFFF00' }));
  expect(fixture.api.action.setBadgeTextColor).toHaveBeenLastCalledWith({ tabId: 7, color: '#000000' });
  expect(fixture.api.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: 'R' });
  await share('off');
  await vi.waitFor(() => expect(fixture.api.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: '' }));
  expect(fixture.api.action.setIcon.mock.calls.every(([details]: any) => details.path[16] === '/icon/16.png' && details.path[32] === '/icon/32.png')).toBe(true);
  await vi.waitFor(() => expect(fixture.api.action.setTitle).toHaveBeenLastCalledWith({ tabId: 7, title: 'Page as Context — AI: Off' }));
});
it('binds sharing to the popup source rather than another tab focused during permissions', async () => {
  await automaticClient();
  const selected = await controller.ui({ action: 'popup-read' }, popup);
  fixture.api.tabs.query.mockResolvedValue([{ id: 8, url: 'https://other.test/' }]);
  await controller.ui({ action: 'share', mode: 'read', sourceId: selected.sourceId }, popup);
  expect((await call('list_shared_tabs')).tabs).toHaveLength(1);
  await call('read_page_context', { connectionId: (await call('list_shared_tabs')).tabs[0].connectionId });
  expect(fixture.capture.mock.calls[0]![0].id).toBe(7);
});
it('cannot recreate grants from an in-flight discovery after Off', async () => {
  await automaticClient(); await share('read');
  const state = await controller.ui({ action: 'popup-read' }, popup);
  const instanceId = (await controller.ui({ action: 'read' }, page)).instanceId;
  const originalGet = fixture.api.tabs.get.getMockImplementation();
  let resume!: (value: any) => void;
  fixture.api.tabs.get.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
  const id = crypto.randomUUID();
  port.onMessage.emit({ type: 'request', id, instanceId, browser: 'chrome', credentialId: 'synthetic_client_001', credentialSecret: 'a'.repeat(43), request: { tool: 'list_shared_tabs', arguments: {} } });
  await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
  fixture.api.tabs.get.mockImplementation(originalGet);
  await controller.ui({ action: 'share', mode: 'off', sourceId: state.sourceId }, popup);
  resume({ id: 7, url: 'https://example.test/' });
  await vi.waitFor(() => expect(port.postMessage.mock.calls.some(([value]: any) => value.type === 'result-chunk' && value.id === id)).toBe(true));
  const chunk = port.postMessage.mock.calls.map(([value]: any) => value).find((value: any) => value.id === id);
  expect(JSON.parse(Buffer.from(chunk.data, 'base64').toString()).tabs).toEqual([]);
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
});
it('uses bounded alarm retries and Stop cancels a pending automatic reconnect', async () => {
  await automaticClient();
  port.onDisconnect.emit();
  expect(fixture.api.alarms.create).toHaveBeenCalledWith('mcp-reconnect', expect.objectContaining({ when: expect.any(Number) }));
  await controller.ui({ action: 'stop' }, page);
  const count = fixture.api.runtime.connectNative.mock.calls.length;
  fixture.api.alarms.onAlarm.emit({ name: 'mcp-reconnect' });
  await Promise.resolve(); await Promise.resolve();
  expect(fixture.api.runtime.connectNative).toHaveBeenCalledTimes(count);
  expect(fixture.api.alarms.clear).toHaveBeenCalledWith('mcp-reconnect');
});

it('Deny rejects the current pairing handshake instead of re-creating its approval prompt', async () => {
  fixture.stored['mcp-settings-v1'] = { version: 1, enabled: true, connection: 'automatic', mode: 'read-only', inherit: true };
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  expect((await call('pair')).status).toBe('pending');
  await controller.ui({ action: 'deny', clientId: 'synthetic_client_001' }, popup);
  expect((await call('pair')).status).toBe('rejected');
  expect((await controller.ui({ action: 'popup-read' }, popup)).pending).toEqual([]);
});

it('preserves the explicitly selected popup source when opening advanced output tests', async () => {
  const state = await controller.ui({ action: 'popup-read' }, popup);
  await controller.ui({ action: 'settings', sourceId: state.sourceId }, popup);
  expect(fixture.api.tabs.create).toHaveBeenCalledWith({ url: url('/mcp.html') + '#' + state.sourceId });
  expect(fixture.capture).not.toHaveBeenCalled();
});


it.each(['chrome://extensions/', 'about:addons'])('rejects the protected MCP source %s without opening settings or capturing', async url => {
  fixture.api.tabs.query.mockResolvedValue([{ id: 7, url }]);
  await expect(controller.ui({ action: 'source' }, popup)).rejects.toThrow('unsupported-page');
  expect(fixture.api.tabs.create).not.toHaveBeenCalled(); expect(fixture.capture).not.toHaveBeenCalled();
});


it('enforces Automatic Read only in both popup capabilities and background authorization', async () => {
  await automaticClient();
  fixture.stored['mcp-settings-v1'] = { version: 1, enabled: true, connection: 'automatic', mode: 'read-only', inherit: true };
  expect((await controller.ui({ action: 'popup-read' }, popup)).writeAllowed).toBe(false);
  await expect(share('write')).rejects.toThrow('read-only');
  await share('read');
  expect((await call('list_shared_tabs')).tabs[0].mode).toBe('read-only');
});

it('selects Read before any client exists and grants access only after matching-code approval', async () => {
  fixture.stored['mcp-settings-v1'] = { version: 1, enabled: true, connection: 'automatic', mode: 'read-only', inherit: true };
  await share('read');
  expect((await controller.ui({ action: 'popup-read' }, popup)).mode).toBe('read');
  await vi.waitFor(() => expect(fixture.api.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: 'R' }));
  await vi.waitFor(() => expect(fixture.api.runtime.connectNative).toHaveBeenCalledOnce());
  port.onMessage.emit({ type: 'ready', protocol: 1 });
  expect((await call('list_shared_tabs')).error).toBe('request-rejected');
  const pair = await call('pair', { name: 'New AI' });
  await expect(controller.ui({ action: 'approve', clientId: 'synthetic_client_001', code: 'WRONG' }, popup)).rejects.toThrow('pairing-expired');
  expect((await call('list_shared_tabs')).error).toBe('request-rejected');
  await controller.ui({ action: 'approve', clientId: 'synthetic_client_001', code: pair.code }, popup);
  expect((await call('list_shared_tabs')).tabs).toHaveLength(1);
  expect((await call('list_shared_tabs')).tabs[0].mode).toBe('read-only');
  await share('off');
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
});
it('Manual pairing still grants no tab access until an explicit connection', async () => {
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  const pair = await call('pair');
  await controller.ui({ action: 'approve', clientId: 'synthetic_client_001', code: pair.code }, page);
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
  await expect(share('read')).rejects.toThrow('invalid-request');
});

it('keeps a queued Read when the helper cannot start and expires it without any grants', async () => {
  vi.useFakeTimers();
  fixture.stored['mcp-settings-v1'] = { version: 1, enabled: true, connection: 'automatic', mode: 'read-only', inherit: true };
  fixture.api.runtime.connectNative.mockImplementationOnce(() => { throw new Error('native-host-unavailable'); });
  await share('read');
  await vi.waitFor(() => expect(fixture.api.runtime.connectNative).toHaveBeenCalledOnce());
  expect((await controller.ui({ action: 'popup-read' }, popup)).mode).toBe('read');
  await vi.advanceTimersByTimeAsync(60 * 60000 + 1);
  expect((await controller.ui({ action: 'popup-read' }, popup)).mode).toBe('off');
});

it('Off before approval prevents a subsequently paired client from inheriting that tab', async () => {
  await automaticClient(); await share('read');
  const pair = await call('pair', {}, 'b'.repeat(43), 'synthetic_client_002');
  await share('off');
  await controller.ui({ action: 'approve', clientId: 'synthetic_client_002', code: pair.code }, popup);
  expect((await call('list_shared_tabs', {}, 'b'.repeat(43), 'synthetic_client_002')).tabs).toEqual([]);
});

it('opens an active pairing page once in Automatic and reuses it for another new client', async () => {
  fixture.stored['mcp-settings-v1'] = { version: 1, enabled: true, connection: 'automatic', mode: 'read-only', inherit: true };
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  const first = await call('pair');
  await vi.waitFor(() => expect(fixture.api.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: url('/mcp.html#clients-heading'), active: true }));
  expect((await call('pair')).code).toBe(first.code);
  expect(fixture.api.tabs.create).toHaveBeenCalledTimes(1);
  fixture.api.tabs.get.mockImplementation(async (tabId: number) => tabId === 9 ? { id: 9, url: url('/mcp.html#clients-heading') } : { id: 7, url: 'https://example.test/' });
  fixture.api.tabs.update = vi.fn(async () => ({ id: 9 }));
  await call('pair', {}, 'b'.repeat(43), 'synthetic_client_002');
  await vi.waitFor(() => expect(fixture.api.tabs.update).toHaveBeenCalledExactlyOnceWith(9, { url: url('/mcp.html#clients-heading'), active: true }));
  expect(fixture.api.tabs.create).toHaveBeenCalledTimes(1);
  expect((await call('list_shared_tabs')).error).toBe('request-rejected');
});

it('does not open a pairing page automatically in Manual', async () => {
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  expect((await call('pair')).status).toBe('pending');
  expect(fixture.api.tabs.create).not.toHaveBeenCalled();
});

it('keeps pairing available in MCP settings if automatic tab creation fails', async () => {
  fixture.stored['mcp-settings-v1'] = { version: 1, enabled: true, connection: 'automatic', mode: 'read-only', inherit: true };
  fixture.api.tabs.create.mockRejectedValueOnce(new Error('tab-unavailable'));
  await controller.ui({ action: 'start' }, page); port.onMessage.emit({ type: 'ready', protocol: 1 });
  const pending = await call('pair');
  expect(pending.status).toBe('pending');
  expect((await controller.ui({ action: 'read' }, page)).pending![0]!.code).toBe(pending.code);
});

it('renews only the active tab after a successful read, while discovery and status do not renew', async () => {
  vi.useFakeTimers();
  await automaticClient();
  fixture.api.tabs.get.mockImplementation(async (id: number) => ({ id, url: id === 8 ? 'https://example.test/second' : 'https://example.test/', windowId: 1 }));
  await share('read');
  fixture.api.tabs.query.mockResolvedValue([{ id: 8, url: 'https://example.test/second', windowId: 1 }]);
  await share('read');
  const original = (await call('list_shared_tabs')).tabs;
  const first = original[0], second = original[1];
  vi.setSystemTime(Date.now() + 20 * 60000);
  await call('resolve_shared_tab', { selector: 'active-per-window' });
  expect((await call('get_connection_status', { connectionId: first.connectionId })).expiresAt).toBe(first.expiresAt);
  await call('read_page_context', { connectionId: first.connectionId });
  const next = (await call('list_shared_tabs')).tabs;
  expect(next[0].expiresAt).toBeGreaterThan(first.expiresAt + 19 * 60000);
  expect(next[1].expiresAt).toBe(second.expiresAt);
  vi.setSystemTime(second.expiresAt + 1);
  fixture.api.alarms.onAlarm.emit({ name: 'mcp-expiry' });
  expect((await call('list_shared_tabs')).tabs.map((tab: any) => tab.connectionId)).toEqual([first.connectionId]);
});

it('does not renew after failed reads and rejects access after inactivity expiry', async () => {
  vi.useFakeTimers(); await automaticClient(); await share('read');
  const initial = (await call('list_shared_tabs')).tabs[0];
  vi.setSystemTime(Date.now() + 10 * 60000);
  fixture.capture.mockResolvedValueOnce({ ok: false, error: { code: 'capture-failed' } });
  expect((await call('read_page_context', { connectionId: initial.connectionId })).error).toBeDefined();
  expect((await call('get_connection_status', { connectionId: initial.connectionId })).expiresAt).toBe(initial.expiresAt);
  vi.setSystemTime(initial.expiresAt + 1);
  fixture.api.alarms.onAlarm.emit({ name: 'mcp-expiry' });
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
  expect((await call('read_page_context', { connectionId: initial.connectionId })).error).toBe('request-rejected');
});

it.each(['applied', 'rejected', 'outcome-unknown'] as const)('renews Write only after an applied action: %s', async outcome => {
  vi.useFakeTimers(); writeMode(true); await automaticClient();
  fixture.stored['mcp-settings-v1'] = { ...(fixture.stored['mcp-settings-v1'] as object), writeApproval: 'session' };
  await share('write');
  const connectionId = (await call('list_shared_tabs')).tabs[0].connectionId;
  const snapshot = await call('read_page_context', { connectionId });
  const initial = (await call('get_connection_status', { connectionId })).expiresAt;
  vi.setSystemTime(Date.now() + 10 * 60000);
  fixture.action.mockResolvedValueOnce({ status: outcome });
  const command = { connectionId, snapshotId: snapshot.snapshotId, elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() };
  expect((await call('click_element', command)).status).toBe(outcome);
  const expires = (await call('get_connection_status', { connectionId })).expiresAt;
  if (outcome === 'applied') expect(expires).toBeGreaterThan(initial + 9 * 60000);
  else expect(expires).toBe(initial);
  vi.setSystemTime(Date.now() + 60000);
  await call('click_element', command);
  expect((await call('get_connection_status', { connectionId })).expiresAt).toBe(expires);
});

it('supports unlimited without an expiry alarm, while retaining an organization session cap', async () => {
  vi.useFakeTimers(); await automaticClient();
  fixture.stored['mcp-settings-v1'] = { ...(fixture.stored['mcp-settings-v1'] as object), autoDisconnect: { amount: 1, unit: 'unlimited' } };
  await share('read');
  fixture.api.alarms.create.mockClear();
  const first = (await call('list_shared_tabs')).tabs[0];
  vi.setSystemTime(Date.now() + 90 * 86400000);
  expect((await call('get_connection_status', { connectionId: first.connectionId })).mode).toBe('read-only');
  expect(fixture.api.alarms.create.mock.calls.some(([alarm]: any[]) => alarm === 'mcp-expiry')).toBe(false);
  fixture.api.storage.managed.get.mockResolvedValue({ McpMaxSessionMinutes: 5 });
  await share('read');
  const capped = (await call('list_shared_tabs')).tabs[0];
  vi.setSystemTime(Date.now() + 2 * 60000);
  await call('read_page_context', { connectionId: capped.connectionId });
  expect((await call('get_connection_status', { connectionId: capped.connectionId })).expiresAt).toBe(capped.expiresAt);
  vi.setSystemTime(capped.expiresAt + 1); fixture.api.alarms.onAlarm.emit({ name: 'mcp-expiry' });
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
});

it('does not overflow native timers for a long duration in days', async () => {
  vi.useFakeTimers(); await automaticClient();
  fixture.stored['mcp-settings-v1'] = { ...(fixture.stored['mcp-settings-v1'] as object), autoDisconnect: { amount: 40, unit: 'days' } };
  await share('read');
  const initial = (await call('list_shared_tabs')).tabs[0];
  await vi.advanceTimersByTimeAsync(1000);
  expect((await call('get_connection_status', { connectionId: initial.connectionId })).expiresAt).toBe(initial.expiresAt);
  expect(initial.expiresAt - Date.now()).toBeGreaterThan(39 * 86400000);
});

it('keeps Manual session expiry fixed after a successful read', async () => {
  vi.useFakeTimers(); const connectionId = (await connect()).connectionId;
  const initial = (await call('get_connection_status', { connectionId })).expiresAt;
  vi.setSystemTime(Date.now() + 10 * 60000);
  await call('read_page_context', { connectionId });
  expect((await call('get_connection_status', { connectionId })).expiresAt).toBe(initial);
});

it('renews an applied action even if its post-action capture fails', async () => {
  vi.useFakeTimers(); writeMode(true); await automaticClient();
  fixture.stored['mcp-settings-v1'] = { ...(fixture.stored['mcp-settings-v1'] as object), writeApproval: 'session' };
  await share('write'); const connectionId = (await call('list_shared_tabs')).tabs[0].connectionId;
  const snapshot = await call('read_page_context', { connectionId });
  const initial = (await call('get_connection_status', { connectionId })).expiresAt;
  vi.setSystemTime(Date.now() + 10 * 60000); fixture.capture.mockRejectedValueOnce(new Error('capture-unavailable'));
  const result = await call('click_element', { connectionId, snapshotId: snapshot.snapshotId, elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
  expect(result.status).toBe('applied'); expect(result.snapshotUnavailable).toBe('post-action-capture-unavailable');
  expect((await call('get_connection_status', { connectionId })).expiresAt).toBeGreaterThan(initial + 9 * 60000);
});

it('does not revive Off when an in-flight applied action completes late', async () => {
  writeMode(true); await automaticClient();
  fixture.stored['mcp-settings-v1'] = { ...(fixture.stored['mcp-settings-v1'] as object), writeApproval: 'session' };
  await share('write'); const connectionId = (await call('list_shared_tabs')).tabs[0].connectionId;
  const snapshot = await call('read_page_context', { connectionId });
  let finish!: (value: unknown) => void;
  fixture.action.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const state = await controller.ui({ action: 'read' }, page);
  port.onMessage.emit({ type: 'request', id: crypto.randomUUID(), instanceId: state.instanceId, browser: 'chrome', credentialId: 'synthetic_client_001', credentialSecret: 'a'.repeat(43),
    request: { tool: 'click_element', arguments: { connectionId, snapshotId: snapshot.snapshotId, elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() } } });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await share('off'); finish({ status: 'applied' });
  await vi.waitFor(() => expect(fixture.snapshots[0].dispose).toHaveBeenCalled());
  expect((await call('list_shared_tabs')).tabs).toEqual([]);
  expect((await controller.ui({ action: 'popup-read' }, popup)).mode).toBe('off');
});

it('opens action approval actively in the source window and brings that window forward', async () => {
  writeMode(); const connectionId = (await connect(true)).connectionId;
  fixture.api.tabs.get.mockResolvedValue({ id: 7, url: 'https://example.test/', windowId: 3 });
  fixture.api.windows = { update: vi.fn(async () => ({})) };
  const snapshot = await call('read_page_context', { connectionId });
  fixture.api.tabs.create.mockResolvedValueOnce({ id: 10, windowId: 3 });
  const result = call('click_element', { connectionId, snapshotId: snapshot.snapshotId, elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
  await vi.waitFor(() => expect(fixture.api.windows.update).toHaveBeenCalledWith(3, { focused: true }));
  const details = fixture.api.tabs.create.mock.calls.find(([value]: any[]) => value.url.includes('/mcp-approval.html#'))![0];
  expect(details).toMatchObject({ active: true, windowId: 3 });
  await controller.ui({ action: 'approval-answer', allow: false }, { id: 'extension', url: details.url, tab: { id: 10 } } as Browser.runtime.MessageSender);
  expect((await result).error).toBe('approval-denied');
  expect(fixture.action).not.toHaveBeenCalled();
});

it('distinguishes an unavailable approval tab from a human denial', async () => {
  writeMode(); const connectionId = (await connect(true)).connectionId;
  const snapshot = await call('read_page_context', { connectionId });
  fixture.api.tabs.create.mockRejectedValueOnce(new Error('No window available'));
  const result = await call('click_element', { connectionId, snapshotId: snapshot.snapshotId, elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() });
  expect(result).toMatchObject({ status: 'rejected', error: 'approval-unavailable' });
  expect(fixture.action).not.toHaveBeenCalled();
});

it('reports an expired action prompt as approval-timeout without executing the action', async () => {
  vi.useFakeTimers(); writeMode(); const connectionId = (await connect(true)).connectionId;
  const snapshot = await call('read_page_context', { connectionId });
  const id = crypto.randomUUID(), state = await controller.ui({ action: 'read' }, page);
  port.onMessage.emit({ type: 'request', id, instanceId: state.instanceId, browser: 'chrome', credentialId: 'synthetic_client_001', credentialSecret: 'a'.repeat(43), request: { tool: 'click_element', arguments: {
    connectionId, snapshotId: snapshot.snapshotId, elementRef: '11111111-1111-4111-8111-111111111111', operationId: crypto.randomUUID() } } });
  await vi.waitFor(() => expect(fixture.api.tabs.create.mock.calls.some(([value]: any[]) => value.url.includes('/mcp-approval.html#'))).toBe(true));
  await vi.advanceTimersByTimeAsync(45000);
  const chunks = port.postMessage.mock.calls.map(([value]: any[]) => value).filter((value: any) => value.id === id).sort((a: any, b: any) => a.index - b.index);
  const result = JSON.parse(Buffer.concat(chunks.map((chunk: any) => Buffer.from(chunk.data, 'base64'))).toString());
  expect(result).toMatchObject({ status: 'rejected', error: 'approval-timeout' });
  expect(fixture.action).not.toHaveBeenCalled();
});

it.each(['automatic', 'manual'])('opens the top of MCP settings without capturing a source when MCP is disabled in %s', async connection => {
  fixture.stored['mcp-settings-v1'] = { version: 1, enabled: false, connection, mode: 'read-only', inherit: true };
  fixture.api.tabs.query.mockResolvedValue([{ id: 7, url: 'chrome://extensions/' }]);
  expect(await controller.ui({ action: 'source' }, popup)).toEqual({ ok: true });
  expect(fixture.api.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: url('/mcp.html'), active: true });
  expect(fixture.api.tabs.query).not.toHaveBeenCalled();
  expect(fixture.capture).not.toHaveBeenCalled();
  expect(fixture.api.permissions.request).not.toHaveBeenCalled();
});
