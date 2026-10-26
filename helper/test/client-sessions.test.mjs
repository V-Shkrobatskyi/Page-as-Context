// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startBroker, connectSocket } from '../src/broker.mjs';
import { disconnectClient } from '../src/admin-client.mjs';
import { bridgeClient } from '../src/client.mjs';
import { readFrames, writeFrame, resultChunks } from '../src/framing.mjs';
import { PROTOCOL, secret, equal } from '../src/security.mjs';

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Session lifecycle timed out'); await delay(5); }
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pac-sessions-'));
  const caller = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
  const config = { directory, socket: join(directory, 'broker.sock'), installationId: secret(), hostSecret: secret(), callers: [caller] };
  const broker = await startBroker(config);
  t.after(async () => { await broker.close(); await rm(directory, { recursive: true, force: true }); });
  const credential = { protocol: PROTOCOL, instanceId: 'synthetic_instance_001', browser: 'chrome', credentialId: 'synthetic_client_001', secret: secret() };
  const native = await connectSocket(config.socket);
  let ready = false, granted = true;
  const disconnects = [];
  const stop = readFrames(native, message => {
    if (message.type === 'ready') ready = true;
    const authenticated = message.credentialId === credential.credentialId && equal(message.credentialSecret, credential.secret);
    if (message.type === 'client-disconnected') {
      disconnects.push(message);
      if (authenticated) granted = false;
    }
    if (message.type === 'request') for (const chunk of resultChunks(message.id, { allowed: granted && authenticated })) writeFrame(native, chunk);
  }, () => native.destroy());
  t.after(() => { stop(); native.destroy(); });
  writeFrame(native, { type: 'hello', role: 'native', protocol: PROTOCOL, instanceId: credential.instanceId, browser: credential.browser, caller, secret: config.hostSecret });
  await until(() => ready);
  const connect = async (identity = credential) => { const client = await bridgeClient(config, identity); t.after(() => client.close()); return client; };
  return { config, broker, credential, disconnects, connect };
}

test('closing one chat preserves its shared grant until the last matching session closes', async t => {
  const { broker, disconnects, connect } = await fixture(t);
  const first = await connect(), second = await connect();
  first.close();
  await until(() => broker.status().sockets === 2);
  assert.deepEqual(await second.request({ tool: 'read_page_context', arguments: {} }), { allowed: true });
  assert.equal(disconnects.length, 0);
  second.close();
  await until(() => disconnects.length === 1);
});

for (const identity of ['secret', 'credentialId', 'instanceId', 'browser']) {
  test(`a different ${identity} cannot retain another client's grant`, async t => {
    const { broker, credential, disconnects, connect } = await fixture(t);
    const valid = await connect();
    await connect({ ...credential, [identity]: identity === 'browser' ? 'firefox' : secret() });
    valid.close();
    await until(() => broker.status().sockets === 2);
    await until(() => disconnects.some(message => message.credentialId === credential.credentialId && equal(message.credentialSecret, credential.secret)));
  });
}

test('closing a forged-secret session does not revoke an active authenticated session', async t => {
  const { broker, credential, connect } = await fixture(t);
  const valid = await connect(), forged = await connect({ ...credential, secret: secret() });
  forged.close();
  await until(() => broker.status().sockets === 2);
  assert.deepEqual(await valid.request({ tool: 'read_page_context', arguments: {} }), { allowed: true });
});


test('local credential maintenance disconnects all matching sessions and preserves another client', async t => {
  const { config, credential, connect } = await fixture(t);
  const first = await connect(), second = await connect();
  const other = await connect({ ...credential, credentialId: 'unrelated_client_001' });
  await disconnectClient(config, credential);
  await until(() => first.closed && second.closed);
  assert.equal(other.closed, false);
  assert.deepEqual(await other.request({ tool: 'get_connection_status', arguments: {} }), { allowed: false });
});
