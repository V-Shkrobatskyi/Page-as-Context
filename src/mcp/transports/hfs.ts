// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { browser } from 'wxt/browser';
import { createAuthentication } from '../../../integrations/hfs/auth.mjs';
import { createHttpDispatcher, type HttpCommand, type HttpReply } from '../dispatcher';
import type { ExecutionTransport, TransportEvents } from '../transport';
import type { HfsInstallation } from '../hfs-state';
export interface HfsTransport extends ExecutionTransport { syncClients(clients: { id: string; hash: string }[]): Promise<void>; revoke(clientId: string): void }
/** Authenticated, addressed long polling. Only Stop/recovery may establish a new lease. */
export async function hfsTransport(instanceId: string, installation: HfsInstallation, clients: { id: string; hash: string }[], events: TransportEvents, version: string, startSignal?: AbortSignal): Promise<HfsTransport> {
  const auth = createAuthentication(), abort = new AbortController(), generation = crypto.randomUUID();
  startSignal?.addEventListener('abort', () => abort.abort(), { once: true });
  if (startSignal?.aborted) abort.abort();
  const localLease = crypto.randomUUID();
  let leaseId = '', ready = false, stopped = false;
  const dispatcher = createHttpDispatcher(instanceId, import.meta.env.BROWSER, localLease, events.request, events.cancel, version);
  const request = async (suffix: string, body: unknown, closing = false): Promise<any> => {
    const path = '/pac/v1/provider/' + suffix;
    const scope = { instanceId, leaseId, nonce: auth.random(), time: Date.now() };
    const signal = closing ? AbortSignal.timeout(2000) : AbortSignal.any([abort.signal, AbortSignal.timeout(suffix === 'poll' ? 25000 : 10000)]);
    const response = await fetch(installation.endpoint + path, { method: 'POST', cache: 'no-store', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
      headers: { 'Content-Type': 'application/json', 'x-pac-instance': instanceId, 'x-pac-lease': leaseId, 'x-pac-nonce': scope.nonce, 'x-pac-time': String(scope.time),
        'x-pac-mac': await auth.sign(installation.providerSecret, 'request', path, scope, body) }, body: JSON.stringify(body) });
    let size = 0;
    const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
    if (!reader) throw new Error('incompatible-relay');
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new Error('relay-response-limit');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const joined = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
    if (!await auth.verify(installation.providerSecret, 'response', path, scope, { status: response.status, body: result }, response.headers.get('x-pac-mac'))) throw new Error('relay-authentication-failed');
    if (suffix === 'reply' && response.status === 404) return { discarded: true };
    if (!response.ok) throw new Error(response.status === 409 ? 'provider-already-connected' : 'relay-unavailable');
    return result;
  };
  const end = (reason?: string) => { if (stopped) return; stopped = true; ready = false; abort.abort(); dispatcher.close(); events.disconnected(reason); };
  try {
    const challenge = await request('challenge', { protocolVersion: 1 });
    if (challenge.protocolVersion !== 1 || typeof challenge.challenge !== 'string') throw new Error('incompatible-relay');
    const registered = await request('register', { protocolVersion: 1, generation, challenge: challenge.challenge });
    if (registered.protocolVersion !== 1 || !/^[a-f0-9]{64}$/u.test(registered.leaseId)) throw new Error('incompatible-relay');
    leaseId = registered.leaseId;
    await request('control', { clients });
    ready = true;
  } catch (error) { stopped = true; abort.abort(); dispatcher.close(); throw error; }
  const respond = async (command: HttpCommand) => {
    let reply: HttpReply;
    try { reply = await dispatcher.dispatch(command); }
    catch { reply = { status: 503 }; }
    if (stopped) return;
    try { await request('reply', { ticket: command.ticket, ...reply }); }
    catch (error) { end(error instanceof Error ? error.message : undefined); }
  };
  const poll = async () => {
    try {
      while (!stopped) {
        // Explicit opt-in bridge activity resets Chrome's worker idle timer.
        await browser.runtime.getPlatformInfo();
        const result = await request('poll', {});
        if (!Array.isArray(result.events) || result.events.length > 64) throw new Error('incompatible-relay');
        for (const command of result.events) {
          if (!command || !/^[a-f0-9]{64}$/u.test(command.ticket)) throw new Error('incompatible-relay');
          if (command.type === 'cancel') { events.cancel(command.ticket); continue; }
          if (command.type !== 'request' || command.protocolVersion !== 1 || command.instanceId !== instanceId || command.leaseId !== leaseId || command.generation !== generation ||
            typeof command.deadline !== 'number' || command.deadline <= Date.now() || command.deadline > Date.now() + 100000) throw new Error('incompatible-relay');
          void respond(command);
        }
      }
    } catch (error) { end(error instanceof Error ? error.message : undefined); }
  };
  // The controller installs the route before the first asynchronous poll completes.
  void poll();
  let controls = Promise.resolve();
  return { kind: 'hfs', lease: localLease, get ready() { return ready && !stopped; }, toolsChanged() {},
    async syncClients(next) {
      const work = controls.catch(() => {}).then(async () => { if (!stopped) await request('control', { clients: next }); });
      controls = work; await work;
    },
    revoke(clientId) { dispatcher.revoke(clientId); },
    close() {
      if (stopped) return;
      stopped = true; ready = false; abort.abort(); dispatcher.close();
      void request('control', { disconnect: true }, true).catch(() => {});
    } };
}
