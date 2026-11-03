// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
export const DEFAULT_HFS_ENDPOINT = 'http://127.0.0.1:39861';
export function validateHfsEndpoint(value: unknown): string {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/u.test(value)) throw new Error('invalid-hfs-endpoint');
  const port = Number(value.split(':').at(-1));
  if (port < 1024 || port > 65535) throw new Error('invalid-hfs-endpoint');
  return value;
}
export const hfsPermission = { origins: ['http://127.0.0.1/*'] };
export interface HfsSettings { enabled: boolean; endpoint: string }
export function validateHfsSettings(raw: unknown): HfsSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['enabled', 'endpoint'].includes(key))) throw new Error('invalid-hfs-settings');
  const value = raw as HfsSettings;
  if (typeof value.enabled !== 'boolean') throw new Error('invalid-hfs-settings');
  return { enabled: value.enabled, endpoint: validateHfsEndpoint(value.endpoint) };
}
