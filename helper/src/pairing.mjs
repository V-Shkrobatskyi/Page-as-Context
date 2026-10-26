// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { setTimeout as delay } from 'node:timers/promises';
import { bridgeClient, validateCredential } from './client.mjs';
import { ensureBroker } from './startup.mjs';

/** Only the idempotent pairing handshake is polled; never page tools or write operations. */
export async function pairClient(config, credential, { name = `page-as-context-${credential.browser}`, onStatus = () => {}, connectTimeout = 60000, approvalTimeout = 120000, pollInterval = 500, signal } = {}) {
  signal?.throwIfAborted();
  validateCredential(credential);
  if (typeof name !== 'string' || !name.length || name.length > 80 || name.trim() !== name || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('invalid-client-name');
  await ensureBroker(config);
  signal?.throwIfAborted();
  const bridge = await bridgeClient(config, credential);
  const abort = () => bridge.close();
  signal?.addEventListener('abort', abort, { once: true });
  let deadline = Date.now() + connectTimeout, code, waiting = false;
  try {
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      let result;
      try { result = await bridge.request({ tool: 'pair', arguments: { name } }); }
      catch (error) {
        if (error.message !== 'not-connected' || bridge.closed) throw error;
        if (!waiting) { onStatus({ status: 'waiting-for-browser' }); waiting = true; }
        await delay(Math.min(pollInterval, Math.max(1, deadline - Date.now())), undefined, { signal });
        continue;
      }
      if (result?.status === 'approved') { onStatus({ status: 'approved' }); return; }
      if (result?.status !== 'pending' || typeof result.code !== 'string' || !/^[A-F0-9]{8}$/u.test(result.code)) throw new Error('pairing-rejected');
      if (!code) {
        code = result.code; deadline = Date.now() + approvalTimeout;
        onStatus({ status: 'pending', code });
      } else if (code !== result.code) throw new Error('pairing-code-changed');
      await delay(Math.min(pollInterval, Math.max(1, deadline - Date.now())), undefined, { signal });
    }
    throw new Error(code ? 'pairing-approval-timeout' : 'browser-connection-timeout');
  } finally { signal?.removeEventListener('abort', abort); bridge.close(); }
}
