// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { createServer, createConnection } from 'node:net';
import { chmod, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readFrames, writeFrame, createAssembly, resultChunks } from './framing.mjs';
import { PROTOCOL, equal, idValid, BROKER_VERSION, readinessProof } from './security.mjs';

export function connectSocket(path, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('broker-unavailable')); }, timeout);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', () => { clearTimeout(timer); reject(new Error('broker-unavailable')); });
  });
}

/** The broker routes opaque, authenticated requests; browser policy remains authoritative. */
export async function startBroker(config, { requestTimeout = 15_000, idleTimeout = 30_000, managedIdle = false } = {}) {
  const sockets = new Set(), instances = new Map(), pending = new Map();
  const clients = new Map();
  let idleTimer, closed = false, owned = false, inode;
  const failRequest = (id, code) => {
    const job = pending.get(id); if (!job) return;
    pending.delete(id); clearTimeout(job.timer);
    try { writeFrame(job.client, { type: 'result', id: job.clientId, error: code }); } catch { job.client.destroy(); }
  };
  const idle = () => {
    clearTimeout(idleTimer);
    if (!(managedIdle ? clients.size : sockets.size) && !closed) idleTimer = setTimeout(() => void close(), idleTimeout);
  };
  const server = createServer(socket => {
    if (sockets.size >= 32) { socket.destroy(); return; }
    sockets.add(socket); if (!managedIdle) clearTimeout(idleTimer);
    let hello, route;
    const handshake = setTimeout(() => socket.destroy(), 3000);
    const stop = readFrames(socket, message => {
      if (!hello) {
        if (!message || message.type !== 'hello' || message.protocol !== PROTOCOL) return socket.destroy();
        if (message.role === 'supervisor') {
          if (!idValid(message.nonce) || !equal(message.proof, readinessProof(config, `client:${message.nonce}`))) return socket.destroy();
          hello = message; clearTimeout(handshake);
          writeFrame(socket, { type: 'ready', protocol: PROTOCOL, installationId: config.installationId, brokerVersion: BROKER_VERSION,
            nonce: message.nonce, pid: process.pid, proof: readinessProof(config, `broker:${message.nonce}:${config.installationId}:${BROKER_VERSION}:${process.pid}`) });
          return;
        } else if (message.role === 'native') {
          if (!equal(message.secret, config.hostSecret) || !idValid(message.instanceId) || !['chrome', 'firefox'].includes(message.browser) ||
            !config.callers.includes(message.caller)) return socket.destroy();
          route = `${message.browser}:${message.instanceId}`;
          if (instances.has(route)) return socket.destroy();
          instances.set(route, socket);
        } else if (message.role === 'client') {
          if (!idValid(message.instanceId) || !['chrome', 'firefox'].includes(message.browser) || !idValid(message.credentialId) ||
            typeof message.secret !== 'string' || message.secret.length !== 43) return socket.destroy();
          route = `${message.browser}:${message.instanceId}`;
          // Native endpoint must validate this credential against its own grant on every request.
          clients.set(socket, { route, credentialId: message.credentialId, secret: message.secret });
          if (managedIdle) clearTimeout(idleTimer);
        } else return socket.destroy();
        hello = message; clearTimeout(handshake);
        writeFrame(socket, { type: 'ready', protocol: PROTOCOL }); return;
      }
      if (hello.role === 'supervisor') {
        if (message?.type !== 'disconnect-client' || !idValid(message.id) || !idValid(message.instanceId) ||
          !['chrome', 'firefox'].includes(message.browser) || !idValid(message.credentialId) || typeof message.credentialSecret !== 'string' || message.credentialSecret.length !== 43) return socket.destroy();
        const targetRoute = `${message.browser}:${message.instanceId}`;
        for (const [client, identity] of clients) if (identity.route === targetRoute && identity.credentialId === message.credentialId && equal(identity.secret, message.credentialSecret)) client.destroy();
        const native = instances.get(targetRoute);
        if (native) writeFrame(native, { type: 'client-disconnected', credentialId: message.credentialId, credentialSecret: message.credentialSecret, instanceId: message.instanceId, browser: message.browser });
        writeFrame(socket, { type: 'disconnected', id: message.id });
        return;
      }
      if (hello.role === 'client') {
        if (!message || message.type !== 'request' || !idValid(message.id) || !message.request || typeof message.request !== 'object' ||
          pending.size >= 64 || [...pending.values()].filter(job => job.client === socket).length >= 4) return socket.destroy();
        const native = instances.get(route);
        if (!native) { writeFrame(socket, { type: 'result', id: message.id, error: 'not-connected' }); return; }
        const id = randomUUID();
        const job = { client: socket, native, clientId: message.id, assembly: createAssembly(), timer: setTimeout(() => {
          try { writeFrame(native, { type: 'cancel', id }); } catch { native.destroy(); }
          failRequest(id, 'capture-timeout');
        }, ['click_element', 'fill_element', 'select_option', 'set_checked'].includes(message.request.tool) ? Math.max(requestTimeout, 90000) : requestTimeout) };
        pending.set(id, job);
        writeFrame(native, { type: 'request', id, credentialId: hello.credentialId, credentialSecret: hello.secret,
          instanceId: hello.instanceId, browser: hello.browser, request: message.request });
      } else {
        if (message?.type === 'tools-changed' && idValid(message.credentialId)) {
          for (const [client, identity] of clients) if (identity.route === route && identity.credentialId === message.credentialId) writeFrame(client, { type: 'tools-changed' });
          return;
        }
        if (!message || message.type !== 'result-chunk' || typeof message.id !== 'string') return socket.destroy();
        const job = pending.get(message.id);
        if (!job || job.native !== socket) return; // Ignore late responses and other instances.
        const value = job.assembly(message);
        if (value === undefined) return;
        pending.delete(message.id); clearTimeout(job.timer);
        for (const chunk of resultChunks(job.clientId, value)) writeFrame(job.client, chunk);
      }
    }, () => socket.destroy());
    socket.once('close', () => {
      stop(); clearTimeout(handshake); sockets.delete(socket); clients.delete(socket);
      if (hello?.role === 'native' && instances.get(route) === socket) instances.delete(route);
      // Several chats can share one credential. Revoke only its last matching lease.
      // A socket with a forged secret must never keep an authorized grant alive.
      if (hello?.role === 'client' && ![...clients.values()].some(client =>
        client.route === route && client.credentialId === hello.credentialId && equal(client.secret, hello.secret))) {
        const native = instances.get(route);
        if (native) { try { writeFrame(native, { type: 'client-disconnected', credentialId: hello.credentialId, credentialSecret: hello.secret, instanceId: hello.instanceId, browser: hello.browser }); } catch { native.destroy(); } }
      }
      for (const [id, job] of pending) {
        if (job.native === socket) failRequest(id, 'not-connected');
        else if (job.client === socket) {
          clearTimeout(job.timer); pending.delete(id);
          try { writeFrame(job.native, { type: 'cancel', id }); } catch { job.native.destroy(); }
        }
      }
      if (!managedIdle || hello?.role === 'client') idle();
    });
    socket.on('error', () => socket.destroy());
  });
  const close = async () => {
    if (closed) return; closed = true; clearTimeout(idleTimer);
    for (const socket of sockets) socket.destroy();
    for (const id of pending.keys()) failRequest(id, 'not-connected');
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (owned) {
      try { if ((await lstat(config.socket)).ino === inode) await unlink(config.socket); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  };
  // Never unlink an occupied or stale path automatically: doctor reports recovery steps.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.socket, resolve); });
  owned = true;
  await chmod(config.socket, 0o600); inode = (await lstat(config.socket)).ino;
  idle();
  return { close, server, status: () => ({ sockets: sockets.size, instances: instances.size, pending: pending.size }) };
}
