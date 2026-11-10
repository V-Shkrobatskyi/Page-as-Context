// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, rm, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { verifyPackage } from '../../helper/src/desktop-package.mjs';

const source = resolve(process.argv[2] ?? '');
const probe = process.argv[3] === '--probe';
if (!process.argv[2] || process.argv.length > (probe ? 4 : 3)) throw new Error('Pass MARKETPLACE [--probe]. Use its bundled runtime/node.');
assert.equal(process.version, 'v24.10.0');
assert.ok(process.execPath.endsWith('/runtime/node'));
const release = await verifyPackage(source);
const root = await mkdtemp('/private/tmp/pac-copilot-package-');
try {
  const installed = join(root, 'installed copy with spaces');
  await cp(source, installed, { recursive: true });
  await verifyPackage(installed);
  const plugin = join(installed, 'plugins/page-as-context');
  const readJson = async path => JSON.parse(await readFile(join(plugin, path), 'utf8'));
  const manifest = await readJson('plugin.json');
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(manifest.version, release.version);
  assert.deepEqual(Object.keys(manifest).sort(), ['$schema', 'author', 'description', 'license', 'name', 'version']);
  const catalog = JSON.parse(await readFile(join(installed, '.github/plugin/marketplace.json'), 'utf8'));
  assert.equal(catalog.name, `page-as-context-copilot-app${probe ? '-probe' : ''}`);
  assert.deepEqual(catalog.plugins, [{ name: manifest.name, source: './plugins/page-as-context', version: manifest.version, description: manifest.description }]);
  assert.ok((await stat(join(plugin, 'runtime/node'))).mode & 0o111);
  const config = await readJson('mcp.json');
  assert.equal(config.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  const names = probe ? ['loader-probe'] : ['browser-chrome', 'browser-firefox'];
  assert.deepEqual(Object.keys(config.mcpServers).sort(), names);
  const imported = path => import(pathToFileURL(join(plugin, path)));
  const { Client } = await imported('helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const { StdioClientTransport } = await imported('helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  for (const name of names) {
    const entry = config.mcpServers[name], browser = name.replace('browser-', '');
    assert.deepEqual(entry, { type: 'stdio', command: './runtime/node', args: ['${PLUGIN_ROOT}/server.mjs', ...(probe ? [] : [browser])], cwd: './', env: { NODE_OPTIONS: '', NODE_PATH: '' } });
    const expand = value => value.replaceAll('${PLUGIN_ROOT}', plugin);
    const state = join(root, `state-${name}`);
    const args = entry.args.map(expand);
    if (!probe) args.push('--directory', state, '--manifest-home', join(root, 'isolated native manifests'));
    const client = new Client({ name: 'copilot-manifest-check', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: resolve(plugin, entry.command), args, cwd: resolve(plugin, entry.cwd), env: { PATH: '/usr/bin:/bin', ...entry.env }, stderr: 'pipe' }));
      if (probe) {
        assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['loader_probe']);
        const nonce = randomUUID();
        const result = await client.callTool({ name: 'loader_probe', arguments: { nonce } });
        assert.deepEqual(JSON.parse(result.content[0].text), { nonce, browserAccess: false });
      } else {
        const status = await client.callTool({ name: 'setup_status', arguments: {} });
        assert.equal(JSON.parse(status.content[0].text).nativeInstalled, false);
        assert.deepEqual(await readdir(state).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
      }
    } finally { await client.close(); }
  }
  if (!probe) {
    const rejected = spawnSync(join(plugin, 'runtime/node'), [join(plugin, 'server.mjs'), 'invalid-browser', '--directory', join(root, 'invalid-state')], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin' } });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /exactly chrome or firefox/);
    const skill = await readFile(join(plugin, 'skills/browser-setup/SKILL.md'), 'utf8');
    assert.ok(skill.includes('Never approve pairing'));
    for (const browser of ['chrome', 'firefox']) {
      const result = spawnSync(join(plugin, 'runtime/node'), [fileURLToPath(new URL('./check-chatgpt-package.mjs', import.meta.url)), installed, 'github-copilot-app', browser], { encoding: 'utf8', timeout: 120000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      process.stdout.write(result.stdout);
    }
  }
  console.log(JSON.stringify({ passed: true, probe, manifestLaunchFromCopiedArtifact: true, pathWithSpaces: true, globalNodeRequired: false, actualCopilotAppAcceptance: false }));
} finally { await rm(root, { recursive: true, force: true }); }
