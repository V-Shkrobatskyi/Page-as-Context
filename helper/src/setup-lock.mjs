// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, privateJson, createPrivateJson } from './security.mjs';

/** Serialize explicit local setup actions across MCP clients. */
export async function withSetupLock(directory, action) {
  await privateDirectory(directory);
  const path = join(directory, 'desktop-setup.lock'), token = randomUUID();
  try { await createPrivateJson(path, { token, pid: process.pid }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = await privateJson(path), inode = (await lstat(path)).ino;
    if (!Number.isSafeInteger(previous.pid) || previous.pid < 2 || typeof previous.token !== 'string') throw new Error('setup-lock-needs-review');
    let alive = true;
    try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    if (alive || (await lstat(path)).ino !== inode) throw new Error('setup-already-running');
    await unlink(path); await createPrivateJson(path, { token, pid: process.pid });
  }
  try { return await action(); }
  finally { if ((await privateJson(path)).token === token) await unlink(path); }
}
