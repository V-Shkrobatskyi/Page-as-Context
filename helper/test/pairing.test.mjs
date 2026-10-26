// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { pairClient } from '../src/pairing.mjs';
import { startBroker, connectSocket } from '../src/broker.mjs';
import { PROTOCOL, secret, createPrivateJson } from '../src/security.mjs';
import { readFrames, writeFrame, resultChunks } from '../src/framing.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pac-pair-'));
  const config = { directory, socket: join(directory, 'broker.sock'), protocol: PROTOCOL, installationId: secret(), hostSecret: secret(), callers: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'] };
  const credential = { protocol: PROTOCOL, browser: 'chrome', instanceId: 'pair_instance_001', credentialId: 'pair_credential_001', secret: secret() };
  await createPrivateJson(join(directory, 'config.json'), config);
  const broker = await startBroker(config);
  t.after(async () => { await broker.close(); await rm(directory, { recursive: true, force: true }); });
  return { config, credential };
}
async function endpoint(t, config, credential, answer, name = `page-as-context-${credential.browser}`) {
  const socket = await connectSocket(config.socket); t.after(() => socket.destroy());
  await new Promise(resolve => {
    readFrames(socket, value => {
      if (value.type === 'ready') return resolve();
      if (value.type !== 'request') return;
      assert.equal(value.request.tool, 'pair'); assert.deepEqual(value.request.arguments, { name });
      assert.equal(value.credentialId, credential.credentialId);
      assert.equal(value.credentialSecret, credential.secret);
      for (const chunk of resultChunks(value.id, answer())) writeFrame(socket, chunk);
    }, () => socket.destroy());
    writeFrame(socket, { type: 'hello', role: 'native', protocol: PROTOCOL, secret: config.hostSecret, caller: config.callers[0], browser: credential.browser, instanceId: credential.instanceId });
  });
}

test('pairing waits for a browser, shows its code and holds the connection until approval', async t => {
  const { config, credential } = await fixture(t), statuses = [];
  let waiting, pending, approved = false, finished = false;
  const wait = new Promise(resolve => { waiting = resolve; }), code = new Promise(resolve => { pending = resolve; });
  const operation = pairClient(config, credential, { connectTimeout: 2000, approvalTimeout: 2000, pollInterval: 10, onStatus(value) {
    statuses.push(value); if (value.status === 'waiting-for-browser') waiting(); if (value.status === 'pending') pending();
  } }).then(() => { finished = true; });
  await wait;
  await endpoint(t, config, credential, () => approved ? { status: 'approved' } : { status: 'pending', code: 'ABCD1234' });
  await code; assert.equal(finished, false); approved = true;
  await operation;
  assert.deepEqual(statuses, [{ status: 'waiting-for-browser' }, { status: 'pending', code: 'ABCD1234' }, { status: 'approved' }]);
});

test('unavailable browser and approval both have bounded, distinct timeouts', async t => {
  const { config, credential } = await fixture(t);
  await assert.rejects(pairClient(config, credential, { connectTimeout: 40, pollInterval: 5 }), /browser-connection-timeout/u);
  await endpoint(t, config, credential, () => ({ status: 'pending', code: 'ABCD1234' }));
  await assert.rejects(pairClient(config, credential, { approvalTimeout: 40, pollInterval: 5 }), /pairing-approval-timeout/u);
});

test('changed pairing code aborts instead of silently changing user confirmation', async t => {
  const { config, credential } = await fixture(t); let calls = 0;
  await endpoint(t, config, credential, () => ({ status: 'pending', code: calls++ ? '1234ABCD' : 'ABCD1234' }));
  await assert.rejects(pairClient(config, credential, { pollInterval: 5 }), /pairing-code-changed/u);
});

test('policy rejection is explicit and never treated as pending', async t => {
  const { config, credential } = await fixture(t);
  await endpoint(t, config, credential, () => ({ error: 'request-rejected' }));
  await assert.rejects(pairClient(config, credential), /pairing-rejected/u);
});

test('CLI rejects an existing credential for a different instance without overwriting or leaking it', async t => {
  const { config, credential } = await fixture(t), path = join(config.directory, 'client.json');
  await createPrivateJson(path, credential); const before = await readFile(path);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'pair', '--directory', config.directory,
      '--browser', 'chrome', '--instance', 'other_instance_001', '--credential', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject); child.once('exit', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /credential-target-mismatch/u); assert.ok(!result.stderr.includes(credential.secret));
  assert.deepEqual(await readFile(path), before);
});


test('pairing transmits an explicit display name without changing credentials', async t => {
  const { config, credential } = await fixture(t);
  await endpoint(t, config, credential, () => ({ status: 'approved' }), 'ChatGPT — Firefox');
  await pairClient(config, credential, { name: 'ChatGPT — Firefox' });
});

test('pairing rejects oversized and control-character names before connecting', async t => {
  const { config, credential } = await fixture(t);
  for (const name of ['', ' ', 'x'.repeat(81), 'Fake\nclient', 'Fake\u202eclient']) {
    await assert.rejects(pairClient(config, credential, { name }), /invalid-client-name/u);
  }
});
