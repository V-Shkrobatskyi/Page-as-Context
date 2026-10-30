// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { browser } from 'wxt/browser';
import { MCP_DATA_TYPES, MCP_WRITE_DATA_TYPES } from './data-types';

export const mcpBrowserPermissions = (): 'nativeMessaging'[] => ['nativeMessaging'];

/** Firefox treats sending data to a native helper as transmission outside the browser. */
export async function hasMcpTransmissionConsent(write = false): Promise<boolean> {
  if (import.meta.env.BROWSER !== 'firefox') return true;
  const permissions = await browser.permissions.getAll() as { data_collection?: string[] };
  return (write ? MCP_WRITE_DATA_TYPES : MCP_DATA_TYPES).every(type => permissions.data_collection?.includes(type));
}
export function requestMcpPermissions(write = false): Promise<boolean> {
  return browser.permissions.request({ permissions: mcpBrowserPermissions(), ...(import.meta.env.BROWSER === 'firefox' ? { data_collection: [...(write ? MCP_WRITE_DATA_TYPES : MCP_DATA_TYPES)] } : {}) });
}
