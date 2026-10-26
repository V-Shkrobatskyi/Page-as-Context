// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
import { connectSocket } from './broker.mjs';
import { readFrames, writeFrame, createAssembly } from './framing.mjs';
import { PROTOCOL, idValid } from './security.mjs';

export function validateCredential(credential) {
  if (credential.protocol !== PROTOCOL || !idValid(credential.instanceId) || !idValid(credential.credentialId) ||
    !['chrome', 'firefox'].includes(credential.browser) || typeof credential.secret !== 'string' || credential.secret.length !== 43) throw new Error('invalid-credential');
}

export async function bridgeClient(config, credential) {
  validateCredential(credential);
  const socket = await connectSocket(config.socket);
  const pending = new Map();
  const toolListeners = new Set();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const handshake = setTimeout(() => socket.destroy(), 3000);
  const stop = readFrames(socket, message => {
    if (message?.type === 'ready' && message.protocol === PROTOCOL) { clearTimeout(handshake); readyResolve(); return; }
    if (message?.type === 'tools-changed') { for (const listener of toolListeners) listener(); return; }
    const job = pending.get(message?.id); if (!job) return;
    if (message.type === 'result' && typeof message.error === 'string') { pending.delete(message.id); clearTimeout(job.timer); job.reject(new Error(message.error)); return; }
    if (message.type !== 'result-chunk') return socket.destroy();
    const result = job.assembly(message);
    if (result !== undefined) { pending.delete(message.id); clearTimeout(job.timer); job.resolve(result); }
  }, () => socket.destroy());
  socket.once('close', () => {
    stop(); clearTimeout(handshake); readyReject(new Error('not-connected')); toolListeners.clear();
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('not-connected')); } pending.clear();
  });
  writeFrame(socket, { type: 'hello', role: 'client', protocol: PROTOCOL, ...credential });
  await ready;
  return {
    get closed() { return socket.destroyed; },
    onToolsChanged(listener) { toolListeners.add(listener); return () => toolListeners.delete(listener); },
    request(request) {
      if (pending.size >= 4 || socket.destroyed) return Promise.reject(new Error('not-connected'));
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); socket.destroy(); reject(new Error('capture-timeout')); }, ['click_element', 'fill_element', 'select_option', 'set_checked'].includes(request.tool) ? 91000 : 16000);
        pending.set(id, { resolve, reject, timer, assembly: createAssembly() });
        try { writeFrame(socket, { type: 'request', id, request }); } catch { socket.destroy(); }
      });
    },
    close() { socket.destroy(); },
  };
}
