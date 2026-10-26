// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { join } from 'node:path';
import { configuration, defaultDirectory, privateJson } from './security.mjs';
import { managedClient } from './managed-client.mjs';

/** Discovery never installs anything; explicit setup commands use a separate service. */
export function packageClient(browser, directory = defaultDirectory(), profileDirectory = join(directory, 'chatgpt/profiles')) {
  if (!['chrome', 'firefox'].includes(browser)) throw new Error('invalid-browser');
  let current, connecting, unwatch, closed = false;
  const listeners = new Set();
  const connect = async () => {
    if (closed) throw new Error('not-connected');
    if (current) return current;
    if (!connecting) connecting = (async () => {
      const config = await configuration(directory);
      const credential = await privateJson(join(profileDirectory, `${browser}.json`));
      if (credential.browser !== browser) throw new Error('invalid-credential');
      const client = managedClient(config, credential);
      if (closed) { client.close(); throw new Error('not-connected'); }
      current = client;
      unwatch = client.onToolsChanged(() => { for (const listener of listeners) listener(); });
      return client;
    })().finally(() => { connecting = undefined; });
    return connecting;
  };
  return {
    onToolsChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async request(request) { return (await connect()).request(request); },
    close() { closed = true; listeners.clear(); unwatch?.(); current?.close(); current = undefined; },
  };
}
