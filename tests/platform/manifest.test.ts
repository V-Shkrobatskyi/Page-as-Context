// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from 'vitest';
import { browserManifest } from '@/src/platform/manifest';

describe('browser capabilities', () => {
  it.each(['chrome', 'firefox'])('declares the same four desktop shortcuts in %s', target => {
    const commands = browserManifest(target).commands!;
    expect(Object.keys(commands)).toHaveLength(4);
    for (const [name, key] of [['preview-context', 'P'], ['copy-page-context', 'C'], ['save-context-file', 'S'], ['select-element', 'E']] as const) {
      expect(commands[name]).toMatchObject({ suggested_key: { default: `Alt+Shift+${key}`, mac: `Alt+Shift+${key}` }, description: expect.any(String) });
    }
  });

  it('keeps Chrome debugger permissions and omits Firefox settings', () => {
    const manifest = browserManifest('chrome');
    expect(manifest.permissions).toEqual(['debugger', 'activeTab', 'scripting', 'clipboardWrite', 'downloads', 'storage', 'alarms']);
    expect(manifest.optional_permissions).toEqual(['nativeMessaging']);
    expect(manifest.browser_specific_settings).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.minimum_chrome_version).toBe('125');
    expect(manifest.storage).toEqual({ managed_schema: 'managed-schema.json' });
  });

  it('uses on-demand Firefox capabilities without debugger or broad host access', () => {
    const manifest = browserManifest('firefox');
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'clipboardWrite', 'storage', 'alarms']);
    expect(manifest.optional_permissions).toEqual(['downloads', 'nativeMessaging']);
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(manifest.storage).toBeUndefined();
    expect(manifest.browser_specific_settings?.gecko).toEqual({
      id: '{e97aa566-cac0-4e2c-81f7-0ab664bf86ce}',
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'], optional: ['websiteContent', 'browsingActivity', 'personalCommunications', 'websiteActivity'] },
    });
    expect(manifest.browser_specific_settings?.gecko_android).toEqual({ strict_min_version: '142.0' });
  });

});
