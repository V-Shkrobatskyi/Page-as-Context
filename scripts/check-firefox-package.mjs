// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

assert.equal(process.argv.length, 2, 'This checker accepts only the shared Firefox package');
const buildDirectory = '.output/firefox-mv3';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const archiveName = `.output/${pkg.name}-${pkg.version}-firefox.zip`;
const sourceName = `.output/${pkg.name}-${pkg.version}-sources.zip`;
const extension = await JSZip.loadAsync(await readFile(archiveName));
const source = await JSZip.loadAsync(await readFile(sourceName));
const paths = (zip) => Object.values(zip.files).filter((file) => !file.dir).map((file) => file.name).sort();
const safe = (path) => assert.ok(!path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), `Unsafe ZIP path: ${path}`);
const allowedRoots = new Set(['package.json', 'package-lock.json', 'wxt.config.ts', 'tsconfig.json', 'vitest.config.ts', 'README.md', 'CONTRIBUTING.md', 'LICENSE', 'LICENSING.md', 'BUILDING.md', 'CHANGELOG.md', 'PRIVACY.md', '.nvmrc', 'entrypoints', 'src', 'public', 'scripts', 'tests', 'docs']);
for (const path of paths(source)) {
  safe(path);
  assert.ok(allowedRoots.has(path.split('/')[0]), `Unapproved source root: ${path}`);
  assert.ok(!/(?:^|\/)(?:dev_notes|node_modules|\.git|\.agents|\.codex|\.wxt|\.output|\.env[^/]*|\.DS_Store)(?:\/|$)/u.test(path), `Private/generated source content: ${path}`);
  assert.ok(!/\.(?:pem|key|p12|pfx|log)$/iu.test(path), `Unexpected private artifact: ${path}`);
}
for (const required of ['package.json', 'package-lock.json', 'wxt.config.ts', 'tsconfig.json', 'BUILDING.md', 'LICENSE', 'LICENSING.md', 'PRIVACY.md', '.nvmrc', 'src/platform/manifest.ts', 'src/download-context.ts', 'entrypoints/background.ts', 'entrypoints/dom-capture.ts', 'public/license.html', 'public/THIRD_PARTY_NOTICES.txt']) assert.ok(source.file(required), `Missing reviewer source: ${required}`);
for (const required of ['LICENSE', 'LICENSING.md', 'public/THIRD_PARTY_NOTICES.txt']) {
  assert.equal(await source.file(required).async('string'), await readFile(required, 'utf8'), `Source notice mismatch: ${required}`);
}
assert.equal(await source.file('package-lock.json').async('string'), await readFile('package-lock.json', 'utf8'));
assert.equal(await source.file('package.json').async('string'), await readFile('package.json', 'utf8'));

async function buildPaths(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Build contains a symbolic link');
    if (entry.isDirectory()) result.push(...await buildPaths(join(directory, entry.name), `${prefix}${entry.name}/`));
    else result.push(`${prefix}${entry.name}`);
  }
  return result.sort();
}
assert.deepEqual(paths(extension), await buildPaths(buildDirectory));
for (const path of paths(extension)) {
  safe(path);
  assert.deepEqual(await extension.file(path).async('nodebuffer'), await readFile(join(buildDirectory, path)), `Package/build mismatch: ${path}`);
}
const manifest = JSON.parse(await extension.file('manifest.json').async('string'));
assert.equal(manifest.version, pkg.version);
assert.deepEqual(manifest.browser_specific_settings.gecko_android, { strict_min_version: '142.0' });
assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'clipboardWrite', 'storage', 'alarms'].sort());
assert.deepEqual(manifest.optional_permissions, ['downloads', 'nativeMessaging']);
assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
assert.ok(!manifest.host_permissions?.length && !manifest.content_scripts?.length);
assert.equal(await extension.file('LICENSE').async('string'), await readFile('LICENSE', 'utf8'));
assert.ok(extension.file('THIRD_PARTY_NOTICES.txt'));
assert.equal(await extension.file('privacy.html').async('string'), await readFile('public/privacy.html', 'utf8'));
for (const name of [archiveName, sourceName]) console.log(`${name}: SHA-256 ${createHash('sha256').update(await readFile(name)).digest('hex')}`);
console.log(`Unsigned shared Desktop/Android package: ${paths(extension).length} matching files; reviewer source: ${paths(source).length} allowlisted files; local plans/reports excluded`);
