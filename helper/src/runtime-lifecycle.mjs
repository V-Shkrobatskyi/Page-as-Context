// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readFile, lstat, readdir, mkdir, writeFile, chmod, rename, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration, privateJson, privateDirectory, createPrivateJson, HOST_NAME } from './security.mjs';
import { brokerReady } from './startup.mjs';

const MODULES = ['security.mjs', 'framing.mjs', 'broker.mjs', 'native.mjs', 'startup.mjs', 'broker-worker.mjs', 'native-entry.mjs'];
const FILES = [...MODULES, 'node', 'LICENSE'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => { try { return await lstat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await createPrivateJson(temporary, value);
  try { await rename(temporary, path); } catch (error) { await unlink(temporary); throw error; }
}
async function inventory(directory) {
  await lstat(directory);
  await privateDirectory(directory);
  const names = (await readdir(directory)).sort();
  if (JSON.stringify(names) !== JSON.stringify([...FILES].sort())) throw new Error('unrecognized-runtime');
  const result = {};
  for (const name of names) {
    const path = join(directory, name), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw new Error('unsafe-runtime');
    result[name] = hash(await readFile(path));
  }
  return result;
}
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
async function removeRuntime(directory, expected) {
  if (!same(await inventory(directory), expected)) throw new Error('runtime-changed');
  for (const name of FILES) await unlink(join(directory, name));
  await rmdir(directory);
}
async function removeBackup(directory, expected) {
  await privateDirectory(directory);
  const names = await readdir(directory);
  for (const name of names) {
    if (!FILES.includes(name)) throw new Error('runtime-changed');
    const path = join(directory, name), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077 || hash(await readFile(path)) !== expected[name]) throw new Error('runtime-changed');
  }
  for (const name of names) await unlink(join(directory, name));
  await rmdir(directory);
}
export async function stopOwnedBroker(config) {
  const stat = await exists(config.socket); if (!stat) return false;
  const ready = await brokerReady(config);
  const confirmed = await brokerReady(config);
  if (ready.pid !== confirmed.pid || ready.pid === process.pid) throw new Error('broker-changed');
  process.kill(ready.pid, 'SIGTERM');
  const deadline = Date.now() + 3000;
  while (true) {
    const current = await exists(config.socket);
    if (!current || current.ino !== stat.ino) return true;
    if (Date.now() > deadline) throw new Error('broker-stop-timeout');
    await delay(25);
  }
}
export async function inspectNative(directory) {
  const config = await configuration(directory);
  const record = await privateJson(join(config.directory, 'installation.json'));
  if (record.launcher !== join(config.directory, 'native-host.mjs') || !Array.isArray(record.paths) || !record.paths.length || record.paths.length > 2 ||
    !Array.isArray(record.runtimeFiles) || !same(Object.fromEntries(record.runtimeFiles.map(name => [name, true])), Object.fromEntries(FILES.map(name => [name, true])))) throw new Error('unrecognized-installation');
  const launcher = await lstat(record.launcher);
  if (!launcher.isFile() || launcher.isSymbolicLink() || launcher.uid !== process.getuid() || launcher.mode & 0o077) throw new Error('unsafe-launcher');
  for (const path of record.paths) {
    const manifest = await privateJson(path);
    if (manifest.name !== HOST_NAME || manifest.path !== record.launcher || manifest.type !== 'stdio') throw new Error('registration-changed');
  }
  const hashes = await inventory(join(config.directory, 'runtime'));
  if (record.runtimeHashes && !same(hashes, record.runtimeHashes)) throw new Error('runtime-changed');
  return { config, record, hashes };
}

/** An interrupted upgrade is rolled back only after identifying both owned trees. */
export async function recoverRuntime(directory) {
  const journalPath = join(directory, 'runtime-update.json');
  if (!await exists(journalPath)) return false;
  const journal = await privateJson(journalPath);
  if (!/^\.runtime-backup-[a-f0-9-]{36}$/u.test(journal.backup) || !/^\.runtime-stage-[a-f0-9-]{36}$/u.test(journal.stage)) throw new Error('invalid-update-journal');
  const target = join(directory, 'runtime'), backup = join(directory, journal.backup), stage = join(directory, journal.stage);
  if (journal.phase === 'committed') {
    if (!same(await inventory(target), journal.nextHashes) || !same((await privateJson(join(directory, 'installation.json'))).runtimeHashes, journal.nextHashes)) throw new Error('runtime-changed');
    if (await exists(backup)) await removeBackup(backup, journal.previousHashes);
    if (await exists(stage)) await removeRuntime(stage, journal.nextHashes);
    await unlink(journalPath); return true;
  }
  if (await exists(backup)) {
    if (!same(await inventory(backup), journal.previousHashes)) throw new Error('runtime-changed');
    if (await exists(target)) {
      if (!same(await inventory(target), journal.nextHashes) || await exists(stage)) throw new Error('runtime-changed');
      await rename(target, stage);
    }
    await rename(backup, target);
    await atomicJson(join(directory, 'installation.json'), journal.previousRecord);
  } else if (!same(await inventory(target), journal.previousHashes)) throw new Error('runtime-changed');
  if (await exists(stage)) await removeRuntime(stage, journal.nextHashes);
  await unlink(journalPath);
  return true;
}

/** Stage a complete runtime, stop only the authenticated broker, then swap or roll back. */
export async function updateNativeRuntime(directory, { source = new URL('./', import.meta.url), executable = process.execPath, license, adoptExisting = false, legacyHashes = [], fault = () => {} } = {}) {
  directory = await privateDirectory(directory);
  await recoverRuntime(directory);
  const { config, record, hashes } = await inspectNative(directory);
  const next = {};
  for (const name of MODULES) next[name] = await readFile(new URL(name, source));
  next.node = await readFile(executable);
  next.LICENSE = license ?? await readFile(new URL('../../runtime/LICENSE', source));
  const nextHashes = Object.fromEntries(FILES.map(name => [name, hash(next[name])]));
  const recognizedLegacy = same(hashes, nextHashes) || legacyHashes.some(known => MODULES.every(name => known[name] === hashes[name]) && hashes.node === nextHashes.node && hashes.LICENSE === nextHashes.LICENSE);
  if (!record.runtimeHashes && (!adoptExisting || !recognizedLegacy)) throw new Error('legacy-installation-needs-review');
  const nextRecord = { ...record, runtimeHashes: nextHashes };
  if (same(hashes, nextHashes)) { await atomicJson(join(directory, 'installation.json'), nextRecord); return { updated: false }; }
  const token = randomUUID(), stageName = `.runtime-stage-${token}`, backupName = `.runtime-backup-${token}`;
  const stage = join(directory, stageName), backup = join(directory, backupName), target = join(directory, 'runtime');
  await mkdir(stage, { mode: 0o700 });
  try {
    for (const name of FILES) await writeFile(join(stage, name), next[name], { mode: name === 'node' ? 0o700 : 0o600, flag: 'wx' });
    if (!same(await inventory(stage), nextHashes)) throw new Error('staging-failed');
    await fault('staged');
    await stopOwnedBroker(config);
    const journal = { backup: backupName, stage: stageName, previousRecord: record, previousHashes: hashes, nextHashes };
    await createPrivateJson(join(directory, 'runtime-update.json'), journal);
    await rename(target, backup); await fault('backup');
    await rename(stage, target); await fault('activated');
    await atomicJson(join(directory, 'installation.json'), nextRecord); await fault('recorded');
    // A committed update can finish partial backup cleanup after a crash.
    await atomicJson(join(directory, 'runtime-update.json'), { ...journal, phase: 'committed' });
    await removeBackup(backup, hashes); await unlink(join(directory, 'runtime-update.json'));
    return { updated: true };
  } catch (error) {
    if (await exists(join(directory, 'runtime-update.json'))) await recoverRuntime(directory);
    else if (await exists(stage)) await removeRuntime(stage, nextHashes);
    throw error;
  }
}
