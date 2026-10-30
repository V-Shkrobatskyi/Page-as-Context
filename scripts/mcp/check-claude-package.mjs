// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, lstat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { unpackExtension, VERSIONED_MANIFEST_SCHEMAS } from '../../integrations/claude/node_modules/@anthropic-ai/mcpb/dist/index.js';

if (!process.argv[2]) throw new Error('Pass the built .mcpb archive. This check never installs it into Claude.');
const archive = resolve(process.argv[2]);
const root = await mkdtemp('/private/tmp/pac-claude-check-');
const installed = join(root, 'installed copy with spaces');
const from = path => import(pathToFileURL(join(installed, path)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function inventory(directory, prefix = '') {
  const files = {};
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), stat = await lstat(path), key = prefix + name;
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) Object.assign(files, await inventory(path, key + '/'));
    else { assert.ok(stat.isFile()); if (key !== 'PACKAGE.json') files[key] = hash(await readFile(path)); }
  }
  return files;
}
try {
  assert.equal(await unpackExtension({ mcpbPath: archive, outputDir: installed, silent: true }), true);
  const index = JSON.parse(await readFile(join(installed, 'PACKAGE.json'), 'utf8'));
  assert.equal(index.format, 1); assert.equal(index.client, 'claude');
  assert.equal(index.platform, 'darwin'); assert.equal(index.arch, 'arm64');
  assert.deepEqual(await inventory(installed), index.files, 'Exact extracted inventory and hashes must match.');
  const manifest = VERSIONED_MANIFEST_SCHEMAS['0.3'].parse(JSON.parse(await readFile(join(installed, 'manifest.json'), 'utf8')));
  assert.equal(manifest.version, index.version);
  assert.equal(manifest.server.type, 'binary');
  assert.equal(manifest.server.entry_point, 'runtime/node');
  assert.equal(manifest.server.mcp_config.command, '${__dirname}/runtime/node');
  assert.deepEqual(manifest.server.mcp_config.args, ['${__dirname}/server.mjs', '${user_config.browser}']);
  assert.equal(manifest.user_config.browser.required, true);
  assert.equal(manifest.user_config.browser.default, undefined);
  const topLevel = new Set(['manifest.json', 'server.mjs', 'README.md', 'LICENSE', 'PACKAGE.json', 'DEPENDENCIES.json', 'DEPENDENCY-LOCK.json', 'helper', 'runtime', '.claude-plugin', '.mcp.json', 'plugin.json', 'skills']);
  for (const name of await readdir(installed)) assert.ok(topLevel.has(name), `Unexpected root entry: ${name}`);
  const codeManifest = JSON.parse(await readFile(join(installed, '.claude-plugin/plugin.json'), 'utf8'));
  const codeServers = JSON.parse(await readFile(join(installed, '.mcp.json'), 'utf8')).mcpServers;
  assert.equal(codeManifest.name, manifest.name); assert.equal(codeManifest.version, manifest.version);
  assert.deepEqual(await readdir(join(installed, '.claude-plugin')), ['plugin.json']);
  for (const browser of ['chrome', 'firefox']) assert.deepEqual(codeServers[`browser-${browser}`].args.slice(-2), ['--client', 'code']);
  assert.deepEqual((await readdir(join(installed, 'runtime'))).sort(), ['LICENSE', 'node']);
  assert.ok((await lstat(join(installed, 'runtime/node'))).mode & 0o100, 'The archive must retain an executable runtime.');
  for (const name of Object.keys(index.files)) assert.ok(!/(?:^|\/)(?:\.env[^/]*|profiles|config\.json|setup-service\.mjs|[^/]+\.swift)$|\.app\//u.test(name), 'Exclude local data and the removed setup app.');
  const runtime = join(installed, 'runtime/node');
  const version = spawnSync(runtime, ['--version'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(version.status, 0); assert.equal(version.stdout.trim(), 'v24.10.0');
  const invalid = spawnSync(runtime, [join(installed, 'server.mjs'), 'safari'], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin' } });
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /set Browser to exactly chrome or firefox/u);
  const { Client } = await from('helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const { StdioClientTransport } = await from('helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  const { privateDirectory, createPrivateJson, privateJson, configuration, secret, PROTOCOL } = await from('helper/src/security.mjs');
  const { connectSocket } = await from('helper/src/broker.mjs');
  const { brokerReady } = await from('helper/src/startup.mjs');
  const { readFrames, writeFrame, resultChunks } = await from('helper/src/framing.mjs');
  const { stopOwnedBroker } = await from('helper/src/runtime-lifecycle.mjs');
  const results = [];
  for (const browser of ['chrome', 'firefox']) {
    const state = await privateDirectory(join(root, `${browser} state`));
    const chatgpt = await privateDirectory(join(state, 'chatgpt/profiles'));
    const instanceId = randomUUID(), extensionId = browser === 'chrome' ? 'a'.repeat(32) : '{00000000-0000-4000-8000-000000000001}';
    const decoy = { protocol: PROTOCOL, browser, instanceId, credentialId: randomUUID(), secret: secret() };
    await createPrivateJson(join(chatgpt, `${browser}.json`), decoy);
    const decoyBytes = await readFile(join(chatgpt, `${browser}.json`));
    let client, native, config;
    try {
      client = new Client({ name: 'claude-installed-copy-check', version: '1' });
      await client.connect(new StdioClientTransport({ command: runtime,
        args: [join(installed, 'server.mjs'), browser, '--directory', state, '--manifest-home', join(root, `${browser} isolated manifests`)],
        cwd: root, env: { PATH: '/usr/bin:/bin' }, stderr: 'pipe' }));
      assert.equal(client.getServerVersion().version, manifest.version);
      assert.match(client.getInstructions(), new RegExp(`configured for ${browser}`, 'u'));
      assert.match(client.getInstructions(), /explicit user approval before confirm_browser_setup/u);
      assert.equal((await client.listTools()).tools.length, 12);
      const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
      const initial = await call('setup_status');
      assert.equal(initial.nativeInstalled, false); assert.equal(initial.profileConfigured, false, 'Never adopt ChatGPT credentials.');
      assert.equal(initial.clientName, `Claude Desktop — ${browser === 'chrome' ? 'Chrome' : 'Firefox'}`);
      assert.equal((await client.callTool({ name: 'read_page_context', arguments: { connectionId: 'synthetic_connection_001' } })).isError, true);
      const plan = await call('prepare_browser_setup', { instanceId, extensionId });
      assert.equal(plan.confirmationRequired, true);
      assert.deepEqual(await readdir(state), ['chatgpt']);
      assert.equal((await call('confirm_browser_setup', { requestId: plan.requestId, confirmed: false })).error, 'setup-confirmation-required');
      assert.equal((await call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true })).error, undefined);
      const credential = await privateJson(join(state, `claude/profiles/${browser}.json`));
      assert.notEqual(credential.credentialId, decoy.credentialId); assert.notEqual(credential.secret, decoy.secret);
      assert.deepEqual(await readFile(join(chatgpt, `${browser}.json`)), decoyBytes);
      await client.listTools(); config = await configuration(state); await brokerReady(config);
      native = await connectSocket(config.socket);
      let approved = false, ready;
      const nativeReady = new Promise(resolve => { ready = resolve; });
      readFrames(native, message => {
        if (message.type === 'ready') { ready(); return; }
        if (message.type !== 'request') return;
        let result = { error: 'request-rejected' };
        if (message.credentialId === credential.credentialId) {
          if (message.request.tool === 'pair') result = approved ? { status: 'approved' } : { status: 'pending', code: 'A1B2C3D4' };
          else if (message.request.tool === 'list-tools') result = { tools: ['read_page_context'] };
          else if (approved && message.request.tool === 'read_page_context') result = { context: `Synthetic ${browser} installed-copy context` };
          else if (approved) result = { status: 'rejected', error: 'approval-denied' };
        }
        for (const chunk of resultChunks(message.id, result)) writeFrame(native, chunk);
      }, () => native.destroy());
      writeFrame(native, { type: 'hello', role: 'native', protocol: PROTOCOL, instanceId, browser,
        caller: browser === 'chrome' ? `chrome-extension://${extensionId}/` : extensionId, secret: config.hostSecret });
      await nativeReady;
      const waitFor = async expected => {
        const deadline = Date.now() + 5000;
        do {
          const job = await call('get_pairing_status', { requestId: plan.requestId });
          if (job.status === expected) return job;
          await new Promise(resolve => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        throw new Error(`Synthetic ${browser} pairing did not reach ${expected}.`);
      };
      assert.equal((await waitFor('pending')).code, 'A1B2C3D4'); approved = true;
      assert.equal((await waitFor('approved')).code, undefined);
      assert.equal((await call('read_page_context', { connectionId: 'synthetic_connection_001' })).context, `Synthetic ${browser} installed-copy context`);
      const rejection = await call('click_element', { connectionId: 'synthetic_connection_001', snapshotId: randomUUID(), elementRef: randomUUID(), operationId: randomUUID() });
      assert.equal(rejection.error, 'approval-denied');
      results.push({ browser, tools: 12, cleanIsolatedSetup: true, chatgptProfileUntouched: true, syntheticPairingReadWriteDenial: true });
    } finally {
      await client?.close().catch(() => {}); native?.destroy();
      if (config) await stopOwnedBroker(config);
    }
  }
  console.log(JSON.stringify({ passed: true, version: manifest.version, schema: manifest.manifest_version,
    archiveSha256: hash(await readFile(archive)), files: Object.keys(index.files).length + 1,
    installedCopy: true, globalNodeRequired: false, explicitBrowserRequired: true, results,
    limitation: 'SDK and synthetic endpoint only. Actual Claude UI installation, permissions and browser acceptance remain separate.' }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
