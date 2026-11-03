// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { browser } from 'wxt/browser';
import { validateHfsEndpoint } from './hfs-settings';
export const HFS_STATE_KEY = 'mcp-hfs-installation-v1';
export interface HttpClientProfile { id: string; secret: string; name: string }
export interface HfsInstallation { version: 1; endpoint: string; providerSecret: string; clients: HttpClientProfile[] }
export function validateInstallation(raw: unknown): HfsInstallation {
  const value = raw as HfsInstallation;
  if (!value || value.version !== 1 || Object.keys(value).some(key => !['version', 'endpoint', 'providerSecret', 'clients'].includes(key)) || !/^[a-f0-9]{64}$/u.test(value.providerSecret) ||
    !Array.isArray(value.clients) || value.clients.length > 32 || new Set(value.clients.map(client => client.id)).size !== value.clients.length ||
    value.clients.some(client => !client || Object.keys(client).some(key => !['id', 'secret', 'name'].includes(key)) || !/^[a-zA-Z0-9_-]{16,80}$/u.test(client.id) || !/^[a-zA-Z0-9_-]{43}$/u.test(client.secret) ||
      typeof client.name !== 'string' || !client.name.trim() || client.name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(client.name))) throw new Error('invalid-hfs-configuration');
  validateHfsEndpoint(value.endpoint);
  return value;
}
export async function readInstallation(): Promise<HfsInstallation | undefined> {
  const stored = (await browser.storage.local.get(HFS_STATE_KEY))[HFS_STATE_KEY];
  return stored === undefined ? undefined : validateInstallation(stored);
}
export async function saveInstallation(value: HfsInstallation) { await browser.storage.local.set({ [HFS_STATE_KEY]: validateInstallation(value) }); }
export function clientSecret(): string {
  let binary = ''; for (const byte of crypto.getRandomValues(new Uint8Array(32))) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
