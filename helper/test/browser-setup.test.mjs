// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { profileStore } from '../src/profile-store.mjs';
import { browserSetup } from '../src/browser-setup.mjs';
import { privateDirectory, createPrivateJson, privateJson } from '../src/security.mjs';
import { install, uninstall, manifestDirectories } from '../src/install.mjs';
import { inspectNative } from '../src/runtime-lifecycle.mjs';
import { addBrowserRegistration } from '../src/browser-registration.mjs';

async function fixture(t, client = 'Example client', overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pac-setup-')), directory = join(root, 'state'), profileDirectory = join(directory, 'clients/example/profiles');
  const licensePath = join(root, 'LICENSE'); await writeFile(licensePath, 'synthetic license');
  let installed = 0, paired = 0, release, fail, onStatus, credential;
  const setup = browserSetup({ browser: 'chrome', directory, profileDirectory, clientName: client, licensePath,
    dependencies: {
      async install() { installed++; await createPrivateJson(join(directory, 'config.json'), { callers: [`chrome-extension://${'a'.repeat(32)}/`] }); },
      async updateNativeRuntime() {},
      async inspectNative() { return { config: await privateJson(join(directory, 'config.json')) }; },
      async pairClient(config, candidate, options) {
        paired++; credential = candidate; onStatus = options.onStatus; onStatus({ status: 'pending', code: 'ABCDEF12' });
        await new Promise((resolve, reject) => { release = resolve; fail = reject; options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
      },
      ...overrides,
    } });
  t.after(async () => { await setup.close(); await rm(root, { recursive: true, force: true }); });
  return { root, directory, profileDirectory, setup, get installed() { return installed; }, get paired() { return paired; }, get credential() { return credential; }, fail(error) { fail(new Error(error)); }, approve() { release(); }, emit(value) { onStatus(value); } };
}
async function waitFor(setup, requestId, status) {
  for (let i = 0; i < 100; i++) {
    const value = await setup.call('get_pairing_status', { requestId });
    if (value.status === status) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`Pairing did not reach ${status}`);
}
const request = () => ({ instanceId: randomUUID(), extensionId: 'a'.repeat(32) });
test('discovery, status and preparation create no local installation or credentials', async t => {
  const f = await fixture(t);
  assert.equal(f.setup.tools.length, 5);
  assert.equal((await f.setup.call('setup_status', {})).nativeInstalled, false);
  const plan = await f.setup.call('prepare_browser_setup', request());
  assert.equal(plan.confirmationRequired, true); assert.equal(f.installed, 0); assert.equal(f.paired, 0);
  assert.deepEqual(await readdir(f.root), ['LICENSE']);
  assert.equal((await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: false })).error, 'setup-confirmation-required');
  assert.equal((await f.setup.call('confirm_browser_setup', { requestId: randomUUID(), confirmed: true })).error, 'setup-confirmation-required');
  assert.deepEqual(await readdir(f.root), ['LICENSE']);
});
test('confirmed setup returns pairing code without waiting and never shares secrets or grants a tab', async t => {
  const f = await fixture(t), args = request(), plan = await f.setup.call('prepare_browser_setup', args);
  const started = await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true });
  assert.equal(started.code, 'ABCDEF12'); assert.equal(f.installed, 1); assert.equal(f.paired, 1);
  assert.equal((await f.setup.call('prepare_browser_setup', args)).error, 'setup-already-running');
  const credential = f.credential;
  assert.equal((await profileStore('chrome', f.profileDirectory).read()).credential, undefined);
  assert.equal((await lstat(join(f.profileDirectory, 'chrome/instances', credential.instanceId, `${credential.credentialId}.json`))).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(started).includes(credential.secret), false);
  assert.equal(JSON.stringify(await f.setup.call('setup_status', {})).includes(credential.credentialId), false);
  f.approve(); await waitFor(f.setup, plan.requestId, 'approved');
  const approved = await f.setup.call('get_pairing_status', { requestId: plan.requestId });
  assert.equal(approved.status, 'approved'); assert.equal(approved.code, undefined);
  assert.equal((await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true })).error, 'setup-confirmation-required');
  const again = await f.setup.call('prepare_browser_setup', args);
  await f.setup.call('confirm_browser_setup', { requestId: again.requestId, confirmed: true });
  assert.equal(f.installed, 1); assert.deepEqual((await profileStore('chrome', f.profileDirectory).read()).credential, credential);
  assert.notEqual(f.credential.secret, credential.secret);
});
test('mismatched instance, invalid extension, extra paths and unsafe inputs fail closed', async t => {
  const f = await fixture(t), args = request();
  const plan = await f.setup.call('prepare_browser_setup', args);
  await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true }); f.approve(); await waitFor(f.setup, plan.requestId, 'approved');
  const reconnect = await f.setup.call('prepare_browser_setup', request());
  assert.equal(reconnect.previousInstanceId, args.instanceId); assert.match(reconnect.reason, /another browser instance/u);
  assert.equal((await f.setup.call('prepare_browser_setup', { ...args, extensionId: '../../escape' })).error, 'invalid-setup-arguments');
  await assert.rejects(f.setup.call('prepare_browser_setup', { ...args, directory: '/tmp/other' }), /invalid-setup-arguments/u);
  assert.equal(f.installed, 1);
});
test('closing a client cancels pending pairing without activating the candidate', async t => {
  const f = await fixture(t), plan = await f.setup.call('prepare_browser_setup', request());
  await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true });
  await f.setup.close();
  assert.deepEqual(await f.setup.call('get_pairing_status', { requestId: plan.requestId }), { requestId: plan.requestId, status: 'cancelled' });
  assert.equal((await profileStore('chrome', f.profileDirectory).read()).credential, undefined);
});

test('prepared confirmation expires and cannot be used in another client session', async t => {
  const a = await fixture(t), b = await fixture(t, 'Another MCP client');
  const plan = await a.setup.call('prepare_browser_setup', request());
  assert.equal((await b.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true })).error, 'setup-confirmation-required');
  const now = Date.now(); t.mock.method(Date, 'now', () => now + 300001);
  assert.equal((await a.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true })).error, 'setup-confirmation-required');
  assert.equal(a.installed + b.installed, 0);
});

test('adding a second browser preserves the existing host and refuses foreign registrations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pac-registration-')), directory = join(root, 'state'), manifestHome = join(root, 'browser home');
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { manifestHome, platform: 'darwin' }, firefox = '{e97aa566-cac0-4e2c-81f7-0ab664bf86ce}';
  await install({ directory, chromeId: 'a'.repeat(32), ...options });
  const before = await inspectNative(directory);
  await addBrowserRegistration(directory, 'firefox', firefox, options);
  const after = await inspectNative(directory);
  assert.equal(after.config.hostSecret, before.config.hostSecret);
  assert.deepEqual(after.config.callers, [...before.config.callers, firefox]);
  assert.equal(after.record.paths.length, 2);
  await addBrowserRegistration(directory, 'firefox', firefox, options);
  await assert.rejects(addBrowserRegistration(directory, 'firefox', 'foreign@example.org', options), /browser-registration-required/u);
  await uninstall(directory);
  const path = join(manifestDirectories('darwin', manifestHome).firefox, 'org.page_as_context.bridge.json');
  await createPrivateJson(path, { foreign: true });
  await install({ directory, chromeId: 'a'.repeat(32), ...options });
  await assert.rejects(addBrowserRegistration(directory, 'firefox', firefox, options), /registration-changed/u);
  assert.deepEqual(await privateJson(path), { foreign: true });
});

for (const outcome of ['approve', 'cancel', 'pairing-rejected', 'pairing-code-changed', 'pairing-approval-timeout', 'browser-connection-timeout', 'close']) {
  test(`instance replacement preserves the previous selection until ${outcome}`, async t => {
    const f = await fixture(t), a = request(), store = profileStore('chrome', f.profileDirectory);
    const first = await f.setup.call('prepare_browser_setup', a);
    await f.setup.call('confirm_browser_setup', { requestId: first.requestId, confirmed: true });
    f.approve(); await waitFor(f.setup, first.requestId, 'approved');
    const previous = await store.read(), b = request();
    const next = await f.setup.call('prepare_browser_setup', b);
    assert.equal(next.previousInstanceId, a.instanceId);
    assert.deepEqual(await store.read(), previous);
    await f.setup.call('confirm_browser_setup', { requestId: next.requestId, confirmed: true });
    const candidate = f.credential;
    assert.notEqual(candidate.secret, previous.credential.secret);
    assert.notEqual(candidate.credentialId, previous.credential.credentialId);
    assert.deepEqual(await store.read(), previous);
    if (outcome === 'approve') {
      f.approve(); await waitFor(f.setup, next.requestId, 'approved');
      assert.equal((await store.read()).credential.instanceId, b.instanceId);
      assert.deepEqual(await privateJson(join(f.profileDirectory, 'chrome/instances', a.instanceId, `${previous.credential.credentialId}.json`)), previous.credential);
    } else {
      if (outcome === 'cancel') assert.deepEqual(await f.setup.call('cancel_browser_setup', { requestId: next.requestId }), { requestId: next.requestId, status: 'cancelled' });
      else if (outcome === 'close') await f.setup.close();
      else f.fail(outcome);
      const terminal = await waitFor(f.setup, next.requestId, outcome === 'cancel' || outcome === 'close' ? 'cancelled' : 'failed');
      if (terminal.status === 'cancelled') {
        assert.equal(Object.hasOwn(terminal, 'error'), false);
        assert.equal(Object.hasOwn((await f.setup.call('setup_status', {})).pairing, 'error'), false);
      } else assert.equal(terminal.error, outcome);
      // Terminal status is published after cleanup has finished.
      await f.setup.close();
      assert.deepEqual(await store.read(), previous);
      await assert.rejects(lstat(join(f.profileDirectory, 'chrome/instances', b.instanceId, `${candidate.credentialId}.json`)), { code: 'ENOENT' });
    }
  });
}
test('cancelling a prepared plan writes nothing and prevents confirmation', async t => {
  const f = await fixture(t), plan = await f.setup.call('prepare_browser_setup', request());
  assert.equal((await f.setup.call('cancel_browser_setup', { requestId: plan.requestId })).status, 'cancelled');
  assert.equal((await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true })).error, 'setup-confirmation-required');
  assert.deepEqual(await readdir(f.root), ['LICENSE']);
});

test('late pairing approval after cancellation cannot activate a profile', async t => {
  let release, paired;
  const ready = new Promise(resolve => { paired = resolve; });
  const f = await fixture(t, 'Late client', { async pairClient() { paired(); await new Promise(resolve => { release = resolve; }); } });
  const plan = await f.setup.call('prepare_browser_setup', request());
  await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true }); await ready;
  const cancelling = f.setup.call('cancel_browser_setup', { requestId: plan.requestId });
  release();
  const cancelled = await cancelling;
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(Object.hasOwn(cancelled, 'error'), false);
  assert.match(cancelled.instructions, /Revoke the unused pairing/u);
  assert.equal((await profileStore('chrome', f.profileDirectory).read()).credential, undefined);
});
test('activation failure after browser approval keeps the previous profile and explains unused pairing', async t => {
  let failActivation = false;
  const f = await fixture(t, 'Activation client', { profileStore(browser, directory) {
    const store = profileStore(browser, directory);
    return { ...store, async activate(...args) { if (failActivation) throw new Error('synthetic-write-error'); return store.activate(...args); } };
  } });
  const initial = await f.setup.call('prepare_browser_setup', request());
  await f.setup.call('confirm_browser_setup', { requestId: initial.requestId, confirmed: true }); f.approve();
  await waitFor(f.setup, initial.requestId, 'approved');
  const store = profileStore('chrome', f.profileDirectory), previous = await store.read();
  failActivation = true;
  const next = await f.setup.call('prepare_browser_setup', request());
  await f.setup.call('confirm_browser_setup', { requestId: next.requestId, confirmed: true }); f.approve();
  const failed = await waitFor(f.setup, next.requestId, 'failed');
  assert.match(failed.instructions, /Revoke the unused pairing/u); assert.deepEqual(await store.read(), previous);
});
test('another process changing selection invalidates a prepared confirmation', async t => {
  const f = await fixture(t), plan = await f.setup.call('prepare_browser_setup', request());
  const store = profileStore('chrome', f.profileDirectory), external = await store.stage(randomUUID()); await store.activate(external, null);
  const result = await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true });
  assert.equal(result.error, 'profile-changed'); assert.equal(f.paired, 0);
  assert.deepEqual((await store.read()).credential, external);
});
test('a competing activation during pairing wins over the stale job', async t => {
  const f = await fixture(t), plan = await f.setup.call('prepare_browser_setup', request());
  await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true });
  const store = profileStore('chrome', f.profileDirectory), external = await store.stage(randomUUID()); await store.activate(external, null);
  f.approve();
  assert.equal((await waitFor(f.setup, plan.requestId, 'failed')).error, 'profile-changed');
  assert.deepEqual((await store.read()).credential, external);
});

test('cancellation retains cleanup warnings without reporting an operation error', async t => {
  const f = await fixture(t, 'Cleanup client', { profileStore(browser, directory) {
    return { ...profileStore(browser, directory), async discard() { throw new Error('synthetic-cleanup-error'); } };
  } });
  const plan = await f.setup.call('prepare_browser_setup', request());
  await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true });
  const cancelled = await f.setup.call('cancel_browser_setup', { requestId: plan.requestId });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(Object.hasOwn(cancelled, 'error'), false);
  assert.match(cancelled.cleanupWarning, /cleanup could not finish/u);
  assert.equal((await profileStore('chrome', f.profileDirectory).read()).credential, undefined);
});
