// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readFile, writeFile, mkdir, cp, copyFile, chmod, lstat, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { packExtension, getAllFilesWithCount, VERSIONED_MANIFEST_SCHEMAS } from '../../integrations/claude/node_modules/@anthropic-ai/mcpb/dist/index.js';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { archive: { type: 'string' }, output: { type: 'string' } } });
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This package targets macOS Apple silicon only.');
if (!values.archive || !values.output) throw new Error('Pass --archive and a new --output directory.');
const hash = value => createHash('sha256').update(value).digest('hex');
const archive = resolve(values.archive), output = resolve(values.output);
const expected = 'fbc3d6e1e1d962450d058e918214373872cc4c46e08673f31c35932afac4a8c5';
if (hash(await readFile(archive)) !== expected) throw new Error('Official Node archive checksum mismatch.');
const tooling = JSON.parse(await readFile(join(repo, 'integrations/claude/node_modules/@anthropic-ai/mcpb/package.json'), 'utf8'));
if (tooling.version !== '2.1.2') throw new Error('Install the pinned MCPB tooling with npm ci --prefix integrations/claude.');
await mkdir(dirname(output), { recursive: true }); await mkdir(output);
const bundle = join(output, 'bundle');
await cp(join(repo, 'integrations/claude/package'), bundle, { recursive: true });
await mkdir(join(bundle, 'runtime'));
execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', join(bundle, 'runtime'), '--strip-components=2', 'node-v24.10.0-darwin-arm64/bin/node']);
execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', join(bundle, 'runtime'), '--strip-components=1', 'node-v24.10.0-darwin-arm64/LICENSE']);
await chmod(join(bundle, 'runtime/node'), 0o755);
await mkdir(join(bundle, 'helper'));
for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'MCP_SDK_LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
  await copyFile(join(repo, 'helper', name), join(bundle, 'helper', name));
}
await cp(join(repo, 'helper/src'), join(bundle, 'helper/src'), { recursive: true });
execFileSync('npm', ['ci', '--prefix', join(bundle, 'helper'), '--omit=dev', '--ignore-scripts', '--bin-links=false', '--offline', '--no-audit', '--no-fund'], { stdio: 'pipe' });
await copyFile(join(repo, 'integrations/claude/PACKAGE-README.md'), join(bundle, 'README.md'));
await copyFile(join(repo, 'helper/LICENSE'), join(bundle, 'LICENSE'));
// Preserve the exact dependency lock even though the packer excludes package-lock.json.
await copyFile(join(repo, 'helper/package-lock.json'), join(bundle, 'DEPENDENCY-LOCK.json'));
await writeFile(join(bundle, 'DEPENDENCIES.json'), JSON.stringify({ node: { version: '24.10.0', platform: 'darwin', arch: 'arm64', archiveSha256: expected },
  sdk: '1.32.2', manifestSchema: '0.3', buildTool: { name: tooling.name, version: tooling.version, license: tooling.license } }, null, 2) + '\n');
async function noSymlinks(root) {
  for (const name of await readdir(root)) {
    const path = join(root, name), stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error('Unsafe package entry.');
    if (stat.isDirectory()) await noSymlinks(path);
  }
}
await noSymlinks(bundle);
const manifest = VERSIONED_MANIFEST_SCHEMAS['0.3'].parse(JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')));
const packed = getAllFilesWithCount(bundle).files;
const files = Object.fromEntries(Object.entries(packed).sort(([a], [b]) => a.localeCompare(b)).map(([path, value]) => [path, hash(value.data)]));
await writeFile(join(bundle, 'PACKAGE.json'), JSON.stringify({ format: 1, client: 'claude', version: manifest.version, platform: 'darwin', arch: 'arm64', files }, null, 2) + '\n');
const filename = `Page-as-Context-Claude-${manifest.version}-macOS-arm64.mcpb`;
if (!await packExtension({ extensionPath: bundle, outputPath: join(output, filename), silent: true })) throw new Error('MCPB packaging failed.');
await writeFile(join(output, 'SHA256SUMS.txt'), `${hash(await readFile(join(output, filename)))}  ${filename}\n`);
console.log(JSON.stringify({ archive: join(output, filename), version: manifest.version, schema: '0.3', tooling: tooling.version, bundledNode: '24.10.0', packageFiles: Object.keys(files).length + 1 }));
