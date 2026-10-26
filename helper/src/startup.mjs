// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { connectSocket } from './broker.mjs';
import { readFrames, writeFrame } from './framing.mjs';
import { PROTOCOL, secret, equal, BROKER_VERSION, readinessProof } from './security.mjs';

const starting = new Map();

async function socketPresent(config) {
  try {
    const stat = await lstat(config.socket);
    if (!stat.isSocket() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error('unsafe-socket');
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

/** Authenticated readiness, without sending the installation secret to an unknown socket. */
export async function brokerReady(config, timeout = 500) {
  if (!await socketPresent(config)) throw new Error('broker-unavailable');
  const socket = await connectSocket(config.socket, timeout);
  try {
    return await new Promise((resolve, reject) => {
      const nonce = secret();
      const timer = setTimeout(() => finish(new Error('broker-unavailable')), timeout);
      const finish = (error, value) => { clearTimeout(timer); stop(); socket.off('close', closed); error ? reject(error) : resolve(value); };
      const closed = () => finish(new Error('broker-unavailable'));
      const stop = readFrames(socket, value => {
        const expected = readinessProof(config, `broker:${nonce}:${config.installationId}:${BROKER_VERSION}:${value?.pid}`);
        if (value?.type !== 'ready' || value.protocol !== PROTOCOL || value.installationId !== config.installationId ||
          value.brokerVersion !== BROKER_VERSION || value.nonce !== nonce || !Number.isSafeInteger(value.pid) || value.pid < 1 || !equal(value.proof, expected)) {
          finish(new Error('broker-incompatible')); return;
        }
        finish(undefined, { pid: value.pid, brokerVersion: value.brokerVersion });
      }, () => finish(new Error('broker-incompatible')));
      socket.once('close', closed);
      writeFrame(socket, { type: 'hello', role: 'supervisor', protocol: PROTOCOL, nonce, proof: readinessProof(config, `client:${nonce}`) });
    });
  } finally { socket.destroy(); }
}

/** At most one spawn per caller; the kernel socket bind elects one broker across processes. */
export function ensureBroker(config, options = {}) {
  const key = JSON.stringify([config.directory, config.installationId, config.hostSecret]);
  if (!starting.has(key)) {
    const pending = start(config, options).finally(() => { if (starting.get(key) === pending) starting.delete(key); });
    starting.set(key, pending);
  }
  return starting.get(key);
}

async function start(config, { timeout = 5000, idleTimeout = 30000, executable, worker } = {}) {
  if (await socketPresent(config)) return brokerReady(config, Math.min(timeout, 500));
  // A new native install owns a stable copy; older development installs may use the checkout.
  const installedWorker = join(config.directory, 'runtime/broker-worker.mjs');
  let installed = false;
  try { await lstat(installedWorker); installed = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  executable ??= installed ? join(config.directory, 'runtime/node') : process.execPath;
  worker ??= installed ? installedWorker : fileURLToPath(new URL('./broker-worker.mjs', import.meta.url));
  const child = spawn(executable, [worker, config.directory, String(idleTimeout)], {
    detached: true, stdio: 'ignore', shell: false,
    // No inherited MCP stdout, credentials, model input or dynamic environment hooks.
    env: { PATH: '/usr/bin:/bin', ...(process.env.HOME ? { HOME: process.env.HOME } : {}) },
  });
  let failed = false;
  child.once('error', () => { failed = true; });
  child.unref();
  const end = Date.now() + timeout;
  try {
    while (Date.now() < end) {
      if (failed) throw new Error('broker-runtime-unavailable');
      if (await socketPresent(config)) return await brokerReady(config, Math.min(500, Math.max(1, end - Date.now())));
      if (Number.isInteger(child.exitCode) && child.exitCode > 0) throw new Error('broker-start-failed');
      await delay(25);
    }
    throw new Error('broker-start-timeout');
  } catch (error) {
    // Only terminate our own still-running attempt, never a PID read from disk or another client.
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    throw error;
  }
}
