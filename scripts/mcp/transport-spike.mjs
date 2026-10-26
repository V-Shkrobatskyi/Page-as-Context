// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
/** Opt-in: temporarily registers a native host for two isolated, content-free extensions. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, unlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { install, uninstall } from '../../helper/src/install.mjs';
import { configuration, secret, createPrivateJson, privateDirectory, privateJson, PROTOCOL } from '../../helper/src/security.mjs';
import { startBroker } from '../../helper/src/broker.mjs';
import { brokerReady } from '../../helper/src/startup.mjs';
import { Client } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { launch } from './browser-protocol.mjs';

const { values } = parseArgs({ options: { report: { type: 'string' }, targets: { type: 'string', default: 'chrome,firefox' }, 'chrome-binary': { type: 'string' }, 'firefox-binary': { type: 'string' }, package: { type: 'string' }, assistant: { type: 'boolean', default: false }, managed: { type: 'boolean', default: false } } });
if (values.assistant && !values.package) throw new Error('Assistant mode requires an installed package.');
const reports = [];
for (const browser of values.targets.split(',')) {
  assert.ok(['chrome', 'firefox'].includes(browser));
  const root = await mkdtemp(join(tmpdir(), 'pac-spike-')); await chmod(root, 0o700);
  const profile = join(root, 'profile'), extension = join(root, 'extension'), directory = join(root, 'bridge');
  await mkdir(profile); await mkdir(extension);
  const instanceId = randomUUID(), credentialId = randomUUID(), credentialSecret = secret();
  const firefoxId = 'page-as-context-transport-spike@example.test';
  const uuid = '8b9fc251-a07f-46e7-a9c7-025722744528';
  const manifest = { manifest_version: 3, name: 'Page as Context content-free transport probe', version: '0.1.0', permissions: ['nativeMessaging'],
    ...(browser === 'firefox' ? { browser_specific_settings: { gecko: { id: firefoxId, data_collection_permissions: { required: ['none'] } } } } : {}) };
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(extension, 'probe.html'), '<!doctype html><meta charset="utf-8"><title>Content-free MCP probe</title><script src="probe.js"></script><p id="status">Starting synthetic probe</p>');
  // Secrets exist only in a private, temporary test extension. Never use this fixture for real pages.
  await writeFile(join(extension, 'probe.js'), `
    const api = globalThis.browser ?? chrome;
    const port = api.runtime.connectNative('org.page_as_context.bridge');
    globalThis.probeState = 'starting';
    globalThis.disconnectProbe = () => port.disconnect();
    port.onDisconnect.addListener(() => { globalThis.probeError = api.runtime.lastError?.message ?? 'native-disconnected'; globalThis.probeState = 'disconnected'; });
    port.onMessage.addListener(message => {
      if (message.type === 'ready') { globalThis.probeState = 'ready'; return; }
      if (message.type !== 'request') return;
      const allowed = message.credentialId === ${JSON.stringify(credentialId)} && message.credentialSecret === ${JSON.stringify(credentialSecret)} &&
        message.instanceId === ${JSON.stringify(instanceId)} && message.browser === ${JSON.stringify(browser)} &&
        message.request.tool === 'transport_probe' && /^[a-zA-Z0-9_-]{16,80}$/.test(message.request.arguments?.nonce);
      const value = allowed ? { ok: true, nonce: message.request.arguments.nonce, instanceId: ${JSON.stringify(instanceId)}, browser: ${JSON.stringify(browser)} } : { ok: false };
      if (allowed) globalThis.lastProbeNonce = message.request.arguments.nonce;
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const data = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
      port.postMessage({ type: 'result-chunk', id: message.id, index: 0, total: 1, data });
    });
    port.postMessage({ type: 'register', protocol: 1, instanceId: ${JSON.stringify(instanceId)}, browser: ${JSON.stringify(browser)} });
  `);
  if (browser === 'firefox') await writeFile(join(profile, 'user.js'), [
    'user_pref("app.update.enabled", false);', 'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [firefoxId]: uuid }))});`,
  ].join('\n'));
  let runtime, broker, installed = false, client, assistantRoute;
  try {
    runtime = await launch(browser, profile, values[`${browser}-binary`]);
    const protocol = runtime.protocol;
    let extensionId, version, evaluate, openProbe;
    if (browser === 'chrome') {
      version = (await protocol.send('Browser.getVersion')).product;
      ({ id: extensionId } = await protocol.send('Extensions.loadUnpacked', { path: extension }));
      openProbe = async () => {
        const { targetId } = await protocol.send('Target.createTarget', { url: `chrome-extension://${extensionId}/probe.html` });
        const { sessionId } = await protocol.send('Target.attachToTarget', { targetId, flatten: true });
        evaluate = async expression => {
          const result = await protocol.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
          assert.equal(result.exceptionDetails, undefined); return result.result.value;
        };
      };
    } else {
      const session = await protocol.send('session.new', { capabilities: { alwaysMatch: {} } }); version = session.capabilities.browserVersion;
      ({ extension: extensionId } = await protocol.send('webExtension.install', { extensionData: { type: 'path', path: extension } }));
      openProbe = async () => {
        const { context } = await protocol.send('browsingContext.create', { type: 'tab' });
        await protocol.send('browsingContext.navigate', { context, url: `moz-extension://${uuid}/probe.html`, wait: 'complete' });
        evaluate = async expression => {
          const result = await protocol.send('script.evaluate', { expression, target: { context }, awaitPromise: true });
          assert.equal(result.type, 'success'); return result.result.value;
        };
      };
    }
    await install({ directory, ...(browser === 'chrome' ? { chromeId: extensionId, chromeUserData: profile } : { firefoxId: extensionId }) }); installed = true;
    if (!values.managed) broker = await startBroker(await configuration(directory));
    await openProbe();
    let state;
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await evaluate('globalThis.probeState');
      if (state === 'ready' || state === 'disconnected') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (state !== 'ready') console.error(`${browser} native connection: ${await evaluate('globalThis.probeError')}; broker: ${JSON.stringify(broker?.status() ?? { startup: 'managed' })}`);
    assert.equal(state, 'ready', `${browser}: browser-launched native host did not become ready`);
    if (values.managed) await brokerReady(await configuration(directory));
    const credentialPath = join(directory, 'client.json');
    await createPrivateJson(credentialPath, { protocol: PROTOCOL, browser, instanceId, credentialId, secret: credentialSecret });
    const routePath = join(directory, 'route.json');
    await createPrivateJson(routePath, { directory, credential: credentialPath });
    const transport = new StdioClientTransport(values.package ? {
      command: join(resolve(values.package), 'runtime/node'), args: [join(resolve(values.package), 'server.mjs')],
      cwd: root, env: { PATH: '/usr/bin:/bin', PAC_PACKAGE_SPIKE_ROUTE: routePath }, stderr: 'pipe',
    } : { command: process.execPath, args: [resolve('helper/src/cli.mjs'), 'spike-stdio', '--directory', directory, '--credential', credentialPath], stderr: 'pipe' });
    client = new Client({ name: 'page-as-context-live-spike', version: '0.1.0' }); await client.connect(transport);
    const tools = await client.listTools(); assert.deepEqual(tools.tools.map(tool => tool.name), values.package ? ['package_probe', 'transport_probe'] : ['transport_probe']);
    const nonce = randomUUID(); const result = await client.callTool({ name: 'transport_probe', arguments: { nonce } });
    assert.deepEqual(JSON.parse(result.content[0].text), { ok: true, nonce, instanceId, browser });
    if (values.assistant) {
      await client.close(); client = undefined;
      const shared = await privateDirectory(join(homedir(), '.page-as-context/chatgpt-package-spike'));
      const path = join(shared, 'route.json');
      await createPrivateJson(path, { directory, credential: credentialPath }); assistantRoute = path;
      const expected = `pac_assistant_${browser}_nonce_001`;
      console.log(`ASSISTANT_PROBE_READY ${browser}: call transport_probe with nonce ${expected}`);
      let observed = false;
      for (let attempt = 0; attempt < 600; attempt++) {
        if (await evaluate('globalThis.lastProbeNonce') === expected) { observed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert.equal(observed, true, 'No actual assistant nonce was observed within the test window.');
      await unlink(assistantRoute); assistantRoute = undefined;
      reports.push({ browser, assistantNonceObserved: expected, instanceId, content: 'synthetic nonce only; compare the real tool result in the chat transcript' });
      console.log(`ASSISTANT_PROBE_OBSERVED ${browser}`);
      // Resume the SDK driver only to verify rejection after browser disconnect.
      client = new Client({ name: 'page-as-context-disconnect-check', version: '0.1.0' });
      await client.connect(new StdioClientTransport({ command: join(resolve(values.package), 'runtime/node'), args: [join(resolve(values.package), 'server.mjs')],
        cwd: root, env: { PATH: '/usr/bin:/bin', PAC_PACKAGE_SPIKE_ROUTE: routePath }, stderr: 'pipe' }));
    }
    await evaluate('globalThis.disconnectProbe()');
    const disconnected = await client.callTool({ name: 'transport_probe', arguments: { nonce: randomUUID() } }); assert.equal(disconnected.isError, true);
    reports.push({ browser, version, nativeRoundTrip: true, disconnectRejected: true, toolCount: tools.tools.length, content: 'synthetic nonce only',
      brokerAutoStarted: values.managed,
      ...(values.package ? { package: 'installed artifact exercised by SDK driver; not an assistant invocation', nativeRuntime: process.execPath === join(resolve(values.package), 'runtime/node') } : {}) });
    console.log(`${browser}: SDK stdio → private IPC → browser-launched native host → extension round trip passed`);
  } finally {
    let routeCleanupError;
    if (assistantRoute) {
      try {
        const route = await privateJson(assistantRoute);
        assert.equal(route.directory, directory, 'Synthetic route ownership changed; preserve it.');
        await unlink(assistantRoute);
      } catch (error) { if (error.code !== 'ENOENT') routeCleanupError = error; }
    }
    await client?.close(); runtime?.protocol.close(); await runtime?.stop(); await broker?.close();
    if (values.managed && installed) {
      const config = await configuration(directory);
      const info = await brokerReady(config).catch(() => undefined);
      if (info) {
        process.kill(info.pid, 'SIGTERM');
        for (let attempt = 0; attempt < 100; attempt++) {
          try { await brokerReady(config); } catch { break; }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
    }
    if (installed) await uninstall(directory);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    if (routeCleanupError) throw routeCleanupError;
  }
}
if (values.report) {
  await mkdir(resolve(values.report, '..'), { recursive: true });
  await writeFile(values.report, JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    sdk: '1.32.2', protocol: '2025-11-25', reports, limitations: [
      'Content-free test extensions; production permissions, pairing, page capture and actions are not covered.',
      values.assistant ? 'Compare observed nonces with actual assistant tool results. Fixture setup and broker startup remain developer-managed.' : 'Actual assistant invocation is not covered.',
    ] }, null, 2) + '\n');
}
