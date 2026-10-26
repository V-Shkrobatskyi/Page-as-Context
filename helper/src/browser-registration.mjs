// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { lstat, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { manifestDirectories } from './install.mjs';
import { inspectNative, stopOwnedBroker } from './runtime-lifecycle.mjs';
import { createPrivateJson, privateJson, HOST_NAME, validCaller } from './security.mjs';
import { atomicPrivateJson } from './desktop-package.mjs';

const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Called only under the shared setup lock and after explicit user confirmation. */
export async function recoverBrowserRegistration(directory, options = {}) {
  const journalPath = join(directory, 'browser-registration.json');
  if (!await exists(journalPath)) return;
  const value = await privateJson(journalPath);
  const path = join(manifestDirectories(options.platform, options.manifestHome)[value.browser] ?? '', `${HOST_NAME}.json`);
  if (!['chrome', 'firefox'].includes(value.browser) || value.path !== path || !validCaller(value.caller) ||
    value.manifest?.path !== join(directory, 'native-host.mjs') || value.manifest?.name !== HOST_NAME ||
    value.previousRecord?.launcher !== join(directory, 'native-host.mjs') || !Array.isArray(value.previousConfig?.callers) ||
    !Array.isArray(value.previousRecord?.paths) || value.previousRecord.paths.includes(path) || value.previousConfig.callers.includes(value.caller)) throw new Error('registration-changed');
  if (value.phase !== 'committed') {
    if (await exists(path)) {
      if (!same(await privateJson(path), value.manifest)) throw new Error('registration-changed');
      await unlink(path);
    }
    await atomicPrivateJson(join(directory, 'config.json'), value.previousConfig);
    await atomicPrivateJson(join(directory, 'installation.json'), value.previousRecord);
  }
  await unlink(journalPath);
}

export async function addBrowserRegistration(directory, browser, caller, options = {}) {
  await recoverBrowserRegistration(directory, options);
  const { config, record } = await inspectNative(directory);
  if (config.callers.includes(caller)) return;
  if (!['chrome', 'firefox'].includes(browser) || !validCaller(caller) || (browser === 'chrome') !== caller.startsWith('chrome-extension://') ||
    config.callers.some(value => value.startsWith('chrome-extension://') === caller.startsWith('chrome-extension://'))) throw new Error('browser-registration-required');
  const path = join(manifestDirectories(options.platform, options.manifestHome)[browser], `${HOST_NAME}.json`);
  if (await exists(path)) throw new Error('registration-changed');
  await stopOwnedBroker(config);
  const manifest = { name: HOST_NAME, description: 'Page as Context local bridge', path: record.launcher, type: 'stdio',
    ...(browser === 'chrome' ? { allowed_origins: [caller] } : { allowed_extensions: [caller] }) };
  const previousConfig = await privateJson(join(directory, 'config.json'));
  const journalPath = join(directory, 'browser-registration.json');
  const journal = { browser, caller, path, manifest, previousConfig, previousRecord: record, phase: 'prepared' };
  await createPrivateJson(journalPath, journal);
  try {
    // Browser-owned parent directories need not be private; only our manifest is private.
    await mkdir(manifestDirectories(options.platform, options.manifestHome)[browser], { recursive: true, mode: 0o700 });
    await createPrivateJson(path, manifest);
    await atomicPrivateJson(join(directory, 'config.json'), { ...previousConfig, callers: [...previousConfig.callers, caller] });
    await atomicPrivateJson(join(directory, 'installation.json'), { ...record, paths: [...record.paths, path] });
    await atomicPrivateJson(journalPath, { ...journal, phase: 'committed' });
    await unlink(journalPath);
  } catch (error) { await recoverBrowserRegistration(directory, options); throw error; }
}
