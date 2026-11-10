import { packageUserGuide } from './package-user-guide.mjs';
// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readFile, writeFile, mkdir, cp, copyFile, chmod, lstat, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: {
  archive: { type: 'string' }, output: { type: 'string' }, version: { type: 'string' }, probe: { type: 'boolean', default: false },
} });
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This package targets macOS Apple silicon only.');
const source = join(repo, 'integrations/github-copilot-app', values.probe ? 'spike' : 'package');
const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8'));
manifest.version = values.version ?? manifest.version;
if (!values.archive || !values.output || !/^\d+\.\d+\.\d+$/u.test(manifest.version)) throw new Error('Pass --archive, a new --output directory and an optional semantic --version.');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const archive = resolve(values.archive), output = resolve(values.output);
// Pinned official Node 24.10.0 darwin-arm64 archive, shared with the existing packages.
const expected = 'fbc3d6e1e1d962450d058e918214373872cc4c46e08673f31c35932afac4a8c5';
if (sha256(await readFile(archive)) !== expected) throw new Error('Official Node archive checksum mismatch.');
await mkdir(dirname(output), { recursive: true });
await mkdir(output); // Never overwrite an existing release.
const marketplace = join(output, 'marketplace'), plugin = join(marketplace, 'plugins/page-as-context');
await cp(source, plugin, { recursive: true, errorOnExist: true, force: false });
await writeFile(join(plugin, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
const userGuide = await packageUserGuide(repo, 'github-copilot-app');
await writeFile(join(plugin, 'README.md'), userGuide);
await mkdir(join(plugin, 'runtime'));
execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', join(plugin, 'runtime'), '--strip-components=2', 'node-v24.10.0-darwin-arm64/bin/node']);
execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', join(plugin, 'runtime'), '--strip-components=1', 'node-v24.10.0-darwin-arm64/LICENSE']);
await chmod(join(plugin, 'runtime/node'), 0o755);
await mkdir(join(plugin, 'helper'));
for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'MCP_SDK_LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
  await copyFile(join(repo, 'helper', name), join(plugin, 'helper', name));
}
// The content-free probe deliberately has no browser helper implementation.
if (!values.probe) await cp(join(repo, 'helper/src'), join(plugin, 'helper/src'), { recursive: true });
execFileSync('npm', ['ci', '--prefix', join(plugin, 'helper'), '--omit=dev', '--ignore-scripts', '--bin-links=false', '--offline', '--no-audit', '--no-fund'], { stdio: 'pipe' });
const lock = JSON.parse(await readFile(join(plugin, 'helper/package-lock.json'), 'utf8'));
await writeFile(join(plugin, 'DEPENDENCIES.json'), JSON.stringify({
  node: { version: '24.10.0', platform: 'darwin', arch: 'arm64', archiveSha256: expected },
  packages: Object.entries(lock.packages).filter(([path]) => path).map(([path, entry]) => ({ path, version: entry.version, license: entry.license, integrity: entry.integrity })),
}, null, 2) + '\n');
await mkdir(join(marketplace, '.github/plugin'), { recursive: true });
await writeFile(join(marketplace, '.github/plugin/marketplace.json'), JSON.stringify({
  name: values.probe ? 'page-as-context-copilot-app-probe' : 'page-as-context-copilot-app',
  owner: { name: 'Vitalii Shkrobatskyi' },
  plugins: [{ name: manifest.name, source: './plugins/page-as-context', version: manifest.version, description: manifest.description }],
}, null, 2) + '\n');
const files = {};
async function inventory(root, prefix = '') {
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name), stat = await lstat(path), relative = prefix + name;
    if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error('Unsafe package entry.');
    if (stat.isDirectory()) await inventory(path, relative + '/');
    else files[relative] = sha256(await readFile(path));
  }
}
await inventory(marketplace);
await writeFile(join(marketplace, 'PACKAGE.json'), JSON.stringify({ format: 1, version: manifest.version, platform: 'darwin', arch: 'arm64', files }, null, 2) + '\n');
await writeFile(join(output, 'README.md'), userGuide);
const zip = `Page-as-Context-GitHub-Copilot-App-${manifest.version}-macOS-arm64${values.probe ? '-probe' : ''}-plugin.zip`;
execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', marketplace, join(output, zip)]);
await writeFile(join(output, 'SHA256SUMS.txt'), `${sha256(await readFile(join(output, zip)))}  ${zip}\n`);
console.log(JSON.stringify({ marketplace, archive: join(output, zip), version: manifest.version, probe: values.probe, actualClientAcceptance: false, packageFiles: Object.keys(files).length }));
