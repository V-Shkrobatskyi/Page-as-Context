// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Installed-copy harness. Both endpoints are synthetic; no user browser is touched. */
export async function checkProfileSwitch({ call, config, browser, extensionId, profiles, connectSocket, readFrames, writeFrame, resultChunks, protocol }) {
  const previous = await profiles.read(), instanceId = randomUUID();
  const plan = await call('prepare_browser_setup', { instanceId, extensionId });
  assert.equal(plan.previousInstanceId, previous.credential.instanceId);
  assert.match(plan.reason, /another browser instance/u);
  await call('confirm_browser_setup', { requestId: plan.requestId, confirmed: true });
  assert.deepEqual(await profiles.read(), previous);
  const native = await connectSocket(config.socket);
  let approved = false, ready;
  const connected = new Promise(resolve => { ready = resolve; });
  const stop = readFrames(native, message => {
    if (message.type === 'ready') return ready();
    if (message.type !== 'request') return;
    const result = message.request.tool === 'pair' ? approved ? { status: 'approved' } : { status: 'pending', code: 'B2C3D4E5' }
      : message.request.tool === 'read_page_context' ? { context: 'Synthetic replacement instance' }
      : { tools: ['read_page_context'] };
    for (const chunk of resultChunks(message.id, result)) writeFrame(native, chunk);
  }, () => native.destroy());
  try {
    writeFrame(native, { type: 'hello', role: 'native', protocol, instanceId, browser, caller: browser === 'chrome' ? `chrome-extension://${extensionId}/` : extensionId, secret: config.hostSecret });
    await connected;
    const wait = async status => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const job = await call('get_pairing_status', { requestId: plan.requestId });
        if (job.status === status) return job;
        if (job.status === 'failed') throw new Error(`Replacement pairing failed: ${job.error}`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Replacement pairing did not reach ${status}`);
    };
    assert.equal((await wait('pending')).code, 'B2C3D4E5');
    assert.deepEqual(await profiles.read(), previous);
    approved = true; await wait('approved');
    const selected = await profiles.read();
    assert.equal(selected.credential.instanceId, instanceId);
    assert.notEqual(selected.credential.secret, previous.credential.secret);
    assert.equal((await call('read_page_context', { connectionId: 'synthetic_connection_001' })).context, 'Synthetic replacement instance');
    const cancelled = await call('prepare_browser_setup', { instanceId: randomUUID(), extensionId });
    await call('confirm_browser_setup', { requestId: cancelled.requestId, confirmed: true });
    assert.deepEqual(await call('cancel_browser_setup', { requestId: cancelled.requestId }), { requestId: cancelled.requestId, status: 'cancelled' });
    assert.deepEqual(await profiles.read(), selected);
  } finally { stop(); native.destroy(); }
}
