// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink, readdir, cp, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { verifyPackage, installDesktopPackage, removeDesktopPackage, recoverDesktopPackage, catalog, stagePackage, MARKETPLACE } from '../src/desktop-package.mjs';
import { install } from '../src/install.mjs';
import { inspectNative, updateNativeRuntime, recoverRuntime } from '../src/runtime-lifecycle.mjs';
import { createPrivateJson } from '../src/security.mjs';
import { packageClient } from '../src/package-client.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
async function temp(t) { const path = await mkdtemp(join(tmpdir(), 'pac-desktop-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
async function artifact(root, version) {
  const directory = join(root, `Release ${version}`), files = { 'plugins/page-as-context/plugin.json': JSON.stringify({ name: 'page-as-context', version }), 'plugins/page-as-context/server.mjs': '// synthetic fixture\n' };
  await mkdir(join(directory, 'plugins/page-as-context'), { recursive: true });
  for (const [path, bytes] of Object.entries(files)) await writeFile(join(directory, path), bytes);
  await writeFile(join(directory, 'PACKAGE.json'), JSON.stringify({ format: 1, version, platform: 'darwin', arch: 'arm64', files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, hash(bytes)])) }));
  return directory;
}
function fakeCodex() {
  const calls = [], marketplaces = [];
  let failInstall = false;
  return { calls, marketplaces, failOnce() { failInstall = true; }, async run(args) {
    calls.push(args);
    if (args[1] === 'marketplace' && args[2] === 'list') return JSON.stringify({ marketplaces });
    if (args[1] === 'marketplace' && args[2] === 'add') marketplaces.push({ name: MARKETPLACE, root: args[3] });
    if (args[1] === 'marketplace' && args[2] === 'upgrade') throw new Error('Local marketplaces cannot use Git upgrade');
    if (args[1] === 'marketplace' && args[2] === 'remove') { const index = marketplaces.findIndex(item => item.name === args[3]); if (index >= 0) marketplaces.splice(index, 1); }
    if (args[1] === 'add' && failInstall) { failInstall = false; throw new Error('synthetic-install-failure'); }
    return '{}';
  } };
}
test('installed package survives removal of its source and can be removed without unrelated files', async t => {
  const root = await temp(t), source = await artifact(root, '1.0.0'), directory = join(root, 'Private state'), cli = fakeCodex();
  const result = await installDesktopPackage(source, directory, { run: cli.run });
  await rename(source, join(root, 'source moved away'));
  assert.equal((await verifyPackage(result.packagePath)).version, '1.0.0');
  await writeFile(join(directory, 'keep.txt'), 'unrelated');
  await removeDesktopPackage(directory, { run: cli.run, removeFiles: true });
  assert.equal(await readFile(join(directory, 'keep.txt'), 'utf8'), 'unrelated');
  assert.deepEqual(await readdir(join(directory, 'chatgpt/releases')), []);
  assert.equal(cli.marketplaces.length, 0);
});
test('failed update restores the previous catalog and plugin without losing the old release', async t => {
  const root = await temp(t), directory = join(root, 'state'), cli = fakeCodex();
  await installDesktopPackage(await artifact(root, '1.0.0'), directory, { run: cli.run });
  const before = await readFile(join(directory, 'chatgpt/.agents/plugins/marketplace.json'));
  cli.failOnce();
  await assert.rejects(installDesktopPackage(await artifact(root, '1.0.1'), directory, { run: cli.run }), /synthetic-install-failure/u);
  assert.deepEqual(await readFile(join(directory, 'chatgpt/.agents/plugins/marketplace.json')), before);
  assert.equal(JSON.parse(await readFile(join(directory, 'chatgpt/deployment.json'))).version, '1.0.0');
  assert.equal((await verifyPackage(join(directory, 'chatgpt/releases/1.0.0'))).version, '1.0.0');
});
test('tampered artifacts, symlinks and foreign marketplace ownership fail closed', async t => {
  const root = await temp(t), source = await artifact(root, '1.0.0');
  await writeFile(join(source, 'plugins/page-as-context/server.mjs'), 'tampered');
  await assert.rejects(verifyPackage(source), /checksum/u);
  const second = await artifact(root, '1.0.1');
  await symlink('/etc/hosts', join(second, 'linked-file'));
  await assert.rejects(verifyPackage(second), /unsafe-package-entry/u);
  const third = await artifact(root, '1.0.2'), cli = fakeCodex(); cli.marketplaces.push({ name: MARKETPLACE, root: '/somewhere/else' });
  await assert.rejects(installDesktopPackage(third, join(root, 'state'), { run: cli.run }), /marketplace-name-in-use/u);
  assert.equal(cli.calls.some(args => args[1] === 'add'), false);
});
test('uninstall refuses modified release files before removing the registered plugin', async t => {
  const root = await temp(t), cli = fakeCodex(), directory = join(root, 'state');
  const result = await installDesktopPackage(await artifact(root, '1.0.0'), directory, { run: cli.run });
  await writeFile(join(result.packagePath, 'plugins/page-as-context/server.mjs'), 'foreign replacement');
  const before = cli.calls.length;
  await assert.rejects(removeDesktopPackage(directory, { run: cli.run, removeFiles: true }), /checksum/u);
  assert.equal(cli.calls.slice(before).some(args => args[1] === 'remove'), false);
});
async function nativeFixture(t) {
  const root = await temp(t), directory = join(root, 'private');
  await install({ directory, chromeId: 'a'.repeat(32), manifestHome: root, platform: 'darwin' });
  const license = await readFile(join(directory, 'runtime/LICENSE'));
  await updateNativeRuntime(directory, { license, adoptExisting: true });
  const next = join(root, 'next'); await cp(new URL('../src/', import.meta.url), next, { recursive: true });
  await writeFile(join(next, 'broker.mjs'), (await readFile(join(next, 'broker.mjs'), 'utf8')) + '\n// Synthetic next version.\n');
  return { directory, license, source: pathToFileURL(next + '/') };
}
for (const failure of ['staged', 'backup', 'activated', 'recorded']) test(`native update rolls back after failure at ${failure}`, async t => {
  const { directory, license, source } = await nativeFixture(t), before = await inspectNative(directory);
  await assert.rejects(updateNativeRuntime(directory, { license, source, fault(point) { if (point === failure) throw new Error('synthetic-failure'); } }), /synthetic-failure/u);
  assert.deepEqual((await inspectNative(directory)).hashes, before.hashes);
  assert.equal(await recoverRuntime(directory), false);
});
test('native compatible update preserves installation identity and detects foreign runtime changes', async t => {
  const { directory, license, source } = await nativeFixture(t), before = await inspectNative(directory);
  await updateNativeRuntime(directory, { license, source });
  const after = await inspectNative(directory);
  assert.equal(after.config.installationId, before.config.installationId);
  assert.equal(after.config.hostSecret, before.config.hostSecret);
  assert.notEqual(after.hashes['broker.mjs'], before.hashes['broker.mjs']);
  await writeFile(join(directory, 'runtime/broker.mjs'), '// unrecognized replacement\n');
  await assert.rejects(updateNativeRuntime(directory, { license, source }), /runtime-changed/u);
});
test('unconfigured package client never creates credentials or registers a native host', async t => {
  const directory = join(await temp(t), 'unconfigured'), client = packageClient('firefox', directory); t.after(() => client.close());
  await assert.rejects(client.request({ tool: 'read_page_context', arguments: { connectionId: 'synthetic_connection' } }));
  assert.deepEqual(await readdir(directory), []);
});


test('an interrupted plugin update is recovered using its owned previous catalog', async t => {
  const root = await temp(t), directory = join(root, 'state'), cli = fakeCodex();
  await installDesktopPackage(await artifact(root, '1.0.0'), directory, { run: cli.run });
  const base = join(directory, 'chatgpt'), previous = JSON.parse(await readFile(join(base, 'deployment.json')));
  await stagePackage(await artifact(root, '1.0.1'), directory);
  await createPrivateJson(join(base, 'plugin-update.json'), { format: 1, nextVersion: '1.0.1', previous, previousCatalog: catalog('1.0.0') });
  await writeFile(join(base, '.agents/plugins/marketplace.json'), JSON.stringify(catalog('1.0.1')));
  assert.equal(await recoverDesktopPackage(directory, { run: cli.run }), true);
  assert.deepEqual(JSON.parse(await readFile(join(base, '.agents/plugins/marketplace.json'))), catalog('1.0.0'));
});

test('a process crash after native activation is rolled back on the next setup run', async t => {
  const { directory, source } = await nativeFixture(t), before = await inspectNative(directory);
  const module = new URL('../src/runtime-lifecycle.mjs', import.meta.url).href;
  const program = `import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; import { updateNativeRuntime } from ${JSON.stringify(module)}; const directory=process.argv[1]; await updateNativeRuntime(directory,{source:new URL(process.argv[2]),license:await readFile(join(directory,'runtime/LICENSE')),fault(point){if(point==='activated')process.exit(17);}});`;
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', program, directory, source.href]), error => error.code === 17);
  assert.equal(await recoverRuntime(directory), true);
  assert.deepEqual((await inspectNative(directory)).hashes, before.hashes);
});

test('committed native update recovery finishes partial backup cleanup without rolling back', async t => {
  const { directory, license, source } = await nativeFixture(t), before = await inspectNative(directory), token = randomUUID();
  const backup = `.runtime-backup-${token}`, stage = `.runtime-stage-${token}`;
  await cp(join(directory, 'runtime'), join(directory, backup), { recursive: true });
  await updateNativeRuntime(directory, { license, source });
  const after = await inspectNative(directory);
  await createPrivateJson(join(directory, 'runtime-update.json'), { backup, stage, phase: 'committed', previousRecord: before.record, previousHashes: before.hashes, nextHashes: after.hashes });
  await unlink(join(directory, backup, 'node'));
  assert.equal(await recoverRuntime(directory), true);
  assert.deepEqual((await inspectNative(directory)).hashes, after.hashes);
});
