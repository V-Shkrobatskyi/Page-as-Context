// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { lstat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, privateJson, createPrivateJson, idValid, secret, PROTOCOL } from './security.mjs';
import { validateCredential } from './client.mjs';

const missing = error => error.code === 'ENOENT';
async function checkDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error('unsafe-directory');
}

/** All mutations are called under withSetupLock. Discovery never creates files. */
export function profileStore(browser, directory) {
  if (!['chrome', 'firefox'].includes(browser)) throw new Error('invalid-browser');
  const root = join(directory, browser), activePath = join(root, 'active.json');
  const credentialPath = credential => {
    validateCredential(credential);
    if (credential.browser !== browser) throw new Error('invalid-credential');
    return join(root, 'instances', credential.instanceId, `${credential.credentialId}.json`);
  };
  async function read() {
    let pointer;
    try {
      await checkDirectory(directory); await checkDirectory(root);
      pointer = await privateJson(activePath);
    } catch (error) {
      if (!missing(error)) throw error;
      let credential;
      try { await checkDirectory(directory); credential = await privateJson(join(directory, `${browser}.json`)); }
      catch (error) { if (missing(error)) return { revision: null }; throw error; }
      credentialPath(credential);
      return { revision: `legacy:${credential.credentialId}`, credential };
    }
    if (pointer.version !== 1 || !idValid(pointer.revision) || !idValid(pointer.instanceId) || !idValid(pointer.credentialId)) throw new Error('invalid-profile');
    // Once a pointer exists, a missing or corrupt credential must never select legacy data.
    await checkDirectory(join(root, 'instances')); await checkDirectory(join(root, 'instances', pointer.instanceId));
    const credential = await privateJson(join(root, 'instances', pointer.instanceId, `${pointer.credentialId}.json`));
    credentialPath(credential);
    if (credential.instanceId !== pointer.instanceId || credential.credentialId !== pointer.credentialId) throw new Error('invalid-profile');
    return { revision: pointer.revision, credential };
  }
  async function save(credential) {
    const path = credentialPath(credential);
    for (const dir of [directory, root, join(root, 'instances'), join(root, 'instances', credential.instanceId)]) await privateDirectory(dir);
    try { await createPrivateJson(path, credential); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await privateJson(path);
      if (JSON.stringify(existing) !== JSON.stringify(credential)) throw new Error('invalid-profile');
    }
  }
  return {
    read,
    async stage(instanceId) {
      if (!idValid(instanceId)) throw new Error('invalid-credential');
      const previous = await read();
      // Archive the legacy identity without changing its active selection or approval state.
      if (previous.credential) await save(previous.credential);
      const credential = { protocol: PROTOCOL, browser, instanceId, credentialId: randomUUID(), secret: secret() };
      await save(credential); return credential;
    },
    async activate(credential, expectedRevision, signal) {
      if ((await read()).revision !== expectedRevision) throw new Error('profile-changed');
      const stored = await privateJson(credentialPath(credential));
      if (JSON.stringify(stored) !== JSON.stringify(credential)) throw new Error('invalid-profile');
      const temporary = join(root, `.active-${randomUUID()}.json`);
      try {
        await createPrivateJson(temporary, { version: 1, revision: randomUUID(), instanceId: credential.instanceId, credentialId: credential.credentialId });
        signal?.throwIfAborted();
        await rename(temporary, activePath);
      } finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error; }); }
    },
    async discard(credential) {
      const active = await read();
      if (active.credential?.credentialId === credential.credentialId) return;
      await unlink(credentialPath(credential)).catch(error => { if (!missing(error)) throw error; });
    },
  };
}
