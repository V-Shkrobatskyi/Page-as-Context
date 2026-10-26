// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, rm, lstat, writeFile, symlink, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { ensureBroker, brokerReady } from '../src/startup.mjs';
import { connectSocket } from '../src/broker.mjs';
import { bridgeClient } from '../src/client.mjs';
import { managedClient } from '../src/managed-client.mjs';
import { PROTOCOL, secret, createPrivateJson } from '../src/security.mjs';
import { readFrames, writeFrame } from '../src/framing.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const credential = () => ({ protocol: PROTOCOL, browser: 'chrome', instanceId: 'synthetic_instance_001', credentialId: 'synthetic_credential_001', secret: secret() });
async function until(check, timeout = 2500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(20); }
  assert.fail('Condition did not become true before the deadline.');
}
async function absent(path) { try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pac-auto-')); await chmod(directory, 0o700);
  const config = { directory, socket: join(directory, 'broker.sock'), protocol: PROTOCOL, installationId: secret(), hostSecret: secret(),
    callers: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'] };
  await createPrivateJson(join(directory, 'config.json'), config);
  t.after(async () => {
    try { const { pid } = await brokerReady(config); process.kill(pid, 'SIGTERM'); await until(() => absent(config.socket)); } catch {}
    await rm(directory, { recursive: true, force: true });
  });
  return config;
}
async function native(config) {
  const socket = await connectSocket(config.socket);
  const ready = new Promise(resolve => {
    readFrames(socket, value => { if (value.type === 'ready') resolve(); }, () => socket.destroy());
  });
  writeFrame(socket, { type: 'hello', protocol: PROTOCOL, role: 'native', instanceId: 'synthetic_instance_001', browser: 'chrome',
    caller: config.callers[0], secret: config.hostSecret });
  await ready; return socket;
}
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr }));
  });
}

test('concurrent processes start one authenticated broker without stdout logging', async t => {
  const config = await fixture(t);
  const results = await Promise.all(Array.from({ length: 6 }, () => run(['ensure-broker', '--directory', config.directory])));
  for (const result of results) { assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, ''); }
  const statuses = await Promise.all(Array.from({ length: 8 }, () => ensureBroker(config)));
  assert.equal(new Set(statuses.map(value => value.pid)).size, 1);
  assert.notEqual(statuses[0].pid, process.pid);
});

test('idle native connections and readiness probes do not keep the managed broker alive', async t => {
  const config = await fixture(t);
  await ensureBroker(config, { idleTimeout: 250 });
  const socket = await native(config); t.after(() => socket.destroy());
  await brokerReady(config); await delay(75); await brokerReady(config);
  await until(() => absent(config.socket));
  assert.equal(socket.destroyed, true);
});

test('one client closing does not stop another lease; last lease closes on idle', async t => {
  const config = await fixture(t);
  await ensureBroker(config, { idleTimeout: 200 });
  const first = await bridgeClient(config, credential()), second = await bridgeClient(config, credential());
  t.after(() => { first.close(); second.close(); });
  await delay(300); await brokerReady(config);
  first.close(); await delay(300); await brokerReady(config);
  second.close(); await until(() => absent(config.socket));
});

test('graceful broker shutdown can be started again by the next caller', async t => {
  const config = await fixture(t);
  const first = await ensureBroker(config); process.kill(first.pid, 'SIGTERM');
  await until(() => absent(config.socket));
  const second = await ensureBroker(config);
  assert.notEqual(first.pid, second.pid);
});

test('a managed client restarts on a later request without replaying the failed request', async t => {
  const config = await fixture(t), client = managedClient(config, credential()); t.after(() => client.close());
  await assert.rejects(client.request({ tool: 'list-tools', arguments: {} }), /not-connected/u);
  const first = await brokerReady(config);
  process.kill(first.pid, 'SIGTERM'); await until(() => absent(config.socket));
  await delay(30);
  await assert.rejects(client.request({ tool: 'list-tools', arguments: {} }), /not-connected/u);
  assert.notEqual((await brokerReady(config)).pid, first.pid);
});

test('stale sockets after a hard crash are preserved and fail within a bounded timeout', async t => {
  const config = await fixture(t);
  const info = await ensureBroker(config); process.kill(info.pid, 'SIGKILL');
  await until(async () => { try { process.kill(info.pid, 0); return false; } catch { return true; } });
  const before = await lstat(config.socket);
  await assert.rejects(ensureBroker(config, { timeout: 400 }), /broker-unavailable/u);
  assert.equal((await lstat(config.socket)).ino, before.ino);
});

test('missing runtime and a worker that never becomes ready fail without orphaning it', async t => {
  const config = await fixture(t);
  await assert.rejects(ensureBroker(config, { executable: join(config.directory, 'missing-node') }), /broker-runtime-unavailable/u);
  const worker = join(config.directory, 'stall.mjs'), pidPath = join(config.directory, 'stall.pid');
  await writeFile(worker, "import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[2]+'/stall.pid',String(process.pid)); setInterval(()=>{},1000);\n");
  await assert.rejects(ensureBroker(config, { worker, timeout: 500 }), /broker-start-timeout/u);
  const pid = Number(await readFile(pidPath, 'utf8'));
  await until(async () => { try { process.kill(pid, 0); return false; } catch { return true; } });
  assert.equal(await absent(config.socket), true);
});

test('regular files, symlinks, and unrelated sockets are never removed or taken over', async t => {
  const config = await fixture(t), target = join(config.directory, 'keep.txt');
  await writeFile(target, 'keep', { mode: 0o600 });
  await symlink(target, config.socket);
  await assert.rejects(ensureBroker(config), /unsafe-socket/u);
  assert.equal(await readFile(target, 'utf8'), 'keep');
  await rm(config.socket);
  await writeFile(config.socket, 'keep', { mode: 0o600 });
  await assert.rejects(ensureBroker(config), /unsafe-socket/u);
  assert.equal(await readFile(config.socket, 'utf8'), 'keep');
  await rm(config.socket);
  const server = createServer(socket => { socket.on('data', () => { writeFrame(socket, { type: 'ready', protocol: PROTOCOL, pid: 1, proof: 'unrelated' }); }); });
  server.listen(config.socket); await once(server, 'listening'); await chmod(config.socket, 0o600);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const before = (await lstat(config.socket)).ino;
  await assert.rejects(ensureBroker(config), /broker-incompatible/u);
  assert.equal((await lstat(config.socket)).ino, before);
});

test('wrong installation secret cannot pass readiness or replace a live broker', async t => {
  const config = await fixture(t), original = await ensureBroker(config);
  await assert.rejects(ensureBroker({ ...config, hostSecret: secret() }), /broker-unavailable/u);
  assert.equal((await brokerReady(config)).pid, original.pid);
});

test('MCP initialize succeeds before broker startup; first discovery starts it lazily', async t => {
  const config = await fixture(t), path = join(config.directory, 'client.json');
  await createPrivateJson(path, credential());
  const client = new Client({ name: 'lazy-startup-test', version: '1' }); t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'stdio', '--directory', config.directory, '--credential', path], stderr: 'pipe' }));
  assert.equal(await absent(config.socket), true);
  const discovered = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(discovered.includes('read_page_context'));
  assert.ok(discovered.includes('click_element'));
  const unavailable = await client.callTool({ name: 'read_page_context', arguments: { connectionId: 'synthetic_connection_001' } });
  assert.equal(unavailable.isError, true);
  await brokerReady(config);
  await client.close();
});

test('invalid credentials do not start a broker', async t => {
  const config = await fixture(t);
  assert.throws(() => managedClient(config, { ...credential(), secret: '' }), /invalid-credential/u);
  assert.equal(await absent(config.socket), true);
});

test('a missing browser keeps the MCP lease and later tool-change notifications', async t => {
  const config = await fixture(t), identity = credential(), client = managedClient(config, identity);
  t.after(() => client.close());
  let notifications = 0;
  client.onToolsChanged(() => { notifications++; });
  await assert.rejects(client.request({ tool: 'list-tools', arguments: {} }), /not-connected/u);
  const before = notifications;
  const socket = await native(config); t.after(() => socket.destroy());
  writeFrame(socket, { type: 'tools-changed', credentialId: identity.credentialId });
  await until(async () => notifications > before);
});
