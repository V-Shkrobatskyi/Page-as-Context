// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';
const platform = vi.hoisted(() => vi.fn(async () => ({ os: 'mac' })));
vi.mock('wxt/browser', () => ({ browser: { runtime: { getPlatformInfo: platform } } }));
import { hfsTransport, type HfsTransport } from '../../src/mcp/transports/hfs';
import { createAuthentication, type AuthScope } from '../../integrations/hfs/auth.mjs';
const auth = createAuthentication(), instanceId = 'browser_instance_0001', providerSecret = '1'.repeat(64), relayLease = '2'.repeat(64);
const installation = { version: 1 as const, endpoint: 'http://127.0.0.1:39861', providerSecret, clients: [] };
let transport: HfsTransport | undefined;
afterEach(() => { transport?.close(); transport = undefined; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function events() { return { ready: vi.fn(), disconnected: vi.fn(), cancel: vi.fn(), clientDisconnected: vi.fn(), request: vi.fn(async () => ({ status: 'approved' })) }; }
function responder(options: { tamper?: boolean; lateReply?: boolean; forged?: boolean } = {}) {
  let generation = '', polls = 0;
  const calls: { suffix: string; body: any; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>, body = JSON.parse(String(init.body)), path = new URL(url).pathname, suffix = path.split('/').at(-1)!;
    calls.push({ suffix, body, headers });
    const scope: AuthScope = { instanceId: headers['x-pac-instance']!, leaseId: headers['x-pac-lease']!, nonce: headers['x-pac-nonce']!, time: Number(headers['x-pac-time']) };
    expect(await auth.verify(providerSecret, 'request', path, scope, body, headers['x-pac-mac'])).toBe(true);
    expect(headers.Authorization).toBeUndefined(); expect(JSON.stringify(body)).not.toContain(providerSecret);
    let status = 200, result: unknown = {};
    if (suffix === 'challenge') result = { protocolVersion: 1, challenge: auth.random() };
    if (suffix === 'register') { generation = body.generation; result = { protocolVersion: 1, leaseId: relayLease }; }
    if (suffix === 'reply' && options.lateReply) status = 404;
    if (suffix === 'poll') {
      polls++;
      if (polls === 1 && (options.lateReply || options.forged)) result = { events: [{ type: 'request', protocolVersion: 1, instanceId, leaseId: relayLease, generation: options.forged ? 'wrong-generation' : generation,
        ticket: '3'.repeat(64), clientId: 'client_000000000001', credentialSecret: 'a'.repeat(43), method: 'POST', deadline: Date.now() + 20000,
        payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Test', version: '1' } } } }] };
      else return new Promise<Response>((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
    }
    const mac = await auth.sign(providerSecret, 'response', path, scope, { status, body: result });
    return new Response(JSON.stringify(result), { status, headers: { 'x-pac-mac': options.tamper ? '0'.repeat(64) : mac } });
  }));
  return calls;
}
it('authenticates both directions and Stop aborts the pending poll without sending a root bearer', async () => {
  const calls = responder(), callbacks = events();
  transport = await hfsTransport(instanceId, installation, [], callbacks, '2.2.0');
  expect(transport.ready).toBe(true);
  await vi.waitFor(() => expect(calls.some(call => call.suffix === 'poll')).toBe(true));
  transport.close();
  await vi.waitFor(() => expect(calls.some(call => call.suffix === 'control' && call.body.disconnect)).toBe(true));
  expect(transport.ready).toBe(false); expect(callbacks.disconnected).not.toHaveBeenCalled();
});
it('never starts polling when the process on the configured port cannot authenticate', async () => {
  const calls = responder({ tamper: true });
  await expect(hfsTransport(instanceId, installation, [], events(), '2.2.0')).rejects.toThrow('relay-authentication-failed');
  expect(calls.map(call => call.suffix)).toEqual(['challenge']);
});
it('discards a signed late-ticket 404 without disconnecting independent sessions', async () => {
  const calls = responder({ lateReply: true }), callbacks = events();
  transport = await hfsTransport(instanceId, installation, [], callbacks, '2.2.0');
  await vi.waitFor(() => expect(calls.some(call => call.suffix === 'reply')).toBe(true));
  expect(callbacks.disconnected).not.toHaveBeenCalled(); expect(transport.ready).toBe(true);
});
it('rejects a signed command for a stale generation before execution', async () => {
  responder({ forged: true }); const callbacks = events();
  transport = await hfsTransport(instanceId, installation, [], callbacks, '2.2.0');
  await vi.waitFor(() => expect(callbacks.disconnected).toHaveBeenCalledWith('incompatible-relay'));
  expect(callbacks.request).not.toHaveBeenCalled(); expect(transport.ready).toBe(false);
});
