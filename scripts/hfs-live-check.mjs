// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { createAuthentication } from '../integrations/hfs/auth.mjs';
import { Client } from '../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
const binaryIndex = process.argv.indexOf('--binary');
if (binaryIndex < 0 || !process.argv[binaryIndex + 1]) throw new Error('Use --binary /absolute/path/to/hfs (reviewed version 3.3.4).');
const binary = resolve(process.argv[binaryIndex + 1]);
const binarySha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
const metadata = JSON.parse(await readFile(new URL('../integrations/hfs/compatibility.json', import.meta.url), 'utf8'));
if (process.platform === 'darwin' && process.arch === 'arm64') assert.equal(binarySha256, metadata.hfsMacArm64BinarySha256, 'Unexpected HFS executable digest. Review the release before testing.');
const auth = createAuthentication(), providerSecret = auth.random(), instanceId = crypto.randomUUID(), clientId = crypto.randomUUID();
const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const peerId = crypto.randomUUID(), peerSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const endpoint = 'http://127.0.0.1:39862';
// Fail on a port conflict; never probe alternative ports or touch an existing process.
try { const existing = await fetch(endpoint + '/pac/v1/health', { signal: AbortSignal.timeout(500) }); if (existing) throw new Error('Test port 39862 is occupied.'); } catch (error) { if (error.message.includes('occupied')) throw error; }
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
const { generateHfsConfiguration } = await vite.ssrLoadModule('/integrations/hfs/config.ts');
const { createHttpDispatcher } = await vite.ssrLoadModule('/src/mcp/dispatcher.ts');
const directory = await mkdtemp(join(tmpdir(), 'pac-hfs-live-')); await chmod(directory, 0o700);
await writeFile(join(directory, 'config.yaml'), generateHfsConfiguration(endpoint, providerSecret), { mode: 0o600 });
let output = '', leaseId = '', stopped = false;
const hfs = spawn(binary, ['--cwd', directory, '--no-central'], { stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [hfs.stdout, hfs.stderr]) stream.on('data', value => { output = (output + value).slice(-16384); });
let spawnError; hfs.on('error', error => { spawnError = error; });
const provider = async (suffix, body, signal = AbortSignal.timeout(26000)) => {
  const path = '/pac/v1/provider/' + suffix, scope = { instanceId, leaseId, nonce: auth.random(), time: Date.now() };
  const response = await fetch(endpoint + path, { method: 'POST', redirect: 'error', signal, headers: { 'content-type': 'application/json',
    'x-pac-instance': instanceId, 'x-pac-lease': leaseId, 'x-pac-nonce': scope.nonce, 'x-pac-time': String(scope.time), 'x-pac-mac': await auth.sign(providerSecret, 'request', path, scope, body) }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.ok(await auth.verify(providerSecret, 'response', path, scope, { status: response.status, body: result }, response.headers.get('x-pac-mac')));
  assert.equal(response.status, 200); return result;
};
const clients = [], pollAbort = new AbortController();
const wire = { emptyNotifications: 0, emptyDeletes: 0, expiredSessions: 0 };
// Inspect real HTTP bytes, including the framework response generated around our middleware.
const consumerFetch = async (url, init) => {
  const response = await fetch(url, init);
  if (response.status === 202) {
    assert.equal((await response.clone().arrayBuffer()).byteLength, 0, 'MCP 202 must have no body');
    wire.emptyNotifications++;
  } else if (init?.method === 'DELETE' && response.ok) {
    assert.equal(response.status, 204);
    assert.equal((await response.clone().arrayBuffer()).byteLength, 0, 'MCP DELETE must have no body');
    wire.emptyDeletes++;
  } else if (response.status === 200 && init?.method === 'POST') {
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/u);
  } else if (response.status === 404) wire.expiredSessions++;
  return response;
};
let polling;
try {
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError;
    if (hfs.exitCode !== null) throw new Error('HFS exited before health. ' + output.replaceAll(providerSecret, '[redacted]'));
    try { health = await (await fetch(endpoint + '/pac/v1/health', { signal: AbortSignal.timeout(500) })).json(); if (health.relayProtocol === 1) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(health?.relayProtocol, 1);
  const challenge = await provider('challenge', { protocolVersion: 1 });
  leaseId = (await provider('register', { protocolVersion: 1, generation: crypto.randomUUID(), challenge: challenge.challenge })).leaseId;
  await provider('control', { clients: [{ id: clientId, hash: await auth.hash(secret) }, { id: peerId, hash: await auth.hash(peerSecret) }] });
  const dispatcher = createHttpDispatcher(instanceId, 'chrome', 'local-lease', async request => {
    if (request.request.tool === 'pair') return { status: 'approved' }; // Synthetic harness only; never browser pairing.
    if (request.request.tool === 'list-tools') return { tools: ['list_shared_tabs'] };
    if (request.request.tool === 'list_shared_tabs') return { tabs: [], synthetic: true };
    return { error: 'request-rejected' };
  }, () => {}, '2.2.2');
  polling = (async () => {
    while (!stopped) {
      const { events } = await provider('poll', {}, pollAbort.signal);
      for (const command of events) if (command.type === 'request') {
        const reply = await dispatcher.dispatch(command);
        await provider('reply', { ticket: command.ticket, ...reply });
      }
    }
  })();
  polling.catch(() => {});
  const connectSdk = async (index, owner = clientId, credential = secret) => {
    const client = new Client({ name: `pac-hfs-sdk-${index}`, version: '1' });
    clients.push(client);
    const transport = new StreamableHTTPClientTransport(new URL(`${endpoint}/pac/v1/mcp/${instanceId}/${owner}`), { fetch: consumerFetch, requestInit: { headers: { Authorization: `Bearer ${credential}` } } });
    await client.connect(transport);
    assert.ok(transport.sessionId);
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['list_shared_tabs']);
    assert.deepEqual(JSON.parse((await client.callTool({ name: 'list_shared_tabs', arguments: {} })).content[0].text), { tabs: [], synthetic: true });
    return { client, transport };
  };
  const primary = await connectSdk(0), peer = await connectSdk(1, peerId, peerSecret);
  await Promise.all(clients.map(async client => assert.equal((await client.callTool({ name: 'list_shared_tabs', arguments: {} })).isError, undefined)));
  // Closing an SDK transport without DELETE simulates abandoned host sessions.
  for (let index = 0; index < 10; index++) {
    const abandoned = await connectSdk(index + 2);
    await abandoned.client.close();
  }
  await assert.rejects(primary.client.listTools(), error => error.code === 404);
  assert.equal(wire.expiredSessions, 1);
  assert.equal((await peer.client.listTools()).tools.length, 1);
  await primary.client.close();
  // Reinitialize after 404 explicitly: the SDK transport does not do this automatically.
  const recovered = await connectSdk('recovered');
  assert.notEqual(recovered.transport.sessionId, primary.transport.sessionId);
  assert.equal((await peer.client.listTools()).tools.length, 1);
  await recovered.client.notification({ method: 'notifications/cancelled', params: { requestId: 999, reason: 'Synthetic cancellation check' } });
  await recovered.transport.terminateSession();
  await peer.transport.terminateSession();
  assert.equal(wire.emptyNotifications, 14);
  assert.equal(wire.emptyDeletes, 2);
  assert.equal((await fetch(endpoint + '/~/api/get_config')).status, 404);
  assert.equal((await fetch(endpoint + '/')).status, 404);
  assert.equal((await fetch(endpoint + '/pac/v1/health', { headers: { Origin: 'https://evil.test' } })).status, 403);
  console.log(JSON.stringify({ hfsVersion: '3.3.4', binarySha256, credentials: 2, abandonedReconnects: 10, sessions: 'independent', sdkInitializeListCall: 'pass', expiredSessionReinitialize: 'pass', unaffectedPeer: 'pass', wire, blockedAdminAndFiles: 'pass', configBytes: Buffer.byteLength(generateHfsConfiguration(endpoint, providerSecret)), scope: 'synthetic SDK and real HFS; not browser/AI-host acceptance' }, null, 2));
} finally {
  stopped = true; pollAbort.abort(); await polling?.catch(() => {});
  for (const client of clients) await client.close().catch(() => {});
  if (leaseId) await provider('control', { disconnect: true }, AbortSignal.timeout(2000)).catch(() => {});
  hfs.kill('SIGINT');
  await Promise.race([new Promise(resolve => hfs.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
  if (hfs.exitCode === null) hfs.kill('SIGTERM');
  await vite.close();
  // Retain the private temporary folder for diagnostics; never print its secrets.
}
