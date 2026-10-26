// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { randomUUID } from 'node:crypto';
import { connectSocket } from './broker.mjs';
import { brokerReady } from './startup.mjs';
import { readFrames, writeFrame } from './framing.mjs';
import { PROTOCOL, BROKER_VERSION, equal, secret, readinessProof } from './security.mjs';
import { validateCredential } from './client.mjs';

/** Local credential maintenance only; never exposed as a page-access MCP tool. */
export async function disconnectClient(config, credential) {
  validateCredential(credential);
  await brokerReady(config);
  const socket = await connectSocket(config.socket);
  const id = randomUUID(), nonce = secret();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('bridge-update-required')), 1000);
      const finish = error => { clearTimeout(timer); stop(); socket.off('close', closed); error ? reject(error) : resolve(); };
      const closed = () => finish(new Error('bridge-update-required'));
      const stop = readFrames(socket, message => {
        if (message.type === 'ready' && message.nonce === nonce && message.protocol === PROTOCOL && message.installationId === config.installationId && message.brokerVersion === BROKER_VERSION && Number.isSafeInteger(message.pid) &&
          equal(message.proof, readinessProof(config, `broker:${nonce}:${config.installationId}:${BROKER_VERSION}:${message.pid}`))) writeFrame(socket, { type: 'disconnect-client', id, instanceId: credential.instanceId, browser: credential.browser, credentialId: credential.credentialId, credentialSecret: credential.secret });
        else if (message.type === 'disconnected' && message.id === id) finish();
        else finish(new Error('bridge-update-required'));
      }, () => finish(new Error('bridge-update-required')));
      socket.once('close', closed);
      writeFrame(socket, { type: 'hello', role: 'supervisor', protocol: PROTOCOL, nonce, proof: readinessProof(config, `client:${nonce}`) });
    });
  } finally { socket.destroy(); }
}
