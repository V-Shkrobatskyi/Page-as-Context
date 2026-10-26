// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { bridgeClient, validateCredential } from './client.mjs';
import { ensureBroker } from './startup.mjs';

/** Lazy startup lets MCP initialize before the browser is ready. Never replay a request. */
export function managedClient(config, credential) {
  validateCredential(credential);
  let current, connecting, unwatch, closed = false;
  const listeners = new Set();
  const connect = () => {
    if (closed) return Promise.reject(new Error('not-connected'));
    if (current?.closed) { unwatch?.(); unwatch = undefined; current = undefined; }
    if (current) return Promise.resolve(current);
    if (!connecting) connecting = (async () => {
      await ensureBroker(config);
      const bridge = await bridgeClient(config, credential);
      if (closed) { bridge.close(); throw new Error('not-connected'); }
      current = bridge;
      unwatch = bridge.onToolsChanged(() => { for (const listener of listeners) listener(); });
      for (const listener of listeners) listener();
      return bridge;
    })().finally(() => { connecting = undefined; });
    return connecting;
  };
  return {
    onToolsChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async request(request) {
      const bridge = await connect();
      try { return await bridge.request(request); }
      catch (error) {
        if (bridge.closed && current === bridge) { current = undefined; unwatch?.(); unwatch = undefined; }
        // An unavailable browser is not a lost IPC connection. Keep its notifications/lease.
        // The next explicit request can reconnect. A lost write reply remains unknown.
        throw error;
      }
    },
    close() { closed = true; listeners.clear(); unwatch?.(); current?.close(); current = undefined; },
  };
}
