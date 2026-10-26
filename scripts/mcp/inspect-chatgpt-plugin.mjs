// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

// Read-only plugin discovery through the installed client's real loader. No turns.
const marketplacePath = process.argv[2];
if (!marketplacePath) throw new Error('Provide the absolute marketplace.json path.');
const child = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
const send = (id, method, params) => child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
let settled = false;
const finish = error => {
  if (settled) return; settled = true; clearTimeout(timer);
  child.kill();
  if (error) { console.error(error.message); process.exitCode = 1; }
};
const timer = setTimeout(() => finish(new Error('Plugin discovery timed out.')), 15000);
child.on('error', finish);
child.on('exit', () => { if (!settled) finish(new Error('App-server exited before plugin discovery completed.')); });
// Do not dump other plugin diagnostics or user configuration into test output.
child.stderr.resume();
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let value; try { value = JSON.parse(line); } catch { return; }
  if (![1, 2, 3].includes(value.id)) return;
  try {
    if (value.error) throw new Error(`Plugin discovery RPC failed (${value.error.code}).`);
    if (value.id === 1) {
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
      send(2, 'plugin/read', { pluginName: 'page-as-context-package-spike', marketplacePath: resolve(marketplacePath) });
    } else if (value.id === 2) {
      const plugin = value.result.plugin;
      assert.equal(plugin.summary.installed, true);
      assert.equal(plugin.summary.enabled, true);
      assert.deepEqual(plugin.mcpServers, ['page-as-context-package-spike'], 'Installed/enabled plugin must expose its declared MCP server through the actual loader.');
      console.log(JSON.stringify({ passed: true, pluginId: plugin.summary.id, version: plugin.summary.localVersion, mcpServers: plugin.mcpServers,
        limitation: 'Loader discovery only; an actual assistant tool invocation remains required.' }, null, 2));
      send(3, 'mcpServerStatus/list', { limit: 100, detail: 'toolsAndAuthOnly' });
    } else {
      const own = value.result.data.filter(server => server.pluginId === 'page-as-context-package-spike@page-as-context-local');
      assert.equal(own.length, 1, 'The app-server must discover one MCP connection for this plugin.');
      assert.equal(own[0].toolsError, null, 'Actual client tool discovery must succeed.');
      assert.deepEqual(Object.keys(own[0].tools).sort(), ['package_probe', 'transport_probe']);
      console.log(JSON.stringify({ clientToolDiscovery: true, tools: Object.keys(own[0].tools).sort() }, null, 2));
      finish();
    }
  } catch (error) { finish(error); }
});
send(1, 'initialize', { clientInfo: { name: 'pac-package-loader-check', title: null, version: '0.1.0' }, capabilities: { experimentalApi: true, requestAttestation: false } });
