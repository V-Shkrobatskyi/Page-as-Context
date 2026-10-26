#!/usr/bin/env node
// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { parseArgs } from 'node:util';
import { configuration, defaultDirectory, privateJson } from './security.mjs';
import { startBroker } from './broker.mjs';
import { install, uninstall } from './install.mjs';
import { serveMcp } from './mcp.mjs';
import { validateCredential } from './client.mjs';
import { pairClient } from './pairing.mjs';
import { randomUUID } from 'node:crypto';
import { secret, PROTOCOL, createPrivateJson } from './security.mjs';
import { ensureBroker, brokerReady } from './startup.mjs';

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    directory: { type: 'string', default: defaultDirectory() }, credential: { type: 'string' },
    'chrome-id': { type: 'string' }, 'firefox-id': { type: 'string' },
    'chrome-user-data': { type: 'string' },
    instance: { type: 'string' }, browser: { type: 'string' }, name: { type: 'string' },
  } });
  if (positionals.length !== 1) throw new Error('command-required');
  const command = positionals[0];
  if (command === 'install') {
    await install({ directory: values.directory, chromeId: values['chrome-id'], firefoxId: values['firefox-id'], chromeUserData: values['chrome-user-data'] });
    process.stderr.write('Native host installed. The bridge starts automatically when the extension or MCP client connects.\n');
  } else if (command === 'uninstall') {
    await uninstall(values.directory); process.stderr.write('Native host uninstalled. Credential files were retained.\n');
  } else {
    const config = await configuration(values.directory);
    if (command === 'broker') {
      const broker = await startBroker(config);
      const stop = () => void broker.close();
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
      process.stderr.write('Page as Context broker ready.\n');
    } else if (command === 'ensure-broker') {
      await ensureBroker(config);
      process.stderr.write('Page as Context broker ready.\n');
    } else if (command === 'doctor') {
      await brokerReady(config);
      process.stderr.write('Private configuration and broker socket available. Browser registration still requires a live probe.\n');
    } else if (command === 'pair') {
      if (!values.credential || !values.instance || !['chrome', 'firefox'].includes(values.browser)) throw new Error('credential-file-required');
      let credential;
      try { credential = await privateJson(values.credential); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        credential = { protocol: PROTOCOL, browser: values.browser, instanceId: values.instance, credentialId: randomUUID(), secret: secret() };
        await createPrivateJson(values.credential, credential);
      }
      validateCredential(credential);
      if (credential.browser !== values.browser || credential.instanceId !== values.instance) throw new Error('credential-target-mismatch');
      await pairClient(config, credential, { ...(values.name !== undefined ? { name: values.name } : {}), onStatus(result) {
        if (result.status === 'waiting-for-browser') process.stderr.write('Waiting for the selected browser instance. Click Start helper connection in the extension within 60 seconds.\n');
        else if (result.status === 'pending') process.stderr.write(`In MCP settings, click Refresh status, then find Pairing and clients > Pairing requests. Compare code ${result.code} and click Approve pairing within 2 minutes. Keep this command running.\n`);
        else process.stderr.write('Pairing approved. Connect a tab in the extension.\n');
      } });
    } else if (command === 'stdio' || command === 'spike-stdio') {
      if (!values.credential) throw new Error('credential-file-required');
      await serveMcp(config, await privateJson(values.credential), process.stdin, process.stdout, command === 'spike-stdio');
    } else throw new Error('unknown-command');
  }
} catch (error) {
  const allowed = new Set(['command-required', 'credential-file-required', 'unknown-command', 'broker-unavailable', 'broker-incompatible', 'broker-runtime-unavailable', 'broker-start-failed', 'broker-start-timeout', 'unsafe-socket', 'runtime-license-required', 'unsafe-directory', 'unsafe-file', 'windows-not-validated', 'installation-already-exists', 'invalid-extension-id', 'extension-id-required', 'invalid-config', 'invalid-credential', 'invalid-client-name', 'credential-target-mismatch', 'not-connected', 'capture-timeout', 'pairing-rejected', 'pairing-code-changed', 'pairing-approval-timeout', 'browser-connection-timeout']);
  process.stderr.write(`Page as Context helper: ${allowed.has(error.message) ? error.message : 'operation-failed'}.\n`);
  process.exitCode = 1;
}
