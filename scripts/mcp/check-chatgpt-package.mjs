// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const source = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the built marketplace folder. Run this check with its bundled runtime/node.');
const clientKind = process.argv[3] ?? 'chatgpt', browser = process.argv[4] ?? 'chrome';
assert.ok(['chatgpt', 'claude-code'].includes(clientKind)); assert.ok(['chrome', 'firefox'].includes(browser));
const extensionId = browser === 'chrome' ? 'a'.repeat(32) : 'page-as-context@synthetic.test';
const originalPlugin = join(source, 'plugins/page-as-context');
const from = (root, path) => import(pathToFileURL(join(root, path)));
const { verifyPackage, stagePackage } = await from(originalPlugin, 'helper/src/desktop-package.mjs');
const release = await verifyPackage(source);
assert.ok(Object.keys(release.files).every(path => !/(?:^|\/)(?:setup-service\.mjs|legacy-runtime-hashes\.json|[^/]+\.swift)$|\.app\//u.test(path)), 'Plugin inventory must not contain the removed desktop setup application.');
assert.equal(process.version, 'v24.10.0');
assert.ok(process.execPath.endsWith('/runtime/node'), 'Use the bundled runtime, not a global Node.');
const root = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'pac-installed-'));
let broker, client, second, native;
try {
  const { target } = await stagePackage(source, join(root, 'private installation'));
  const plugin = join(target, 'plugins/page-as-context');
  if (clientKind === 'claude-code') {
    const pluginManifest = JSON.parse(await readFile(join(plugin, '.claude-plugin/plugin.json'), 'utf8'));
    const desktopManifest = JSON.parse(await readFile(join(plugin, 'manifest.json'), 'utf8'));
    const servers = JSON.parse(await readFile(join(plugin, '.mcp.json'), 'utf8')).mcpServers;
    assert.equal(pluginManifest.version, desktopManifest.version); assert.equal(pluginManifest.version, release.version);
    for (const browser of ['chrome', 'firefox']) assert.deepEqual(servers[`browser-${browser}`].args.slice(-2), ['--client', 'code']);
  }
  // Every runtime import below comes from the installed copy, never helper/node_modules.
  const { Client } = await from(plugin, 'helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const { StdioClientTransport } = await from(plugin, 'helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  const { install, uninstall } = await from(plugin, 'helper/src/install.mjs');
  const { createPrivateJson, privateDirectory, configuration, PROTOCOL, secret } = await from(plugin, 'helper/src/security.mjs');
  const { brokerReady } = await from(plugin, 'helper/src/startup.mjs');
  const { connectSocket } = await from(plugin, 'helper/src/broker.mjs');
  const { readFrames, writeFrame, resultChunks } = await from(plugin, 'helper/src/framing.mjs');
  const { disconnectClient } = await from(plugin, 'helper/src/admin-client.mjs');
  const state = join(root, 'browser state'), instanceId = randomUUID();
  const connect = async () => {
    const value = new Client({ name: 'installed-package-check', version: '1' });
    await value.connect(new StdioClientTransport({ command: join(plugin, 'runtime/node'), args: [join(plugin, 'server.mjs'), browser, ...(clientKind === 'claude-code' ? ['--client', 'code'] : []), '--directory', state, '--manifest-home', join(root, 'isolated browser home')], cwd: tmpdir(), env: { PATH: '/usr/bin:/bin' }, stderr: 'pipe' }));
    return value;
  };
  client = await connect();
  assert.equal(client.getServerVersion().version, release.version);
  assert.equal((await client.listTools()).tools.length, 12);
  const setupStatus = JSON.parse((await client.callTool({ name: 'setup_status', arguments: {} })).content[0].text);
  assert.equal(setupStatus.nativeInstalled, false);
  assert.equal((await client.callTool({ name: 'read_page_context', arguments: { connectionId: 'synthetic_connection_001' } })).isError, true);
  assert.deepEqual(await readdir(state), []);
  const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
  const plan = await call('prepare_browser_setup', { instanceId, extensionId });
  assert.equal(plan.confirmationRequired, true);
  assert.deepEqual(await readdir(state), []);
  assert.equal((await call('confirm_browser_setup', { requestId: plan.requestId, confirmed: false })).error, 'setup-confirmation-required');
  const started = await call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true });
  assert.equal(started.error, undefined);
  const { privateJson } = await from(plugin, 'helper/src/security.mjs');
  const credential = await privateJson(join(state, `${clientKind}/profiles/${browser}.json`));
  await client.listTools();
  const config = await configuration(state); broker = await brokerReady(config);
  native = await connectSocket(config.socket);
  let granted = true, ready, pairingApproved = false;
  const nativeReady = new Promise(resolve => { ready = resolve; });
  const stop = readFrames(native, message => {
    if (message.type === 'ready') return ready();
    if (message.type === 'client-disconnected') { granted = false; return; }
    if (message.type !== 'request') return;
    let result;
    if (message.request.tool === 'pair') result = pairingApproved ? { status: 'approved' } : { status: 'pending', code: 'A1B2C3D4' };
    else if (message.request.tool === 'list-tools') result = { tools: ['get_connection_status', 'read_page_context'] };
    else if (!granted) result = { error: 'request-rejected' };
    else if (message.request.tool === 'read_page_context') result = { connectionId: 'synthetic_connection_001', context: 'Synthetic installed-package context', warnings: [], partial: false };
    else result = { status: 'rejected', error: 'approval-denied' };
    for (const chunk of resultChunks(message.id, result)) writeFrame(native, chunk);
  }, () => native.destroy());
  writeFrame(native, { type: 'hello', role: 'native', protocol: PROTOCOL, instanceId: credential.instanceId, browser: credential.browser, caller: browser === 'chrome' ? `chrome-extension://${extensionId}/` : extensionId, secret: config.hostSecret });
  await nativeReady;
  const waitPairing = async status => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const value = await call('get_pairing_status', { requestId: plan.requestId });
      if (value.status === status) return value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Synthetic pairing did not reach ${status}.`);
  };
  assert.equal((await waitPairing('pending')).code, 'A1B2C3D4');
  pairingApproved = true;
  assert.equal((await waitPairing('approved')).code, undefined);
  const read = value => value.callTool({ name: 'read_page_context', arguments: { connectionId: 'synthetic_connection_001' } });
  assert.equal(JSON.parse((await read(client)).content[0].text).context, 'Synthetic installed-package context');
  second = await connect(); await second.listTools();
  await client.close(); client = undefined;
  assert.equal(JSON.parse((await read(second)).content[0].text).context, 'Synthetic installed-package context');
  const rejected = await second.callTool({ name: 'click_element', arguments: { connectionId: 'synthetic_connection_001', snapshotId: randomUUID(), elementRef: randomUUID(), operationId: randomUUID() } });
  assert.equal(JSON.parse(rejected.content[0].text).error, 'approval-denied');
  await disconnectClient(config, credential);
  const revoked = await read(second);
  assert.equal(revoked.isError, true);
  await second.close(); second = undefined; stop(); native.destroy(); native = undefined;
  // Stop only this authenticated synthetic broker before uninstalling this isolated fixture.
  process.kill((await brokerReady(config)).pid, 'SIGTERM');
  broker = undefined;
  await new Promise(resolve => setTimeout(resolve, 100));
  await uninstall(state);
  assert.ok((await readdir(state)).includes(clientKind), 'Credentials remain until explicit cleanup.');
  console.log(JSON.stringify({ passed: true, client: clientKind, browser, version: release.version, packageFiles: Object.keys(release.files).length,
    installedCopy: true, globalNodeRequired: false, setupAppRequired: false, tools: 12, setupStatusWithoutInstallation: true,
    explicitSetupConfirmation: true, cleanInstallViaMcp: true, syntheticPairingCodeAndApproval: true, unconfiguredReadRejected: true, syntheticRead: true,
    sharedSessionPreserved: true, syntheticWriteDenied: true, scopedDisconnect: true, isolatedUninstall: true,
    limitation: 'SDK and synthetic native endpoint only; actual AI-client/plugin browser approval acceptance is separate.' }, null, 2));
} finally {
  await client?.close().catch(() => {}); await second?.close().catch(() => {}); native?.destroy();
  if (broker) { try { process.kill(broker.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
