// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { join } from 'node:path';
import { configuration, defaultDirectory } from './security.mjs';
import { managedClient } from './managed-client.mjs';
import { profileStore } from './profile-store.mjs';

/** Recheck selection before each request. Never replay a request across profiles. */
export function packageClient(browser, directory = defaultDirectory(), profileDirectory = join(directory, 'chatgpt/profiles'), dependencies = {}) {
  const profiles = profileStore(browser, profileDirectory);
  const createClient = dependencies.managedClient ?? managedClient;
  const getConfiguration = dependencies.configuration ?? configuration;
  let current, revision, unwatch, closed = false, selecting = Promise.resolve();
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };
  const connect = () => {
    const next = selecting.then(async () => {
      if (closed) throw new Error('not-connected');
      const selected = await profiles.read();
      if (!selected.credential) throw new Error('not-connected');
      if (current && revision === selected.revision) return current;
      const config = await getConfiguration(directory);
      if (closed) throw new Error('not-connected');
      const client = createClient(config, selected.credential);
      unwatch?.(); current?.close();
      current = client; revision = selected.revision;
      unwatch = client.onToolsChanged(notify);
      notify();
      return client;
    });
    selecting = next.catch(() => {});
    return next;
  };
  return {
    onToolsChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async refresh() { await connect(); },
    async request(request) { return (await connect()).request(request); },
    close() { closed = true; listeners.clear(); unwatch?.(); current?.close(); current = undefined; },
  };
}
