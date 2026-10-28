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
  Object.assign(fixture.api, { storage: { managed: { get: vi.fn(async () => ({})) }, local: {
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
afterEach(() => { controller.stop(); vi.useRealTimers(); vi.unstubAllEnvs(); });

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
  expect(state.clients).toContainEqual({ id: secondId, name: 'Other client' });
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
  await controller.ui({ action: 'approval-answer', allow: false }, { id: 'extension', url: details.url, tab: { id: 9 } } as Browser.runtime.MessageSender);
  expect((await result).error).toBe('approval-denied');
  expect(fixture.action).not.toHaveBeenCalled();
});


it('keeps client names through approval and returns tab titles only to the local settings UI', async () => {
  fixture.api.tabs.get.mockResolvedValue({ id: 7, url: 'https://example.test/', title: 'Local test tab' });
  const grant = await connect(false, { name: 'ChatGPT — Firefox' });
  const source = await controller.ui({ action: 'source' }, popup);
  const state = await controller.ui({ action: 'read', sourceId: source.sourceId }, page);
  expect(state.clients).toEqual([{ id: 'synthetic_client_001', name: 'ChatGPT — Firefox' }]);
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
