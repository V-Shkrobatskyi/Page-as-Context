// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { UserManifest } from 'wxt';
import { MCP_WRITE_DATA_TYPES } from '../mcp/data-types';

/** Keep browser capabilities separate with optional site access in Firefox. */
export function browserManifest(target: string): UserManifest {
  return {
    name: 'Page as Context',
    description: 'Structured browser context for AI.',
    commands: {
      'preview-context': { description: 'Preview and edit page context', suggested_key: { default: 'Alt+Shift+P', mac: 'Alt+Shift+P' } },
      'copy-page-context': { description: 'Copy page context', suggested_key: { default: 'Alt+Shift+C', mac: 'Alt+Shift+C' } },
      'save-context-file': { description: 'Save page context to file', suggested_key: { default: 'Alt+Shift+S', mac: 'Alt+Shift+S' } },
      'select-element': { description: 'Select an element', suggested_key: { default: 'Alt+Shift+E', mac: 'Alt+Shift+E' } },
    },
    permissions: target === 'firefox'
      ? ['activeTab', 'scripting', 'clipboardWrite', 'storage']
      : ['debugger', 'activeTab', 'scripting', 'clipboardWrite', 'downloads', 'storage'],
    ...(target === 'firefox' ? {} : { minimum_chrome_version: '125', storage: { managed_schema: 'managed-schema.json' } }),
    ...(target === 'firefox' ? {
      optional_permissions: ['downloads', 'nativeMessaging'],
      optional_host_permissions: ['http://*/*', 'https://*/*'],
      browser_specific_settings: {
        gecko: {
          id: '{e97aa566-cac0-4e2c-81f7-0ab664bf86ce}',
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['none'], optional: [...MCP_WRITE_DATA_TYPES] },
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    } : { optional_permissions: ['nativeMessaging'] }),
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
  };
}
