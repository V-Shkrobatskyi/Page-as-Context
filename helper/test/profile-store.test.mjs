// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { profileStore } from '../src/profile-store.mjs';
import { privateDirectory, createPrivateJson, secret } from '../src/security.mjs';
import { packageClient } from '../src/package-client.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pac-profiles-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'profiles'), store = profileStore('chrome', directory);
  return { root, directory, store };
}
test('keeps multiple instances, browser families and clients isolated; restart selects only active', async t => {
  const f = await fixture(t);
  for (const client of ['chatgpt', 'claude', 'claude-code']) {
    const directory = join(f.root, client, 'profiles');
    for (const browser of ['chrome', 'firefox']) {
      const store = profileStore(browser, directory), a = await store.stage(randomUUID());
      assert.equal((await store.read()).credential, undefined);
      await store.activate(a, null);
      const previous = await store.read(), b = await store.stage(randomUUID());
      assert.deepEqual((await profileStore(browser, directory).read()).credential, a);
      await store.activate(b, previous.revision);
      assert.deepEqual((await store.read()).credential, b);
      assert.equal((await lstat(join(directory, browser, 'active.json'))).mode & 0o777, 0o600);
    }
  }
});
test('legacy fallback is read-only and archived before replacement, never selected behind a broken pointer', async t => {
  const { directory, store } = await fixture(t); await privateDirectory(directory);
  const legacy = { protocol: 1, browser: 'chrome', instanceId: randomUUID(), credentialId: randomUUID(), secret: secret() };
  await createPrivateJson(join(directory, 'chrome.json'), legacy);
  const previous = await store.read(); assert.deepEqual(previous.credential, legacy);
  const candidate = await store.stage(randomUUID()); await store.activate(candidate, previous.revision);
  await writeFile(join(directory, 'chrome/active.json'), '{}');
  await assert.rejects(store.read(), /invalid-profile/u);
});
test('stale revision and aborted activation preserve selection; pending credentials can be removed', async t => {
  const { store } = await fixture(t), a = await store.stage(randomUUID()), b = await store.stage(randomUUID());
  await store.activate(a, null); const active = await store.read();
  await assert.rejects(store.activate(b, null), /profile-changed/u);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(store.activate(b, active.revision, abort.signal));
  assert.deepEqual(await store.read(), active); await store.discard(b); await store.discard(a);
  assert.deepEqual(await store.read(), active);
});
test('rejects symlink directories and files without falling back to another identity', async t => {
  const f = await fixture(t); await privateDirectory(f.directory);
  const foreign = await privateDirectory(join(f.root, 'foreign'));
  await symlink(foreign, join(f.directory, 'chrome'));
  await assert.rejects(f.store.read(), /unsafe-directory/u);
  const other = join(f.root, 'other'); await privateDirectory(other);
  await symlink(join(f.root, 'missing'), join(other, 'chrome.json'));
  await assert.rejects(profileStore('chrome', other).read());
});
test('live package client refreshes selection and never replays an in-flight write', async t => {
  const { directory, store } = await fixture(t), a = await store.stage(randomUUID()); await store.activate(a, null);
  const calls = [], bridges = [];
  const client = packageClient('chrome', '/unused', directory, {
    configuration: async () => ({}),
    managedClient(_config, credential) {
      let rejectPending;
      const bridge = { closed: false, onToolsChanged: () => () => {},
        request(request) { calls.push([credential.instanceId, request.tool]); return request.tool === 'fill_element' ? new Promise((_resolve, reject) => { rejectPending = reject; }) : Promise.resolve(credential.instanceId); },
        close() { this.closed = true; rejectPending?.(new Error('not-connected')); } };
      bridges.push(bridge); return bridge;
    },
  });
  t.after(() => client.close());
  let notifications = 0; client.onToolsChanged(() => notifications++);
  assert.equal(await client.request({ tool: 'list_shared_tabs' }), a.instanceId);
  const write = client.request({ tool: 'fill_element' });
  const rejected = assert.rejects(write, /not-connected/u);
  while (calls.length < 2) await new Promise(resolve => setImmediate(resolve));
  const previous = await store.read(), b = await store.stage(randomUUID());
  assert.equal(await client.request({ tool: 'list_shared_tabs' }), a.instanceId, 'Pending pairing leaves A active');
  await store.activate(b, previous.revision); await client.refresh(); await rejected;
  assert.equal(await client.request({ tool: 'list_shared_tabs' }), b.instanceId);
  assert.equal(bridges[0].closed, true); assert.equal(notifications, 2);
  assert.deepEqual(calls.filter(([, tool]) => tool === 'fill_element'), [[a.instanceId, 'fill_element']]);
  // A selection made by another process is picked up before the next request too.
  const c = await store.stage(randomUUID()); await store.activate(c, (await store.read()).revision);
  assert.equal(await client.request({ tool: 'list_shared_tabs' }), c.instanceId);
});
