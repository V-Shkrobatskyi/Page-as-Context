// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { readFrames, writeFrame } from './framing.mjs';
import { connectSocket } from './broker.mjs';
import { PROTOCOL, idValid } from './security.mjs';

/** Browser-launched role. The caller comes from browser argv, never from extension JSON. */
export async function nativeHost(config, caller, input = process.stdin, output = process.stdout) {
  if (!config.callers.includes(caller)) throw new Error('unknown-caller');
  let socket, registered = false;
  const timer = setTimeout(() => stop(), 5000);
  const stop = () => { clearTimeout(timer); stopInput(); socket?.destroy(); input.pause(); };
  const stopInput = readFrames(input, message => {
    if (!registered) {
      if (!message || message.type !== 'register' || message.protocol !== PROTOCOL || !idValid(message.instanceId) ||
        !['chrome', 'firefox'].includes(message.browser) || (message.browser === 'chrome') !== caller.startsWith('chrome-extension://')) return stop();
      registered = true;
      void connectSocket(config.socket).then(connected => {
        socket = connected;
        readFrames(socket, value => { try { writeFrame(output, value); } catch { stop(); } }, stop);
        socket.once('close', stop);
        writeFrame(socket, { type: 'hello', role: 'native', protocol: PROTOCOL, secret: config.hostSecret,
          caller, instanceId: message.instanceId, browser: message.browser });
        clearTimeout(timer);
      }, stop);
    } else if (socket) {
      if (message?.type !== 'result-chunk' && !(message?.type === 'tools-changed' && idValid(message.credentialId))) return stop();
      writeFrame(socket, message);
    } else stop();
  }, stop);
  input.once('end', stop); output.once('error', stop);
  return stop;
}
