// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { browserSetup } from '../src/browser-setup.mjs';
import { privateDirectory, createPrivateJson, privateJson } from '../src/security.mjs';
import { install, uninstall, manifestDirectories } from '../src/install.mjs';
import { inspectNative } from '../src/runtime-lifecycle.mjs';
import { addBrowserRegistration } from '../src/browser-registration.mjs';

async function fixture(t, client = 'Example client') {
  const root = await mkdtemp(join(tmpdir(), 'pac-setup-')), directory = join(root, 'state'), profileDirectory = join(directory, 'clients/example/profiles');
  const licensePath = join(root, 'LICENSE'); await writeFile(licensePath, 'synthetic license');
  let installed = 0, paired = 0, release, onStatus;
  const setup = browserSetup({ browser: 'chrome', directory, profileDirectory, clientName: client, licensePath,
    dependencies: {
      async install() { installed++; await createPrivateJson(join(directory, 'config.json'), { callers: [`chrome-extension://${'a'.repeat(32)}/`] }); },
      async updateNativeRuntime() {},
      async inspectNative() { return { config: await privateJson(join(directory, 'config.json')) }; },
      async pairClient(config, credential, options) {
        paired++; onStatus = options.onStatus; onStatus({ status: 'pending', code: 'ABCDEF12' });
        await new Promise((resolve, reject) => { release = resolve; options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
      },
    } });
  t.after(async () => { await setup.close(); await rm(root, { recursive: true, force: true }); });
  return { root, directory, profileDirectory, setup, get installed() { return installed; }, get paired() { return paired; }, approve() { release(); }, emit(value) { onStatus(value); } };
}
const request = () => ({ instanceId: randomUUID(), extensionId: 'a'.repeat(32) });
test('discovery, status and preparation create no local installation or credentials', async t => {
  const f = await fixture(t);
  assert.equal(f.setup.tools.length, 4);
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
  const credential = await privateJson(join(f.profileDirectory, 'chrome.json'));
  assert.equal((await lstat(join(f.profileDirectory, 'chrome.json'))).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(started).includes(credential.secret), false);
  assert.equal(JSON.stringify(await f.setup.call('setup_status', {})).includes(credential.credentialId), false);
  f.approve(); await new Promise(resolve => setImmediate(resolve));
  const approved = await f.setup.call('get_pairing_status', { requestId: plan.requestId });
  assert.equal(approved.status, 'approved'); assert.equal(approved.code, undefined);
  assert.equal((await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true })).error, 'setup-confirmation-required');
  const again = await f.setup.call('prepare_browser_setup', args);
  await f.setup.call('confirm_browser_setup', { requestId: again.requestId, confirmed: true });
  assert.equal(f.installed, 1); assert.deepEqual(await privateJson(join(f.profileDirectory, 'chrome.json')), credential);
});
test('mismatched instance, invalid extension, extra paths and unsafe inputs fail closed', async t => {
  const f = await fixture(t), args = request();
  const plan = await f.setup.call('prepare_browser_setup', args);
  await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true }); f.approve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.setup.call('prepare_browser_setup', request())).error, 'profile-instance-mismatch');
  assert.equal((await f.setup.call('prepare_browser_setup', { ...args, extensionId: '../../escape' })).error, 'invalid-setup-arguments');
  await assert.rejects(f.setup.call('prepare_browser_setup', { ...args, directory: '/tmp/other' }), /invalid-setup-arguments/u);
  assert.equal(f.installed, 1);
});
test('closing a client cancels pending pairing, retaining the private profile for explicit retry', async t => {
  const f = await fixture(t), plan = await f.setup.call('prepare_browser_setup', request());
  await f.setup.call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true });
  await f.setup.close();
  assert.equal((await f.setup.call('get_pairing_status', { requestId: plan.requestId })).status, 'cancelled');
  assert.ok(await privateJson(join(f.profileDirectory, 'chrome.json')));
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
