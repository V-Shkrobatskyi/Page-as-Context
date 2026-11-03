// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import compatibility from './compatibility.json';
import authSource from './auth.mjs?raw';
import relaySource from './relay.mjs?raw';
import { validateHfsEndpoint } from '../../src/mcp/hfs-settings';
export const HFS_COMPATIBILITY = '3.3.4';
export const RELAY_PROTOCOL = 1;
export const CONFIG_SCHEMA = 1;
/** Source is embedded as data for download, never evaluated by the extension. */
export function generateHfsConfiguration(endpoint: string, providerSecret: string): string {
  validateHfsEndpoint(endpoint);
  if (!/^[a-f0-9]{64}$/u.test(providerSecret)) throw new Error('invalid-provider-secret');
  const source = authSource.replace('export function', 'function') + '\n' + relaySource.replace(/^import .*;\n/mu, '').replace('export function', 'function') +
    `\nObject.assign(exports, createRelay(${JSON.stringify({ endpoint, providerSecret })}, require('node:crypto').webcrypto));\n`;
  return `# Page as Context HFS bridge. Contains executable code and a provider secret.\n# Relay SHA-256: ${compatibility.sources['relay.mjs']}\n# Config schema: ${CONFIG_SCHEMA}; relay protocol: ${RELAY_PROTOCOL}; reviewed HFS: ${HFS_COMPATIBILITY}.\n` +
    `port: ${new URL(endpoint).port}\nlisten_interface: 127.0.0.1\nopen_browser_at_start: false\nlocalhost_admin: false\nenable_plugins: []\nvfs: {}\nlog: ""\nerror_log: ""\nserver_code: |\n` +
    source.split('\n').map(line => '  ' + line).join('\n') + '\n';
}
