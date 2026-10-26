// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Client } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const { values } = parseArgs({ options: { marketplace: { type: 'string' }, installed: { type: 'string' } } });
if (!values.marketplace || !values.installed) throw new Error('Provide --marketplace and --installed paths.');
const marketplace = resolve(values.marketplace), installed = resolve(values.installed);
const hashes = JSON.parse(await readFile(join(marketplace, 'SHA256SUMS.json'), 'utf8'));
let count = 0;
async function verify(directory, prefix = '') {
  for (const name of await readdir(directory)) {
    const relative = prefix + name, path = join(directory, name), stat = await lstat(path);
    assert.ok(!stat.isSymbolicLink(), `Unexpected symlink: ${relative}`);
    if (stat.isDirectory()) await verify(path, relative + '/');
    else {
      assert.ok(Object.hasOwn(hashes, 'plugins/page-as-context-package-spike/' + relative), `Unexpected file: ${relative}`);
      assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), hashes['plugins/page-as-context-package-spike/' + relative]);
      count++;
    }
  }
}
await verify(installed);
assert.equal(count, Object.keys(hashes).filter(path => path.startsWith('plugins/page-as-context-package-spike/')).length);
const manifest = JSON.parse(await readFile(join(installed, 'mcp.json'), 'utf8'));
const entry = manifest.mcpServers['page-as-context-package-spike'];
const expand = value => value.replaceAll('${PLUGIN_ROOT}', installed);
const client = new Client({ name: 'page-as-context-installed-package-check', version: '0.1.0' });
assert.match(entry.command, /^\.\/[^$]+$/u, 'Portable bundled command must be a contained ./ path.');
const transport = new StdioClientTransport({ command: resolve(installed, entry.command), args: entry.args.map(expand), cwd: '/private/tmp',
  env: { PATH: '/usr/bin:/bin', PAC_PACKAGE_SPIKE_ROUTE: join(marketplace, 'nonexistent-route.json') }, stderr: 'pipe' });
try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['package_probe', 'transport_probe']);
  const nonce = 'pac_chatgpt_install_001';
  const result = JSON.parse((await client.callTool({ name: 'package_probe', arguments: { nonce } })).content[0].text);
  assert.deepEqual(result, { ok: true, nonce, node: 'v24.10.0', platform: 'darwin', arch: 'arm64', bundledRuntime: true, installedCache: true, pageAccess: false });
  await assert.rejects(client.callTool({ name: 'package_probe', arguments: { nonce, extra: true } }), /16–80/u);
  await assert.rejects(client.callTool({ name: 'read_page_context', arguments: { nonce } }), /16–80/u);
  assert.equal((await client.callTool({ name: 'transport_probe', arguments: { nonce } })).isError, true);
  console.log(JSON.stringify({ passed: true, installedFilesVerified: count, result, checks: ['manifest expansion', 'cache inventory hashes', 'bundled runtime', 'minimal PATH', 'cwd outside checkout', 'strict arguments', 'no page tools', 'missing route fails closed'], limitation: 'SDK process test; actual ChatGPT assistant invocation remains required.' }, null, 2));
} finally { await client.close(); }
