// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { checkProfileSwitch } from './check-profile-switch.mjs';
import { mkdtemp, mkdir, rm, readFile, readdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const source = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the built marketplace folder. Run this check with its bundled runtime/node.');
const clientKind = process.argv[3] ?? 'chatgpt', browser = process.argv[4] ?? 'chrome';
assert.ok(['chatgpt', 'claude-code', 'antigravity', 'github-copilot-app'].includes(clientKind)); assert.ok(['chrome', 'firefox'].includes(browser));
const extensionId = browser === 'chrome' ? 'a'.repeat(32) : 'page-as-context@synthetic.test';
const originalPlugin = join(source, 'plugins/page-as-context');
const from = (root, path) => import(pathToFileURL(join(root, path)));
const { verifyPackage, stagePackage } = await from(originalPlugin, 'helper/src/desktop-package.mjs');
const release = await verifyPackage(source);
assert.ok(Object.keys(release.files).every(path => !/(?:^|\/)(?:setup-service\.mjs|legacy-runtime-hashes\.json|[^/]+\.swift)$|\.app\//u.test(path)), 'Plugin inventory must not contain the removed desktop setup application.');
assert.equal(process.version, 'v24.10.0');
assert.ok(process.execPath.endsWith('/runtime/node'), 'Use the bundled runtime, not a global Node.');
async function waitBroker(config, brokerReady) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { return await brokerReady(config); }
    catch (error) { if (!['broker-unavailable', 'ENOENT', 'ECONNREFUSED'].includes(error.message) && !['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Setup did not start the broker.');
}
const root = await mkdtemp(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'pac-installed-'));
let broker, client, second, native;
try {
  const { target } = await stagePackage(source, join(root, 'private installation'));
  const plugin = join(target, 'plugins/page-as-context');
  if (clientKind === 'antigravity') {
    const manifest = JSON.parse(await readFile(join(plugin, 'plugin.json'), 'utf8'));
    assert.equal(manifest.$schema, 'https://antigravity.google/schemas/v1/plugin.json');
    assert.equal(manifest.version, release.version);
    assert.equal(manifest.displayName, 'Page as Context');
    const config = JSON.parse(await readFile(join(plugin, 'mcp_config.json'), 'utf8'));
    assert.deepEqual(Object.keys(config.mcpServers).sort(), ['browser-chrome', 'browser-firefox']);
    for (const browser of ['chrome', 'firefox']) {
      const entry = config.mcpServers[`browser-${browser}`];
      assert.deepEqual(entry, { command: './runtime/node', args: ['${PLUGIN_ROOT}/server.mjs', browser], cwd: '${PLUGIN_ROOT}' });
      // Emulate the documented path expansion without assuming a global Node.
      const expand = value => value.replaceAll('${PLUGIN_ROOT}', plugin);
      const rejected = spawnSync(join(expand(entry.cwd), entry.command), [expand(entry.args[0]), 'invalid-browser'], { cwd: expand(entry.cwd), env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 5000 });
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /Select exactly chrome or firefox/);
    }
    assert.equal((await readFile(join(plugin, 'skills/browser-setup/SKILL.md'), 'utf8')).includes('Never approve pairing'), true);
  }
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
  const foreignProfiles = [];
  const connect = async () => {
    const value = new Client({ name: 'installed-package-check', version: '1' });
    let command = join(plugin, 'runtime/node'), args = [join(plugin, 'server.mjs'), browser, ...(clientKind === 'claude-code' ? ['--client', 'code'] : [])], cwd = tmpdir();
    if (clientKind === 'antigravity') {
      const entry = JSON.parse(await readFile(join(plugin, 'mcp_config.json'), 'utf8')).mcpServers[`browser-${browser}`];
      const expand = value => value.replaceAll('${PLUGIN_ROOT}', plugin);
      cwd = expand(entry.cwd); command = resolve(cwd, entry.command); args = entry.args.map(expand);
    }
    await value.connect(new StdioClientTransport({ command, args: [...args, '--directory', state, '--manifest-home', join(root, 'isolated browser home')], cwd, env: { PATH: '/usr/bin:/bin' }, stderr: 'pipe' }));
    return value;
  };
  client = await connect();
  assert.equal(client.getServerVersion().version, release.version);
  assert.equal((await client.listTools()).tools.length, 10);
  const setupStatus = JSON.parse((await client.callTool({ name: 'setup_status', arguments: {} })).content[0].text);
  assert.equal(setupStatus.nativeInstalled, false);
  assert.equal((await client.callTool({ name: 'read_page_context', arguments: { connectionId: 'synthetic_connection_001' } })).isError, true);
  assert.deepEqual(await readdir(state).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
  const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
  const plan = await call('prepare_browser_setup', { instanceId, extensionId });
  assert.equal(plan.confirmationRequired, true);
  assert.deepEqual(await readdir(state).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
  assert.equal((await call('confirm_browser_setup', { requestId: plan.requestId, confirmed: false })).error, 'setup-confirmation-required');
  if (['antigravity', 'github-copilot-app'].includes(clientKind)) {
    for (const other of ['chatgpt', 'claude', 'claude-code']) {
      const directory = await privateDirectory(join(state, other, 'profiles'));
      const path = join(directory, 'unrelated-profile.json');
      await createPrivateJson(path, { fixture: other, unchanged: true });
      foreignProfiles.push({ path, bytes: await readFile(path) });
    }
  }
  const started = await call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true });
  assert.equal(started.error, undefined);
  const { privateJson } = await from(plugin, 'helper/src/security.mjs');
  const pendingDirectory = join(state, `${clientKind}/profiles/${browser}/instances/${instanceId}`);
  const [pendingFile] = await readdir(pendingDirectory);
  const credential = await privateJson(join(pendingDirectory, pendingFile));
  await client.listTools();
  const config = await configuration(state); broker = await waitBroker(config, brokerReady);
  native = await connectSocket(config.socket);
  let granted = true, ready, pairingApproved = false;
  const nativeReady = new Promise(resolve => { ready = resolve; });
  const stop = readFrames(native, message => {
    if (message.type === 'ready') return ready();
    if (message.type === 'client-disconnected') { granted = false; return; }
    if (message.type !== 'request') return;
    let result;
    if (message.request.tool === 'pair') result = pairingApproved ? { status: 'approved' } : { status: 'pending', code: 'A1B2C3D4' };
    else if (message.request.tool === 'list-tools') result = { tools: ['get_connection_status', 'read_page_context', 'read_target_context', 'write_elements'] };
    else if (!granted) result = { error: 'request-rejected' };
    else if (message.request.tool === 'read_target_context') result = { target: { outcome: 'found' }, context: 'Synthetic targeted context' };
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
  // Simulate a separate user tab grant after the pairing transport has closed.
  await client.listTools(); granted = true;
  const packageTools = (await from(plugin, 'helper/src/catalog.mjs')).toolCatalog();
  const hasBatch = packageTools.some(tool => tool.name === 'write_elements');
  assert.ok(packageTools.some(tool => tool.name === 'read_target_context'));
  const targeted = await client.callTool({ name: 'read_target_context', arguments: { connectionId: 'synthetic_connection_001', target: { role: 'button', name: 'Next' }, group: { role: 'form', name: 'Profile' }, context: 'group' } });
  assert.equal(JSON.parse(targeted.content[0].text).target.outcome, 'found');
  if (hasBatch) {
    assert.ok((await client.listTools()).tools.some(tool => tool.name === 'write_elements'), 'The packaged server must advertise the grouped write tool.');
    const denied = await client.callTool({ name: 'write_elements', arguments: {
      connectionId: 'synthetic_connection_001', snapshotId: randomUUID(), operationId: randomUUID(),
      actions: [{ action: 'fill', elementRef: randomUUID(), text: 'Synthetic package check' }],
    } });
    assert.equal(JSON.parse(denied.content[0].text).error, 'approval-denied');
  }
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
  const { profileStore } = await from(plugin, 'helper/src/profile-store.mjs');
  const switchCall = async (name, args) => JSON.parse((await second.callTool({ name, arguments: args })).content[0].text);
  await checkProfileSwitch({ call: switchCall, config, browser, extensionId, profiles: profileStore(browser, join(state, `${clientKind}/profiles`)), connectSocket, readFrames, writeFrame, resultChunks, protocol: PROTOCOL });
  await second.close(); second = undefined; stop(); native.destroy(); native = undefined;
  // Stop only this authenticated synthetic broker before uninstalling this isolated fixture.
  process.kill((await brokerReady(config)).pid, 'SIGTERM');
  broker = undefined;
  await new Promise(resolve => setTimeout(resolve, 100));
  await uninstall(state);
  for (const { path, bytes } of foreignProfiles) assert.deepEqual(await readFile(path), bytes, 'Other client profiles must remain byte-for-byte unchanged.');
  assert.ok((await readdir(state)).includes(clientKind), 'Credentials remain until explicit cleanup.');
  console.log(JSON.stringify({ passed: true, client: clientKind, browser, version: release.version, packageFiles: Object.keys(release.files).length,
    installedCopy: true, globalNodeRequired: false, setupAppRequired: false, tools: packageTools.length + 5, setupStatusWithoutInstallation: true,
    groupedWriteDiscovery: hasBatch, groupedWriteDenied: hasBatch,
    explicitSetupConfirmation: true, cleanInstallViaMcp: true, syntheticPairingCodeAndApproval: true, unconfiguredReadRejected: true, syntheticRead: true,
    sharedSessionPreserved: true, instanceSwitchAndCancellation: true, syntheticWriteDenied: true, scopedDisconnect: true, isolatedUninstall: true,
    limitation: 'SDK and synthetic native endpoint only; actual AI-client/plugin browser approval acceptance is separate.' }, null, 2));
} finally {
  await client?.close().catch(() => {}); await second?.close().catch(() => {}); native?.destroy();
  if (broker) { try { process.kill(broker.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
