// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readFile, writeFile, lstat, readdir, mkdir, cp, chmod, rename, unlink, rmdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { privateDirectory, privateJson, createPrivateJson } from './security.mjs';

export const PLUGIN = 'page-as-context', MARKETPLACE = 'page-as-context-desktop';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => { try { return await lstat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
const validVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/u.test(value);
export async function atomicPrivateJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await createPrivateJson(temporary, value);
  try { await rename(temporary, path); } catch (error) { await unlink(temporary); throw error; }
}
async function tree(root, prefix = '') {
  const files = [];
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name), stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error('unsafe-package-entry');
    if (stat.isDirectory()) files.push(...await tree(path, `${prefix}${name}/`));
    else files.push(`${prefix}${name}`);
  }
  return files;
}
export async function verifyPackage(root) {
  root = resolve(root);
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new Error('unsafe-package');
  const index = JSON.parse(await readFile(join(root, 'PACKAGE.json'), 'utf8'));
  if (index.format !== 1 || !validVersion(index.version) || index.platform !== 'darwin' || index.arch !== 'arm64' || !index.files || typeof index.files !== 'object') throw new Error('invalid-package');
  const paths = Object.keys(index.files).sort();
  for (const path of paths) if (isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/u.test(index.files[path])) throw new Error('invalid-package-path');
  if (JSON.stringify((await tree(root)).filter(path => path !== 'PACKAGE.json').sort()) !== JSON.stringify(paths)) throw new Error('package-inventory-mismatch');
  for (const path of paths) if (sha256(await readFile(join(root, path))) !== index.files[path]) throw new Error('package-checksum-mismatch');
  const manifest = JSON.parse(await readFile(join(root, 'plugins', PLUGIN, 'plugin.json'), 'utf8'));
  if (manifest.name !== PLUGIN || manifest.version !== index.version) throw new Error('invalid-package-identity');
  return { ...index, digest: sha256(await readFile(join(root, 'PACKAGE.json'))) };
}
export function catalog(version) {
  if (!validVersion(version)) throw new Error('invalid-version');
  return { name: MARKETPLACE, interface: { displayName: 'Page as Context' }, plugins: [{ name: PLUGIN,
    source: { source: 'local', path: `./releases/${version}/plugins/${PLUGIN}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] };
}
export function codexRunner(executable = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex') {
  return async args => {
    try {
      const result = await promisify(execFile)(executable, args, { timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
      return result.stdout;
    } catch { throw new Error('chatgpt-command-failed'); }
  };
}
export async function stagePackage(root, directory) {
  const index = await verifyPackage(root);
  const base = await privateDirectory(join(directory, 'chatgpt'));
  const releases = await privateDirectory(join(base, 'releases'));
  const target = join(releases, index.version);
  if (await exists(target)) {
    if ((await verifyPackage(target)).digest !== index.digest) throw new Error('version-already-used');
    return { index, target };
  }
  const stage = join(releases, `.stage-${randomUUID()}`);
  await mkdir(stage, { mode: 0o700 });
  await cp(root, stage, { recursive: true, force: false, errorOnExist: true });
  for (const path of await tree(stage)) await chmod(join(stage, path), path.endsWith('/runtime/node') ? 0o700 : 0o600);
  async function privateDirs(path) { await chmod(path, 0o700); for (const name of await readdir(path)) if ((await lstat(join(path, name))).isDirectory()) await privateDirs(join(path, name)); }
  await privateDirs(stage);
  if ((await verifyPackage(stage)).digest !== index.digest) throw new Error('staging-failed');
  await rename(stage, target);
  return { index, target };
}
async function ownMarketplace(run, base) {
  const result = JSON.parse(await run(['plugin', 'marketplace', 'list', '--json']));
  const match = result.marketplaces?.find(item => item.name === MARKETPLACE);
  if (match && resolve(match.root) !== resolve(base)) throw new Error('marketplace-name-in-use');
  return Boolean(match);
}
async function refreshLocalMarketplace(run, base) {
  // The CLI upgrade command only supports Git sources. Re-register this owned
  // local source through supported commands; the recovery journal covers gaps.
  await ownMarketplace(run, base);
  await run(['plugin', 'marketplace', 'remove', MARKETPLACE]);
  await run(['plugin', 'marketplace', 'add', base]);
}
export async function recoverDesktopPackage(directory, { run = codexRunner() } = {}) {
  const base = await privateDirectory(join(directory, 'chatgpt'));
  const journalPath = join(base, 'plugin-update.json');
  if (!await exists(journalPath)) return false;
  const journal = await privateJson(journalPath);
  if (journal.format !== 1 || !validVersion(journal.nextVersion) || journal.previous && (journal.previous.format !== 1 || !validVersion(journal.previous.version)) ||
    journal.previousCatalog && (!journal.previous || JSON.stringify(journal.previousCatalog) !== JSON.stringify(catalog(journal.previous.version)))) throw new Error('invalid-update-journal');
  const catalogPath = join(base, '.agents/plugins/marketplace.json');
  const current = await exists(catalogPath) ? await privateJson(catalogPath) : undefined;
  if (current && JSON.stringify(current) !== JSON.stringify(catalog(journal.nextVersion)) && JSON.stringify(current) !== JSON.stringify(journal.previousCatalog)) throw new Error('marketplace-changed');
  const registered = await ownMarketplace(run, base);
  if (journal.previousCatalog) {
    await atomicPrivateJson(catalogPath, journal.previousCatalog);
    if (registered) await refreshLocalMarketplace(run, base);
    else await run(['plugin', 'marketplace', 'add', base]);
    await run(['plugin', 'add', `${PLUGIN}@${MARKETPLACE}`, '--json']);
  } else {
    if (registered) {
      await run(['plugin', 'remove', `${PLUGIN}@${MARKETPLACE}`, '--json']).catch(() => {});
      await run(['plugin', 'marketplace', 'remove', MARKETPLACE]);
    }
    if (current) await unlink(catalogPath);
  }
  const recordPath = join(base, 'deployment.json');
  if (journal.previous) await atomicPrivateJson(recordPath, journal.previous);
  else if (await exists(recordPath)) {
    const record = await privateJson(recordPath);
    if (record.version !== journal.nextVersion) throw new Error('deployment-changed');
    await unlink(recordPath);
  }
  await unlink(journalPath);
  return true;
}
export async function installDesktopPackage(root, directory, { run = codexRunner(), fault = () => {} } = {}) {
  await recoverDesktopPackage(directory, { run });
  const { index, target } = await stagePackage(root, directory);
  const base = await privateDirectory(join(directory, 'chatgpt'));
  const recordPath = join(base, 'deployment.json');
  const previous = await exists(recordPath) ? await privateJson(recordPath) : undefined;
  if (previous && (previous.format !== 1 || !validVersion(previous.version))) throw new Error('invalid-deployment');
  const catalogDir = join(base, '.agents/plugins'); await mkdir(catalogDir, { recursive: true, mode: 0o700 });
  const catalogPath = join(catalogDir, 'marketplace.json');
  const oldCatalog = await exists(catalogPath) ? await privateJson(catalogPath) : undefined;
  if (oldCatalog && (!previous || JSON.stringify(oldCatalog) !== JSON.stringify(catalog(previous.version)))) throw new Error('marketplace-changed');
  const alreadyRegistered = await ownMarketplace(run, base);
  await createPrivateJson(join(base, 'plugin-update.json'), { format: 1, nextVersion: index.version, previous: previous ?? null, previousCatalog: oldCatalog ?? null });
  await atomicPrivateJson(catalogPath, catalog(index.version));
  try {
    await fault('catalog');
    if (!alreadyRegistered) await run(['plugin', 'marketplace', 'add', base]);
    else await refreshLocalMarketplace(run, base);
    await run(['plugin', 'add', `${PLUGIN}@${MARKETPLACE}`, '--json']);
    await fault('installed');
    await atomicPrivateJson(recordPath, { format: 1, version: index.version, digest: index.digest,
      releases: [...new Set([...(previous?.releases ?? []), index.version])], enabled: true });
    await unlink(join(base, 'plugin-update.json'));
    return { version: index.version, packagePath: target, restartRequired: true };
  } catch (error) {
    try { await recoverDesktopPackage(directory, { run }); }
    catch { throw new Error('plugin-rollback-needs-retry'); }
    throw error;
  }
}
export async function removeDesktopPackage(directory, { run = codexRunner(), removeFiles = false } = {}) {
  await recoverDesktopPackage(directory, { run });
  const base = await privateDirectory(join(directory, 'chatgpt'));
  const recordPath = join(base, 'deployment.json'), record = await privateJson(recordPath);
  if (record.format !== 1 || !validVersion(record.version) || !Array.isArray(record.releases) || record.releases.some(version => !validVersion(version))) throw new Error('invalid-deployment');
  const catalogPath = join(base, '.agents/plugins/marketplace.json');
  if (JSON.stringify(await privateJson(catalogPath)) !== JSON.stringify(catalog(record.version))) throw new Error('marketplace-changed');
  const registered = await ownMarketplace(run, base);
  if (removeFiles) for (const version of record.releases) await verifyPackage(join(base, 'releases', version));
  if (registered) { await run(['plugin', 'remove', `${PLUGIN}@${MARKETPLACE}`, '--json']); await run(['plugin', 'marketplace', 'remove', MARKETPLACE]); }
  await unlink(catalogPath);
  if (removeFiles) {
    // Verify first, remove exact inventory entries only, then empty directories.
    for (const version of record.releases) {
      const root = join(base, 'releases', version), index = await verifyPackage(root);
      for (const path of Object.keys(index.files)) await unlink(join(root, path));
      await unlink(join(root, 'PACKAGE.json'));
      async function emptyDirs(path) { for (const name of await readdir(path)) await emptyDirs(join(path, name)); await rmdir(path); }
      await emptyDirs(root);
    }
  }
  await atomicPrivateJson(recordPath, { ...record, enabled: false, ...(removeFiles ? { releases: [] } : {}) });
  return { removed: true, bridgeRetained: true, credentialsRetained: true, restartRequired: true };
}
