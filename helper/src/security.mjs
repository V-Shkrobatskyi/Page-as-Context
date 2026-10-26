// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { lstat, mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export const HOST_NAME = 'org.page_as_context.bridge';
export const PROTOCOL = 1;
export const BROKER_VERSION = 1;
export const readinessProof = (config, value) => createHmac('sha256', config.hostSecret).update(value).digest('base64url');
export const idValid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/u.test(value);
export const secret = () => randomBytes(32).toString('base64url');
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const defaultDirectory = () => join(homedir(), '.page-as-context');

export async function privateDirectory(directory) {
  directory = resolve(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error('unsafe-directory');
  return directory;
}

export async function privateJson(path) {
  // O_NOFOLLOW prevents replacing a credential with a symlink between stat and open.
  const { constants } = await import('node:fs');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > 16_384) throw new Error('unsafe-file');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}

export async function createPrivateJson(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(value)}\n`); } finally { await file.close(); }
}

export async function configuration(directory = defaultDirectory()) {
  if (process.platform === 'win32') throw new Error('windows-not-validated');
  directory = await privateDirectory(directory);
  const config = await privateJson(join(directory, 'config.json'));
  if (config.protocol !== PROTOCOL || !idValid(config.installationId) || typeof config.hostSecret !== 'string' ||
    !Array.isArray(config.callers) || !config.callers.length || config.callers.some(caller => !validCaller(caller))) throw new Error('invalid-config');
  return { ...config, directory, socket: join(directory, 'broker.sock') };
}

export function validCaller(caller) {
  return typeof caller === 'string' && (/^chrome-extension:\/\/[a-p]{32}\/$/u.test(caller) ||
    /^\{[a-f0-9-]{36}\}$/iu.test(caller) || /^[a-z0-9._-]+@[a-z0-9.-]+$/iu.test(caller));
}
