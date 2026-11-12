// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createRelay } from '../../integrations/hfs/relay.mjs';
import { createAuthentication } from '../../integrations/hfs/auth.mjs';
import { generateHfsConfiguration } from '../../integrations/hfs/config';
import { createHttpDispatcher, type HttpCommand } from '../../src/mcp/dispatcher';
import { validateHfsEndpoint } from '../../src/mcp/hfs-settings';
import { validateMcpSettings } from '../../src/mcp/settings';
import { validatePolicy } from '../../src/policy/model';
vi.mock('wxt/browser', () => ({ browser: {} }));
const auth = createAuthentication(), instanceId = 'browser_instance_0001', clientId = 'http_client_00000001', secret = 'a'.repeat(43), providerSecret = '1'.repeat(64);
const relays: ReturnType<typeof createRelay>[] = [];
afterEach(() => { for (const relay of relays) relay.unload(); relays.length = 0; vi.useRealTimers(); });
function fixture() {
  const relay = createRelay({ endpoint: 'http://127.0.0.1:39861', providerSecret }); relays.push(relay);
  const send = async (path: string, body: unknown = {}, headers: Record<string, string> = {}, method = 'POST') => {
    const requestHeaders: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers };
    const responseHeaders: Record<string, string> = {};
    const ctx: any = { path: '/pac/v1' + path, host: '127.0.0.1:39861', method, querystring: '', req: Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]), res: new EventEmitter(),
      status: 200, get: (key: string) => requestHeaders[key.toLowerCase()] ?? '', set: (key: string, value: string) => { responseHeaders[key.toLowerCase()] = value; }, stop() {}, responseHeaders };
    await relay.middleware(ctx); return ctx;
  };
  const provider = async (path: string, body: unknown, leaseId = '', overrides: Record<string, string> = {}) => {
    const scope = { instanceId, leaseId, nonce: auth.random(), time: Date.now() };
    const fullPath = '/pac/v1/provider/' + path;
    const ctx = await send('/provider/' + path, body, { 'x-pac-instance': instanceId, 'x-pac-lease': leaseId, 'x-pac-nonce': scope.nonce, 'x-pac-time': String(scope.time), 'x-pac-mac': await auth.sign(providerSecret, 'request', fullPath, scope, body), ...overrides });
    if (ctx.responseHeaders['x-pac-mac']) expect(await auth.verify(providerSecret, 'response', fullPath, scope, { status: ctx.status, body: ctx.body }, ctx.responseHeaders['x-pac-mac'])).toBe(true);
    return ctx;
  };
  const register = async () => {
    const challenge = await provider('challenge', { protocolVersion: 1 });
    const registered = await provider('register', { protocolVersion: 1, generation: crypto.randomUUID(), challenge: challenge.body.challenge });
    expect(registered.status).toBe(200); const lease = registered.body.leaseId;
    await provider('control', { clients: [{ id: clientId, hash: await auth.hash(secret) }] }, lease); return lease;
  };
  const consumer = (body: unknown, sessionId?: string, client = clientId, method = 'POST') => send(`/mcp/${instanceId}/${client}`, body, { authorization: 'Bearer ' + secret, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) }, method);
  return { relay, send, provider, register, consumer };
}
it('signs the direction, exact route, instance, lease, nonce, timestamp and body', async () => {
  const scope = { instanceId, leaseId: 'lease', nonce: auth.random(), time: Date.now() }, body = { x: 1 };
  const mac = await auth.sign(providerSecret, 'request', '/a', scope, body);
  expect(await auth.verify(providerSecret, 'request', '/a', scope, body, mac)).toBe(true);
  for (const [direction, path, changed, payload] of [['response', '/a', scope, body], ['request', '/b', scope, body], ['request', '/a', { ...scope, leaseId: 'other' }, body], ['request', '/a', scope, { x: 2 }]] as const)
    expect(await auth.verify(providerSecret, direction, path, changed, payload, mac)).toBe(false);
});
it('uses the pinned source verbatim and generates executable standalone server_code', () => {
  const yaml = generateHfsConfiguration('http://127.0.0.1:39861', providerSecret);
  expect(yaml).toContain('localhost_admin: false'); expect(yaml).toContain('vfs: {}');
  const source = yaml.split('server_code: |\n')[1]!.split('\n').map(line => line.slice(2)).join('\n');
  const exports: any = {};
  new Function('exports', 'require', source)(exports, (name: string) => { expect(name).toBe('node:crypto'); return { webcrypto: crypto }; });
  expect(typeof exports.middleware).toBe('function'); exports.unload();
  expect(source).not.toContain('synthetic-provider');
});
it('fails closed on endpoint/policy/settings migration without enabling HTTP', () => {
  expect(validateMcpSettings({ version: 1, enabled: true, mode: 'read-only', inherit: true }).hfs).toBeUndefined();
  for (const endpoint of ['http://localhost:39861', 'https://127.0.0.1:39861', 'http://127.0.0.1:80', 'http://127.0.0.1:39861/', 'http://example.com:39861']) expect(() => validateHfsEndpoint(endpoint)).toThrow();
  expect(() => validatePolicy({ McpAllowedTransports: ['http'] })).toThrow();
  expect(() => validatePolicy({ McpHfsEndpoint: 'http://example.com:39861' })).toThrow();
});
it('rejects provider impersonation, duplicate registrations and unowned/late replies', async () => {
  const f = fixture(), lease = await f.register();
  expect((await f.provider('poll', {}, lease, { 'x-pac-mac': '0'.repeat(64) })).status).toBe(401);
  const challenge = await f.provider('challenge', {});
  expect((await f.provider('register', { protocolVersion: 1, generation: crypto.randomUUID(), challenge: challenge.body.challenge })).status).toBe(409);
  expect((await f.provider('reply', { ticket: auth.random(), status: 200, body: {} }, lease)).status).toBe(404);
  expect((await f.provider('control', { clients: [] }, 'wrong-lease')).status).toBe(410);
});
it('keeps a normal long poll alive and expires its renewed lease after 45 seconds of inactivity', async () => {
  vi.useFakeTimers();
  const f = fixture(), lease = await f.register();
  await vi.advanceTimersByTimeAsync(20000);
  const poll = f.provider('poll', {}, lease);
  await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2));
  await vi.advanceTimersByTimeAsync(20000);
  expect((await poll).status).toBe(200);
  expect((await f.provider('control', { clients: [] }, lease)).status).toBe(200);
  await vi.advanceTimersByTimeAsync(44999);
  const challenge = await f.provider('challenge', {});
  expect((await f.provider('register', { protocolVersion: 1, generation: crypto.randomUUID(), challenge: challenge.body.challenge })).status).toBe(409);
  await vi.advanceTimersByTimeAsync(1);
  expect((await f.provider('control', { clients: [] }, lease)).status).toBe(410);
  expect(await f.register()).not.toBe(lease);
});
it('routes a request and preserves session headers; never exposes admin, files or external Origins', async () => {
  const f = fixture(), lease = await f.register();
  const pending = f.consumer({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  const poll = await f.provider('poll', {}, lease); const command = poll.body.events[0];
  expect(command.clientId).toBe(clientId); expect(command.instanceId).toBe(instanceId); expect(command.ticket).toMatch(/^[a-f0-9]{64}$/u);
  expect((await f.provider('reply', { ticket: command.ticket, status: 200, sessionId: 'session_000000000001', body: { jsonrpc: '2.0', id: 1, result: {} } }, lease)).status).toBe(200);
  expect((await pending).responseHeaders['mcp-session-id']).toBe('session_000000000001');
  expect((await f.send('/admin', {}, {}, 'GET')).status).toBe(404);
  expect((await f.send('/health', {}, { origin: 'https://evil.test' }, 'GET')).status).toBe(403);
  expect((await f.consumer({}, undefined, clientId, 'GET')).status).toBe(405);
  expect((await f.consumer({}, undefined, 'other_client_0000001')).status).toBe(401);
  expect((await f.send(`/mcp/${instanceId}/${clientId}`, '{}', { authorization: 'Bearer ' + secret, 'content-type': 'text/plain' })).status).toBe(415);
});
it.each([202, 204])('explicitly suppresses the framework body while preserving HTTP %i', async status => {
  const f = fixture(), lease = await f.register();
  const pending = status === 204
    ? f.send(`/mcp/${instanceId}/${clientId}`, {}, { authorization: 'Bearer ' + secret, 'mcp-session-id': 'session_000000000001', accept: '' }, 'DELETE')
    : f.consumer({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'session_000000000001');
  const poll = await f.provider('poll', {}, lease);
  await f.provider('reply', { ticket: poll.body.events[0].ticket, status }, lease);
  const result = await pending;
  expect(result.status).toBe(status); expect(result.body).toBeNull();
});
it('isolates equal IDs in separate sessions and delivers addressed cancel after expiration', async () => {
  const f = fixture(), lease = await f.register();
  const a = f.consumer({ jsonrpc: '2.0', id: 7, method: 'ping' }, 'session_000000000001');
  const b = f.consumer({ jsonrpc: '2.0', id: 7, method: 'ping' }, 'session_000000000002');
  const events = (await f.provider('poll', {}, lease)).body.events;
  expect(events).toHaveLength(2);
  expect((await f.consumer({ jsonrpc: '2.0', id: 7, method: 'ping' }, 'session_000000000001')).status).toBe(409);
  vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(21000); vi.useRealTimers();
  // Existing real request timers are cleaned up by unloading, which must settle both waiters.
  f.relay.unload(); expect((await a).status).toBe(503); expect((await b).status).toBe(503);
  expect((await f.provider('reply', { ticket: events[0].ticket, status: 200 }, lease)).status).toBe(403);
});
it('expires dispatched work, rejects late reply and sends a scoped cancel without replay', async () => {
  vi.useFakeTimers(); const f = fixture(), lease = await f.register();
  const response = f.consumer({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'session_000000000001');
  const command = (await f.provider('poll', {}, lease)).body.events[0];
  await vi.advanceTimersByTimeAsync(20001); expect((await response).status).toBe(504);
  expect((await f.provider('reply', { ticket: command.ticket, status: 200, body: {} }, lease)).status).toBe(404);
  const events = (await f.provider('poll', {}, lease)).body.events;
  expect(events).toEqual([{ type: 'cancel', ticket: command.ticket }]);
});
it('gives grouped writes the 95-second relay deadline instead of the read timeout', async () => {
  vi.useFakeTimers(); const f = fixture(), lease = await f.register();
  const response = f.consumer({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'write_elements', arguments: {} } }, 'session_000000000001');
  const command = (await f.provider('poll', {}, lease)).body.events[0];
  expect(command.deadline - Date.now()).toBe(95000);
  await vi.advanceTimersByTimeAsync(20001);
  expect((await f.provider('reply', { ticket: command.ticket, status: 200, body: { jsonrpc: '2.0', id: 1, result: {} } }, lease)).status).toBe(200);
  expect((await response).status).toBe(200);
});
it('bounds request bodies and rejects replayed provider MACs', async () => {
  const f = fixture(), lease = await f.register();
  expect((await f.consumer({ value: 'x'.repeat(65536) })).status).toBe(413);
  const path = '/pac/v1/provider/control', scope = { instanceId, leaseId: lease, nonce: auth.random(), time: Date.now() }, body = { clients: [] };
  const headers = { 'x-pac-instance': instanceId, 'x-pac-lease': lease, 'x-pac-nonce': scope.nonce, 'x-pac-time': String(scope.time), 'x-pac-mac': await auth.sign(providerSecret, 'request', path, scope, body) };
  expect((await f.send('/provider/control', body, headers)).status).toBe(200);
  expect((await f.send('/provider/control', body, headers)).status).toBe(409);
});
it('reserves bounded capacity for cancellation and DELETE when the client execution queue is full', async () => {
  const f = fixture(), lease = await f.register();
  const calls = [1, 2, 3, 4].map(id => f.consumer({ jsonrpc: '2.0', id, method: 'ping' }, 'session_000000000001'));
  const batch = (await f.provider('poll', {}, lease)).body.events;
  expect(batch).toHaveLength(4);
  expect((await f.consumer({ jsonrpc: '2.0', id: 5, method: 'ping' }, 'session_000000000001')).status).toBe(429);
  const cancel = f.consumer({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }, 'session_000000000001');
  const remove = f.consumer({}, 'session_000000000001', clientId, 'DELETE');
  const controls = (await f.provider('poll', {}, lease)).body.events;
  expect(controls).toHaveLength(2); expect(controls.map((event: any) => event.method)).toContain('DELETE');
  f.relay.unload(); await Promise.all([...calls, cancel, remove]);
});
function command(payload: unknown, sessionId?: string, overrides: Partial<HttpCommand> = {}): HttpCommand {
  return { type: 'request', protocolVersion: 1, instanceId, leaseId: 'relay-lease', generation: 'generation', ticket: auth.random(), clientId, credentialSecret: secret, method: 'POST', sessionId, protocol: sessionId ? '2025-11-25' : undefined, deadline: Date.now() + 20000, payload, ...overrides };
}
it('accepts repeated host reconnects by reclaiming only the same credential’s least recently used idle session', async () => {
  let approved = true;
  const cancel = vi.fn();
  const dispatcher = createHttpDispatcher(instanceId, 'chrome', 'lease', async () => ({ status: approved ? 'approved' : 'pending' }), cancel, '2.2.0');
  const initialize = (overrides: Partial<HttpCommand> = {}) => dispatcher.dispatch(command({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'Test', version: '1' }, capabilities: {} } }, undefined, overrides));
  const ping = (id: string, overrides: Partial<HttpCommand> = {}) => dispatcher.dispatch(command({ jsonrpc: '2.0', id: 2, method: 'ping' }, id, overrides));
  const ids: string[] = [];
  for (let i = 0; i < 8; i++) ids.push((await initialize()).sessionId!);
  approved = false;
  expect((await initialize()).status).toBe(403);
  approved = true;
  expect((await ping(ids[0]!)).status).toBe(200);
  const other = await initialize({ clientId: 'other_client_0000001' });
  for (let i = 0; i < 24; i++) {
    const next = await initialize();
    expect(next.status).toBe(200);
    expect((await ping(next.sessionId!)).status).toBe(200);
    expect((await ping(ids[0]!)).status).toBe(200);
  }
  expect((await ping(ids[1]!)).status).toBe(404);
  expect((await ping(other.sessionId!, { clientId: 'other_client_0000001' })).status).toBe(200);
  expect(cancel).not.toHaveBeenCalled();
  dispatcher.close();
});
it('preserves active requests under session pressure and reclaims capacity once they finish', async () => {
  const cancel = vi.fn();
  const finish: Array<() => void> = [];
  const dispatcher = createHttpDispatcher(instanceId, 'chrome', 'lease', async request => {
    if (request.request.tool === 'pair') return { status: 'approved' };
    return new Promise(resolve => { finish.push(() => resolve({ tabs: [] })); });
  }, cancel, '2.2.0');
  const initialize = () => dispatcher.dispatch(command({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'Test', version: '1' }, capabilities: {} } }));
  const active = [];
  for (let i = 0; i < 8; i++) {
    const init = await initialize();
    await dispatcher.dispatch(command({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId));
    active.push(dispatcher.dispatch(command({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_shared_tabs', arguments: {} } }, init.sessionId)));
  }
  expect(finish).toHaveLength(8);
  expect((await initialize()).status).toBe(429);
  expect(cancel).not.toHaveBeenCalled();
  finish[0]!(); await active[0];
  expect((await initialize()).status).toBe(200);
  expect(cancel).not.toHaveBeenCalled();
  for (const resolve of finish.slice(1)) resolve();
  await Promise.all(active); dispatcher.close();
});
it('keeps the provider session limit across concurrent initializations without evicting another client', async () => {
  const dispatcher = createHttpDispatcher(instanceId, 'chrome', 'lease', async () => ({ status: 'approved' }), vi.fn(), '2.2.0');
  const initialize = (owner: string) => dispatcher.dispatch(command({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'Test', version: '1' }, capabilities: {} } }, undefined, { clientId: owner }));
  const requests = [];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) requests.push(initialize(`client_${i}`));
  const results = await Promise.all(requests);
  expect(results.every(result => result.status === 200)).toBe(true);
  expect((await initialize('new_client')).status).toBe(429);
  expect((await initialize('client_0')).status).toBe(200);
  const ping = (sessionId: string, owner: string) => dispatcher.dispatch(command({ jsonrpc: '2.0', id: 2, method: 'ping' }, sessionId, { clientId: owner }));
  expect((await ping(results[0]!.sessionId!, 'client_0')).status).toBe(404);
  expect((await ping(results[8]!.sessionId!, 'client_1')).status).toBe(200);
  dispatcher.close();
});
it('rejects unapproved HTTP credentials and negotiates owned sessions without pairing tools', async () => {
  let approved = false;
  const execute = vi.fn(async request => request.request.tool === 'pair' ? { status: approved ? 'approved' : 'pending', code: 'ABCDEF00' } : { tools: ['list_shared_tabs'] });
  const dispatcher = createHttpDispatcher(instanceId, 'chrome', 'lease', execute, vi.fn(), '2.2.0');
  const initialize = () => dispatcher.dispatch(command({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01', clientInfo: { name: 'Test', version: '1' }, capabilities: {} } }));
  expect((await initialize()).status).toBe(403);
  approved = true;
  const init = await initialize();
  expect((init.body as any).result.protocolVersion).toBe('2025-11-25'); expect((init.body as any).result.capabilities).toEqual({ tools: {} });
  const sessionId = init.sessionId!;
  await dispatcher.dispatch(command({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId));
  const list = () => dispatcher.dispatch(command({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, sessionId));
  expect((await list()).body).toMatchObject({ result: { tools: [{ name: 'list_shared_tabs' }] } });
  expect((init.body as any).result.instructions).not.toContain('Compare code');
  approved = false; expect((await list()).status).toBe(403);
  approved = true;
  expect((await dispatcher.dispatch(command({ jsonrpc: '2.0', id: 1, method: 'ping' }, sessionId, { clientId: 'other_client_0000001' }))).status).toBe(404);
  expect((await dispatcher.dispatch(command({}, sessionId, { method: 'DELETE' }))).status).toBe(204);
  expect((await list()).status).toBe(404); dispatcher.close();
});
it('cancels only one session even with identical request IDs and validates arguments before execution', async () => {
  const cancel = vi.fn(), execute = vi.fn(async request => {
    if (request.request.tool === 'pair') return { status: 'approved' };
    return new Promise(() => {});
  });
  const dispatcher = createHttpDispatcher(instanceId, 'chrome', 'lease', execute, cancel, '2.2.0');
  const initialize = async () => {
    const init = await dispatcher.dispatch(command({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'Test', version: '1' }, capabilities: {} } }));
    await dispatcher.dispatch(command({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId)); return init.sessionId!;
  };
  const a = await initialize(), b = await initialize();
  const args = { connectionId: 'connection_000000001' }, ca = command({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_page_context', arguments: args } }, a), cb = command(ca.payload, b);
  void dispatcher.dispatch(ca); void dispatcher.dispatch(cb);
  await dispatcher.dispatch(command({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } }, a));
  expect(cancel).toHaveBeenCalledExactlyOnceWith(ca.ticket);
  const invalid = await dispatcher.dispatch(command({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fill_element', arguments: { text: 'x' } } }, b));
  expect(invalid.body).toMatchObject({ error: { code: -32602 } }); dispatcher.close();
});
