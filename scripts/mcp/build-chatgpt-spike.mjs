// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { readFile, mkdir, cp, copyFile, chmod, writeFile, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { archive: { type: 'string' }, output: { type: 'string', default: 'artifacts/mcp/chatgpt-spike' } } });
if (!values.archive) throw new Error('Pass --archive pointing to the official node-v24.10.0-darwin-arm64.tar.gz archive.');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This spike targets macOS arm64 only.');
const archive = resolve(values.archive), output = resolve(values.output);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// Pinned from https://nodejs.org/dist/v24.10.0/SHASUMS256.txt; no runtime downloads.
const expected = 'fbc3d6e1e1d962450d058e918214373872cc4c46e08673f31c35932afac4a8c5';
if (sha256(await readFile(archive)) !== expected) throw new Error('Official Node archive checksum mismatch.');
// Never delete or overwrite an existing build or unrelated directory.
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
const plugin = join(output, 'plugins/page-as-context-package-spike');
await mkdir(join(output, '.agents/plugins'), { recursive: true });
await mkdir(join(plugin, 'runtime'), { recursive: true });
await cp(join(repo, 'integrations/chatgpt/spike'), plugin, { recursive: true });
execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', join(plugin, 'runtime'), '--strip-components=2', 'node-v24.10.0-darwin-arm64/bin/node']);
execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', join(plugin, 'runtime'), '--strip-components=1', 'node-v24.10.0-darwin-arm64/LICENSE']);
await chmod(join(plugin, 'runtime/node'), 0o755);
await mkdir(join(plugin, 'helper'));
for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'MCP_SDK_LICENSE', 'THIRD_PARTY_NOTICES.txt']) await copyFile(join(repo, 'helper', name), join(plugin, 'helper', name));
await cp(join(repo, 'helper/src'), join(plugin, 'helper/src'), { recursive: true });
// Install only locked production dependencies, without package lifecycle scripts.
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--bin-links=false', '--offline', '--no-audit', '--no-fund', '--prefix', join(plugin, 'helper')], { stdio: 'pipe' });
const lock = JSON.parse(await readFile(join(plugin, 'helper/package-lock.json'), 'utf8'));
await writeFile(join(plugin, 'DEPENDENCIES.json'), JSON.stringify({ node: { version: '24.10.0', platform: 'darwin', arch: 'arm64', archiveSha256: expected },
  packages: Object.entries(lock.packages).filter(([path]) => path).map(([path, entry]) => ({ path, version: entry.version, license: entry.license, integrity: entry.integrity })) }, null, 2) + '\n');
await writeFile(join(output, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'page-as-context-local', interface: { displayName: 'Page as Context local tests' },
  plugins: [{ name: 'page-as-context-package-spike', source: { source: 'local', path: './plugins/page-as-context-package-spike' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Developer Tools' }] }, null, 2) + '\n');
const { readdir } = await import('node:fs/promises');
const hashes = {};
async function inventory(directory, prefix = '') {
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), relative = prefix + name, stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('Symlinks are not allowed in the artifact.');
    if (stat.isDirectory()) await inventory(path, relative + '/');
    else hashes[relative] = sha256(await readFile(path));
  }
}
await inventory(output);
await writeFile(join(output, 'SHA256SUMS.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(`Built content-free ChatGPT marketplace: ${output}`);
