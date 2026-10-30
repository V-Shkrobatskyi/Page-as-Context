// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stored: {} as Record<string, unknown>, managed: {} as Record<string, unknown>, capture: vi.fn(), api: {} as any }));
vi.mock('wxt/browser', () => ({ browser: state.api }));
vi.mock('@/src/adapters/capture', () => ({ captureActiveTab: state.capture }));
vi.mock('@/src/adapters/actions/snapshot', () => ({ createActionSnapshot: async (_tabId: number, lease: object) => ({ ...lease, targets: new Map(), dispose: vi.fn() }) }));
import { defaultMcpSettings, resolveMcpSettings, validateMcpSettings, mcpWritesEnabled, autoDisconnectMilliseconds } from '@/src/mcp/settings';
import { readMcpContext } from '@/src/mcp/capture';
import { validatePolicy, assertAction } from '@/src/policy/model';
import { sourceAllowed } from '@/src/policy/sources';

beforeEach(() => {
  state.stored = {}; state.managed = {}; state.capture.mockReset();
  Object.assign(state.api, { storage: { managed: { get: vi.fn(async () => state.managed) }, local: {
    get: vi.fn(async () => state.stored), set: vi.fn(async (value: object) => Object.assign(state.stored, value)),
  } }, tabs: { get: vi.fn(async () => ({ id: 7, url: 'https://example.test/page' })), query: vi.fn() }, runtime: { sendMessage: vi.fn() } });
  state.capture.mockResolvedValue({ ok: true, tree: { schemaVersion: 1, title: 'Synthetic', sourceUrl: 'https://example.test/page', root: { role: 'page', name: 'Synthetic', children: [{ role: 'textbox', name: 'Password', value: 'test-secret-should-be-redacted', children: [] }] } } });
});

it('defaults Automatic inactivity to one hour and converts the selectable periods', () => {
  expect(autoDisconnectMilliseconds(defaultMcpSettings())).toBe(3600000);
  for (const [unit, milliseconds] of [['minutes', 60000], ['hours', 3600000], ['days', 86400000], ['unlimited', Infinity]] as const) {
    const settings = validateMcpSettings({ ...defaultMcpSettings(), autoDisconnect: { amount: 2, unit } });
    expect(autoDisconnectMilliseconds(settings)).toBe(milliseconds * 2);
  }
});
it.each([null, [], { amount: 0, unit: 'hours' }, { amount: -1, unit: 'days' }, { amount: 1.5, unit: 'minutes' }, { amount: 1000, unit: 'days' }, { amount: '1', unit: 'hours' }, { amount: 1, unit: 'weeks' }, { amount: 1, unit: 'hours', unexpected: true }])('rejects invalid auto-disconnect settings: %j', autoDisconnect => {
  expect(() => validateMcpSettings({ ...defaultMcpSettings(), autoDisconnect })).toThrow();
});

describe('MCP settings, policy and shared context', () => {
  it('starts disabled, read-only, inheriting extension settings; rejects corrupt saved settings', () => {
    expect(validateMcpSettings(undefined)).toEqual(defaultMcpSettings());
    for (const invalid of [null, [], {}, { ...defaultMcpSettings(), enabled: 'true' }, { ...defaultMcpSettings(), inherit: false }, { ...defaultMcpSettings(), data: false }]) {
      expect(() => validateMcpSettings(invalid)).toThrow();
    }
  });
  it('keeps clipboard/file/preview permissions independent from the external MCP channel', () => {
    const policy = validatePolicy({ ClipboardExportAllowed: false, FileExportAllowed: false, PreviewAllowed: false });
    expect(() => assertAction(policy, 'capture')).toThrow();
    expect(() => assertAction(policy, 'mcp-test')).toThrow();
    expect(() => assertAction(policy, 'mcp-read')).not.toThrow();
    expect(() => assertAction(validatePolicy({ McpAllowedModes: ['read-only'] }), 'mcp-write')).toThrow();
    for (const raw of [{ McpAllowed: 'true' }, { McpMaxSessionMinutes: 0 }, { McpMaxResponseKiB: 16385 }, { McpAllowedActions: ['evaluate'] }, { McpAllowedClientIds: ['bad'] }, { McpAllowedModes: ['read-only'], McpDefaultMode: 'read-write' }]) expect(() => validatePolicy(raw)).toThrow();
  });
  it('MCP source restrictions intersect all general source rules, including frame checks', () => {
    const rules = { AllowedCaptureSources: ['https://*.example.test'], personal: { BlockedCaptureSources: ['https://private.example.test'] }, additional: { AllowedCaptureSources: ['https://app.example.test'] } };
    expect(sourceAllowed('https://app.example.test/path', rules)).toBe(true);
    expect(sourceAllowed('https://private.example.test/path', rules)).toBe(false);
    expect(sourceAllowed('https://other.example.test/path', rules)).toBe(false);
  });
  it('settings revision includes filters and inherited export preferences', async () => {
    const first = await resolveMcpSettings();
    state.stored['popup-settings'] = { format: 'markdown', compression: 'detailed', redactSensitiveData: true };
    const second = await resolveMcpSettings(); expect(second.revision).not.toBe(first.revision);
    state.stored['redaction-filters-v1'] = { version: 99 };
    await expect(resolveMcpSettings()).rejects.toThrow();
  });
  it('cannot relax global data controls through an MCP-specific choice', async () => {
    state.stored['data-controls-v1'] = { includeTitle: false, includeFormValues: false, pageUrl: 'omit', linkUrls: 'omit' };
    state.stored['mcp-settings-v1'] = { ...defaultMcpSettings(), data: { includeTitle: true, includeFormValues: true, pageUrl: 'full', linkUrls: 'full' } };
    expect((await resolveMcpSettings()).data).toEqual(state.stored['data-controls-v1']);
  });
  it('local preview uses the sanitized external renderer without requiring enabled transport', async () => {
    const payload = await readMcpContext(7, () => {}, true, new AbortController().signal);
    expect(payload.context).not.toContain('test-secret');
    expect(payload.context).not.toContain('Generated by'); expect(payload.mode).toBe('read-only');
    expect(state.api.tabs.query).not.toHaveBeenCalled();
    await expect(readMcpContext(7, () => {}, false, new AbortController().signal)).rejects.toThrow('disabled');
  });
  it('drops an in-flight result if filters or navigation change', async () => {
    state.capture.mockImplementationOnce(async () => { state.stored['popup-settings'] = { format: 'markdown' }; return { ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [] } } }; });
    await expect(readMcpContext(7, () => {}, true, new AbortController().signal)).rejects.toThrow('changed');
    state.api.tabs.get.mockResolvedValueOnce({ id: 7, url: 'https://example.test/page' }).mockResolvedValueOnce({ id: 7, url: 'https://other.test/' });
    await expect(readMcpContext(7, () => {}, true, new AbortController().signal)).rejects.toThrow('changed');
  });
  it('uses an allowed action-safe fallback and rejects forced Maximum before capture', async () => {
    state.stored['mcp-settings-v1'] = { ...defaultMcpSettings(), mode: 'read-write' };
    state.stored['popup-settings'] = { compression: 'maximum' };
    const access = { owner: 'synthetic-owner', expires: Date.now() + 60000, write: true, retain: vi.fn() };
    const payload = await readMcpContext(7, () => {}, true, new AbortController().signal, undefined, access);
    expect(payload).toMatchObject({ mode: 'read-write', compression: 'compact', requestedCompression: 'maximum', warnings: ['action-safe-compression'] });
    state.managed = { ForcedCompression: 'maximum' };
    state.capture.mockClear();
    await expect(readMcpContext(7, () => {}, true, new AbortController().signal, undefined, access)).rejects.toThrow('unsupported-combination');
    expect(state.capture).not.toHaveBeenCalled();
  });
  it('rejects incognito, denied sources and read errors before returning page data', async () => {
    state.api.tabs.get.mockResolvedValueOnce({ id: 7, url: 'https://example.test/page', incognito: true });
    await expect(readMcpContext(7, () => {}, true, new AbortController().signal)).rejects.toThrow(); expect(state.capture).not.toHaveBeenCalled();
    state.managed = { McpAllowedCaptureSources: [] };
    await expect(readMcpContext(7, () => {}, true, new AbortController().signal)).rejects.toThrow(); expect(state.capture).not.toHaveBeenCalled();
  });
  it('bounds the complete textual envelope including escaping rather than silently truncating context', async () => {
    state.managed = { McpMaxResponseKiB: 64 };
    state.capture.mockResolvedValue({ ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [{ role: 'StaticText', name: '"'.repeat(20000), children: [] }] } } });
    await expect(readMcpContext(7, () => {}, true, new AbortController().signal)).rejects.toThrow('response-limit');
  });
});


it.each(['automatic', 'manual'] as const)('uses Mode as the write ceiling for %s connections', connection => {
  expect(mcpWritesEnabled({ ...defaultMcpSettings(), connection, mode: 'read-only' })).toBe(false);
  expect(mcpWritesEnabled({ ...defaultMcpSettings(), connection, mode: 'read-write' })).toBe(true);
});
it.each([
  ['automatic', 'read-only', true, 'read-only'],
  ['automatic', 'read-write', false, 'read-only'],
  ['automatic', 'read-write', true, 'read-write'],
  ['manual', 'read-write', false, 'read-write'],
] as const)('migrates %s/%s with legacy actions=%s to %s without widening permissions', (connection, mode, allowPageActions, expected) => {
  const settings = validateMcpSettings({ ...defaultMcpSettings(), connection, mode, allowPageActions });
  expect(settings.mode).toBe(expected); expect(settings).not.toHaveProperty('allowPageActions');
  expect(validateMcpSettings(settings)).toEqual(settings);
});
it('rejects a malformed legacy checkbox instead of granting access', () => {
  expect(() => validateMcpSettings({ ...defaultMcpSettings(), allowPageActions: 'true' })).toThrow();
});
