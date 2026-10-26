// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { mkdir, lstat, unlink, chmod, readFile, rmdir, open, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { HOST_NAME, PROTOCOL, secret, privateDirectory, createPrivateJson, configuration, validCaller } from './security.mjs';

const legacyModules = ['security.mjs', 'framing.mjs', 'broker.mjs', 'native.mjs'];
const nativeModules = [...legacyModules, 'startup.mjs', 'broker-worker.mjs', 'native-entry.mjs'];
const runtimeFiles = [...nativeModules, 'node', 'LICENSE'];
const shellQuote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";

export function manifestDirectories(platform = process.platform, home = homedir()) {
  if (platform === 'darwin') return { chrome: join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts'), firefox: join(home, 'Library/Application Support/Mozilla/NativeMessagingHosts') };
  if (platform === 'linux') return { chrome: join(home, '.config/google-chrome/NativeMessagingHosts'), firefox: join(home, '.mozilla/native-messaging-hosts') };
  throw new Error('windows-not-validated');
}

export async function install({ directory, chromeId, firefoxId, chromeUserData, manifestHome, platform = process.platform }) {
  if (platform === 'win32') throw new Error('windows-not-validated');
  const callers = [];
  if (chromeId) {
    if (!/^[a-p]{32}$/u.test(chromeId)) throw new Error('invalid-extension-id');
    callers.push(`chrome-extension://${chromeId}/`);
  }
  if (firefoxId) { if (!validCaller(firefoxId) || firefoxId.startsWith('chrome-extension:')) throw new Error('invalid-extension-id'); callers.push(firefoxId); }
  if (!callers.length) throw new Error('extension-id-required');
  directory = await privateDirectory(directory);
  const directories = manifestDirectories(platform, manifestHome);
  if (chromeUserData) directories.chrome = join(resolve(chromeUserData), 'NativeMessagingHosts');
  const launcher = join(directory, 'native-host.mjs');
  const runtimeDirectory = join(directory, 'runtime');
  const configPath = join(directory, 'config.json');
  const config = { protocol: PROTOCOL, installationId: secret(), hostSecret: secret(), callers };
  // Fail on pre-existing configuration or manifests; never overwrite another installation.
  const destinations = Object.entries(directories).filter(([browser]) => browser === 'chrome' ? chromeId : firefoxId).map(([browser, path]) => ({ browser, path: join(path, `${HOST_NAME}.json`) }));
  for (const path of [configPath, join(directory, 'installation.json'), launcher, runtimeDirectory, ...destinations.map(item => item.path)]) {
    try { await lstat(path); throw new Error('installation-already-exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const created = [];
  try {
    await createPrivateJson(configPath, config); created.push(configPath);
    await mkdir(runtimeDirectory, { mode: 0o700 });
    for (const name of nativeModules) {
      const path = join(runtimeDirectory, name);
      const file = await open(path, 'wx', 0o600); created.push(path);
      try { await file.writeFile(await readFile(new URL(name, import.meta.url))); } finally { await file.close(); }
    }
    const node = join(runtimeDirectory, 'node');
    await copyFile(process.execPath, node, constants.COPYFILE_EXCL); created.push(node);
    await chmod(node, 0o700);
    let license;
    for (const path of [join(dirname(process.execPath), 'LICENSE'), join(dirname(process.execPath), '../LICENSE')]) {
      try { license = await readFile(path); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!license) throw new Error('runtime-license-required');
    const licenseFile = await open(join(runtimeDirectory, 'LICENSE'), 'wx', 0o600); created.push(join(runtimeDirectory, 'LICENSE'));
    try { await licenseFile.writeFile(license); } finally { await licenseFile.close(); }
    const file = await open(launcher, 'wx', 0o700); created.push(launcher);
    // Fixed, quoted exec wrapper supports spaces/apostrophes in install paths. No dynamic shell code.
    try { await file.writeFile(`#!/bin/sh\nexec ${shellQuote(node)} ${shellQuote(join(runtimeDirectory, 'native-entry.mjs'))} ${shellQuote(directory)} "$@"\n`); } finally { await file.close(); }
    await chmod(launcher, 0o700);
    for (const { browser, path } of destinations) {
      await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
      const manifest = { name: HOST_NAME, description: 'Page as Context local bridge', path: launcher, type: 'stdio',
        ...(browser === 'chrome' ? { allowed_origins: callers.filter(item => item.startsWith('chrome-extension:')) } : { allowed_extensions: callers.filter(item => !item.startsWith('chrome-extension:')) }) };
      await createPrivateJson(path, manifest); created.push(path);
    }
    await createPrivateJson(join(directory, 'installation.json'), { paths: destinations.map(item => item.path), launcher, runtimeFiles });
    return { directory, manifests: destinations.map(item => item.path) };
  } catch (error) {
    for (const path of created.reverse()) await unlink(path).catch(() => {});
    await rmdir(runtimeDirectory).catch(() => {});
    throw error;
  }
}

export async function uninstall(directory) {
  const config = await configuration(directory);
  const { privateJson } = await import('./security.mjs');
  const record = await privateJson(join(config.directory, 'installation.json'));
  const launcher = join(config.directory, 'native-host.mjs');
  if (record.launcher !== launcher || !Array.isArray(record.paths) || record.paths.length > 2) throw new Error('invalid-installation');
  const files = record.runtimeFiles ?? legacyModules;
  if (!Array.isArray(files) || files.length !== new Set(files).size || files.some(name => !runtimeFiles.includes(name))) throw new Error('invalid-installation');
  await privateDirectory(join(config.directory, 'runtime'));
  for (const path of record.paths) {
    // Delete only a manifest pointing to this installation; preserve unrelated files.
    const manifest = await privateJson(path);
    if (manifest.name !== HOST_NAME || manifest.path !== launcher) throw new Error('installation-changed');
  }
  for (const path of record.paths) await unlink(path);
  await unlink(launcher);
  for (const name of files) await unlink(join(config.directory, 'runtime', name));
  await rmdir(join(config.directory, 'runtime'));
  await unlink(join(config.directory, 'installation.json'));
  await unlink(join(config.directory, 'config.json'));
  // Credentials are deliberately retained for explicit user removal.
}
