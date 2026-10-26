// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtemp, chmod, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { encode, readFrames, resultChunks, createAssembly, MAX_FRAME, writeFrame } from '../src/framing.mjs';
import { startBroker, connectSocket } from '../src/broker.mjs';
import { bridgeClient } from '../src/client.mjs';
import { nativeHost } from '../src/native.mjs';
import { secret, PROTOCOL, privateJson, createPrivateJson } from '../src/security.mjs';
import { install, uninstall } from '../src/install.mjs';
import { brokerReady } from '../src/startup.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const caller = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const instanceId = 'synthetic_instance_001';
const credentialId = 'synthetic_credential_001';
const credentialSecret = secret();
async function fixture(t, options) {
  const directory = await mkdtemp(join(tmpdir(), 'pac-mcp-')); await chmod(directory, 0o700);
  const config = { protocol: PROTOCOL, directory, socket: join(directory, 'broker.sock'), installationId: secret(), hostSecret: secret(), callers: [caller] };
  await createPrivateJson(join(directory, 'config.json'), config);
  const broker = await startBroker(config, options);
  t.after(async () => { await broker.close(); await rm(directory, { recursive: true, force: true }); });
  return config;
}
async function endpoint(t, config, instance = instanceId, { browser = 'chrome', answer } = {}) {
  const socket = await connectSocket(config.socket);
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const stop = readFrames(socket, message => {
    if (message.type === 'ready') return resolveReady();
    if (message.type !== 'request') return;
    if (answer === false) return;
    if (typeof answer === 'function') return answer(message, socket);
    const allowed = message.credentialId === credentialId && message.credentialSecret === credentialSecret;
    for (const chunk of resultChunks(message.id, allowed ? { ok: true, nonce: message.request.arguments.nonce, instanceId: instance, browser } : { ok: false })) writeFrame(socket, chunk);
  }, () => socket.destroy());
  t.after(() => { stop(); socket.destroy(); });
  writeFrame(socket, { type: 'hello', protocol: PROTOCOL, role: 'native', instanceId: instance, browser, caller, secret: config.hostSecret });
  await ready; return socket;
}
const credential = (instance = instanceId) => ({ protocol: PROTOCOL, instanceId: instance, browser: 'chrome', credentialId, secret: credentialSecret });

test('framing handles fragmented UTF-8 and coalesced messages', () => {
  const stream = new PassThrough(); const values = [];
  const stop = readFrames(stream, value => values.push(value), () => assert.fail('frame error'));
  const payload = Buffer.concat([encode({ text: 'Hello 🌍' }), encode({ ok: true })]);
  for (const byte of payload) stream.write(Buffer.from([byte]));
  assert.deepEqual(values, [{ text: 'Hello 🌍' }, { ok: true }]); stop();
});
test('framing rejects oversized headers before buffering body and truncated input', () => {
  for (const bytes of [encode({ text: 'x' }).subarray(0, 6), Buffer.from([0xff, 0xff, 0xff, 0x7f])]) {
    const stream = new PassThrough(); let failed = false;
    readFrames(stream, () => assert.fail(), () => { failed = true; });
    stream.end(bytes); stream.emit('end'); assert.equal(failed, true);
  }
  assert.throws(() => encode({ text: 'x'.repeat(MAX_FRAME) }), /frame-limit/u);
});
test('chunk assembly preserves multi-byte values and rejects ordering and size attacks', () => {
  const value = { text: 'é'.repeat(180000) }; const chunks = resultChunks('a', value); const assemble = createAssembly();
  let result; for (const chunk of chunks) result = assemble(chunk);
  assert.deepEqual(result, value);
  assert.throws(() => createAssembly()(chunks[1]), /invalid-chunk/u);
  assert.throws(() => createAssembly()({ index: 0, total: 10000, data: '' }), /invalid-chunk/u);
  assert.throws(() => resultChunks('a', { text: 'x'.repeat(4 * 1024 * 1024) }), /response-limit/u);
});
test('broker round trip isolates instance routes, rejects credentials at the browser endpoint', async t => {
  const config = await fixture(t); await endpoint(t, config);
  const client = await bridgeClient(config, credential()); t.after(() => client.close());
  assert.equal((await client.request({ arguments: { nonce: 'synthetic_nonce_001' } })).nonce, 'synthetic_nonce_001');
  const other = await bridgeClient(config, credential('synthetic_instance_002')); t.after(() => other.close());
  await assert.rejects(other.request({ arguments: { nonce: 'synthetic_nonce_002' } }), /not-connected/u);
  const invalid = await bridgeClient(config, { ...credential(), secret: secret() }); t.after(() => invalid.close());
  assert.deepEqual(await invalid.request({ arguments: { nonce: 'synthetic_nonce_003' } }), { ok: false });
});
test('disconnect drops pending requests and timeout cancels a stalled endpoint', async t => {
  const config = await fixture(t, { requestTimeout: 50 }); const native = await endpoint(t, config, instanceId, { answer: false });
  const client = await bridgeClient(config, credential()); t.after(() => client.close());
  await assert.rejects(client.request({ arguments: {} }), /capture-timeout/u);
  const pending = client.request({ arguments: {} }); native.destroy();
  await assert.rejects(pending, /not-connected/u);
});
test('tool-list changes are routed only to the selected instance and credential', async t => {
  const config = await fixture(t), native = await endpoint(t, config);
  const client = await bridgeClient(config, credential()); t.after(() => client.close());
  const other = await bridgeClient(config, { ...credential(), credentialId: 'other_credential_002' }); t.after(() => other.close());
  let changes = 0; other.onToolsChanged(() => { changes++; });
  let received; const event = new Promise(resolve => { received = resolve; }); client.onToolsChanged(received);
  writeFrame(native, { type: 'tools-changed', credentialId });
  await event; assert.equal(changes, 0);
});
test('unknown native caller and duplicate instance never replace a live endpoint', async t => {
  const config = await fixture(t); await endpoint(t, config);
  await assert.rejects(nativeHost(config, 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/'), /unknown-caller/u);
  const socket = await connectSocket(config.socket);
  const closed = new Promise(resolve => socket.once('close', resolve));
  writeFrame(socket, { type: 'hello', protocol: PROTOCOL, role: 'native', instanceId, browser: 'chrome', caller, secret: secret() });
  socket.resume(); await closed;
  const client = await bridgeClient(config, credential()); t.after(() => client.close());
  assert.equal((await client.request({ arguments: { nonce: 'synthetic_nonce_004' } })).ok, true);
  await assert.rejects(startBroker(config), { code: 'EADDRINUSE' });
});
test('native host translates browser framing through IPC without page content', async t => {
  const config = await fixture(t); const input = new PassThrough(), output = new PassThrough();
  let readyResolve; const ready = new Promise(resolve => { readyResolve = resolve; });
  const stopOutput = readFrames(output, message => {
    if (message.type === 'ready') return readyResolve();
    if (message.type === 'request') for (const chunk of resultChunks(message.id, { ok: true })) input.write(encode(chunk));
  }, () => assert.fail('native framing failed'));
  const stop = await nativeHost(config, caller, input, output); t.after(() => { stop(); stopOutput(); });
  input.write(encode({ type: 'register', protocol: PROTOCOL, browser: 'chrome', instanceId })); await ready;
  const client = await bridgeClient(config, credential()); t.after(() => client.close());
  assert.deepEqual(await client.request({ tool: 'transport_probe', arguments: {} }), { ok: true });
});
test('SDK client launches actual stdio helper, negotiates supported protocol and calls through broker', async t => {
  const config = await fixture(t); await endpoint(t, config);
  const path = join(config.directory, 'client.json'); await createPrivateJson(path, credential());
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../src/cli.mjs', import.meta.url).pathname, 'spike-stdio', '--directory', config.directory, '--credential', path], stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-sdk-client', version: '1' }); t.after(() => client.close());
  await client.connect(transport);
  assert.equal(client.getServerVersion().name, 'page-as-context-transport-spike');
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['transport_probe']);
  const result = await client.callTool({ name: 'transport_probe', arguments: { nonce: 'synthetic_nonce_005' } });
  assert.equal(JSON.parse(result.content[0].text).nonce, 'synthetic_nonce_005');
  await assert.rejects(client.callTool({ name: 'transport_probe', arguments: { nonce: 'synthetic_nonce_005', tabId: 1 } }));
});
test('production tool discovery is stable before a write grant and browser rejection still applies', async t => {
  const config = await fixture(t);
  await endpoint(t, config, instanceId, { answer: (message, socket) => {
    const result = message.request.tool === 'list-tools' ? { tools: ['get_connection_status', 'read_page_context'] } : { error: 'read-only' };
    for (const chunk of resultChunks(message.id, result)) writeFrame(socket, chunk);
  } });
  const path = join(config.directory, 'client.json'); await createPrivateJson(path, credential());
  const client = new Client({ name: 'stable-catalog-test', version: '1' }); t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../src/cli.mjs', import.meta.url).pathname, 'stdio', '--directory', config.directory, '--credential', path], stderr: 'pipe' }));
  const discovered = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(discovered.includes('click_element')); assert.ok(discovered.includes('fill_element'));
  const result = await client.callTool({ name: 'click_element', arguments: { connectionId: randomUUID(), snapshotId: randomUUID(), elementRef: randomUUID(), operationId: randomUUID() } });
  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), { error: 'read-only' });
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), discovered);
});
test('SDK write reports unknown outcome when the native endpoint loses its reply', async t => {
  const config = await fixture(t);
  let received = 0;
  await endpoint(t, config, instanceId, { answer: (_message, socket) => { received++; socket.destroy(); } });
  const path = join(config.directory, 'client.json'); await createPrivateJson(path, credential());
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../src/cli.mjs', import.meta.url).pathname, 'stdio', '--directory', config.directory, '--credential', path], stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-write-client', version: '1' }); t.after(() => client.close());
  await client.connect(transport);
  const operationId = randomUUID();
  const result = await client.callTool({ name: 'click_element', arguments: { connectionId: randomUUID(), snapshotId: randomUUID(), elementRef: randomUUID(), operationId } });
  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), { operationId, status: 'outcome-unknown', error: 'outcome-unknown' });
  assert.equal(received, 1);
});
test('installer uses exact caller IDs and private files; uninstall preserves unrelated data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pac-install-')); t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'private');
  const result = await install({ directory, chromeId: 'a'.repeat(32), firefoxId: 'spike@example.test', manifestHome: root, platform: 'darwin' });
  const manifests = await Promise.all(result.manifests.map(path => privateJson(path)));
  assert.deepEqual(manifests[0].allowed_origins, [caller]);
  assert.deepEqual(manifests[1].allowed_extensions, ['spike@example.test']);
  await createPrivateJson(join(directory, 'keep.json'), { retained: true });
  await assert.rejects(install({ directory, chromeId: 'a'.repeat(32), manifestHome: root, platform: 'darwin' }), /installation-already-exists/u);
  await uninstall(directory);
  assert.deepEqual(await privateJson(join(directory, 'keep.json')), { retained: true });
  await assert.rejects(readFile(result.manifests[0]), { code: 'ENOENT' });
  await chmod(join(directory, 'keep.json'), 0o644);
  await assert.rejects(privateJson(join(directory, 'keep.json')), /unsafe-file/u);
});

test('installed executable starts the broker automatically with spaces and quotes in its path', async t => {
  const root = await mkdtemp(join(tmpdir(), "pac ' -")); t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'private');
  await install({ directory, chromeId: 'a'.repeat(32), chromeUserData: join(root, 'profile') });
  const { configuration } = await import('../src/security.mjs');
  const config = await configuration(directory);
  const child = spawn(join(directory, 'native-host.mjs'), [caller], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const ready = new Promise((resolve, reject) => {
    // Allow cold Node startup while the extension build/tests occupy the machine.
    const timer = setTimeout(() => reject(new Error('launcher-timeout')), 10000);
    readFrames(child.stdout, message => { clearTimeout(timer); resolve(message); }, reject);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('launcher-exited')); });
  });
  child.stdin.write(encode({ type: 'register', protocol: PROTOCOL, instanceId, browser: 'chrome' }));
  assert.deepEqual(await ready, { type: 'ready', protocol: PROTOCOL });
  const info = await brokerReady(config);
  t.after(() => { try { process.kill(info.pid, 'SIGTERM'); } catch {} });
  assert.ok((await readFile(join(directory, 'native-host.mjs'), 'utf8')).startsWith('#!/bin/sh\nexec '));
  assert.deepEqual(await readFile(join(directory, 'runtime/node')), await readFile(process.execPath));
});
