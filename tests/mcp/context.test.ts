// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stored: {} as Record<string, unknown>, managed: {} as Record<string, unknown>, capture: vi.fn(), api: {} as any }));
vi.mock('wxt/browser', () => ({ browser: state.api }));
vi.mock('@/src/adapters/capture', () => ({ captureActiveTab: state.capture }));
vi.mock('@/src/adapters/actions/snapshot', () => ({ createActionSnapshot: vi.fn(async (_tabId: number, lease: object) => ({ ...lease, targets: new Map(), dispose: vi.fn() })) }));
import { defaultMcpSettings, resolveMcpSettings, validateMcpSettings, mcpWritesEnabled, maxWriteActions, autoDisconnectMilliseconds } from '@/src/mcp/settings';

it('defaults maxActions to 10, validates 1–10 and respects the organization ceiling', () => {
  expect(maxWriteActions(defaultMcpSettings())).toBe(10);
  expect(maxWriteActions(validateMcpSettings({ ...defaultMcpSettings(), maxActions: 5 }), { McpMaxActions: 2 })).toBe(2);
  expect(maxWriteActions(validateMcpSettings({ ...defaultMcpSettings(), maxActions: 1 }))).toBe(1);
  for (const maxActions of [null, 0, -1, 11, 1.5, '5', false]) expect(() => validateMcpSettings({ ...defaultMcpSettings(), maxActions })).toThrow();
  expect(validatePolicy({ McpMaxActions: 3 })).toMatchObject({ McpMaxActions: 3 });
  for (const McpMaxActions of [0, 11, 1.5, '5']) expect(() => validatePolicy({ McpMaxActions })).toThrow();
});
import { readMcpContext } from '@/src/mcp/capture';
import { createActionSnapshot } from '@/src/adapters/actions/snapshot';
import { validatePolicy, assertAction } from '@/src/policy/model';
import { sourceAllowed } from '@/src/policy/sources';

beforeEach(() => {
  state.stored = {}; state.managed = {}; state.capture.mockReset(); vi.mocked(createActionSnapshot).mockClear();
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


it('collects an explicit operation baseline but returns only scoped targets and preserves partial semantics', async () => {
  state.stored['mcp-settings-v1'] = { ...defaultMcpSettings(), mode: 'read-write' };
  const field = (ref: string, value: string) => ({ role: 'textbox', name: 'Display name', value, actionRef: ref, captureIdentity: 'internal-only-identity', children: [] });
  const firstRef = crypto.randomUUID(), nextRef = crypto.randomUUID(), otherRef = crypto.randomUUID();
  const tree = (ref: string, value: string) => ({ schemaVersion: 1, sourceUrl: 'https://example.test/page', root: { role: 'page', children: [field(ref, value), { role: 'button', name: 'Outside field', actionRef: otherRef, children: [] }] } });
  const access = { owner: 'synthetic-owner', expires: Date.now() + 60000, write: true, collectScopeTree: true, retain: vi.fn() };
  state.capture.mockResolvedValueOnce({ ok: true, tree: tree(firstRef, 'old') });
  const first = await readMcpContext(7, () => {}, true, new AbortController().signal, undefined, access);
  expect(first).not.toHaveProperty('scope');
  const before = access.retain.mock.calls[0]![0].scopeTree;
  state.capture.mockResolvedValueOnce({ ok: true, tree: tree(nextRef, 'new') });
  const scoped = await readMcpContext(7, () => {}, true, new AbortController().signal, undefined, access, { before, elementRef: firstRef, parentTag: 'form' });
  expect(scoped).toMatchObject({ partial: false, scope: { kind: 'scoped', parentTag: 'form', parentSummaryOnly: true } });
  expect(scoped.snapshotId).not.toBe(first.snapshotId);
  expect(scoped.context).toContain(nextRef); expect(scoped.context).not.toContain(otherRef);
  expect(JSON.stringify(scoped)).not.toMatch(/internal-only-identity|scopeTree|captureIdentity/);
  expect([...access.retain.mock.calls[1]![0].targets.keys()]).toEqual([nextRef]);
  state.capture.mockResolvedValueOnce({ ok: true, tree: tree(crypto.randomUUID(), 'new'), warnings: ['frame-unavailable'] });
  const partial = await readMcpContext(7, () => {}, true, new AbortController().signal, undefined, access, { before, elementRef: firstRef, parentTag: 'form' });
  expect(partial).toMatchObject({ partial: true, scope: { kind: 'full', fallbackReason: 'capture-partial' } });
  expect(partial.scope).not.toHaveProperty('parentSummaryOnly');
  state.capture.mockResolvedValueOnce({ ok: true, tree: tree(crypto.randomUUID(), '"'.repeat(5000)) });
  const large = await readMcpContext(7, () => {}, true, new AbortController().signal, undefined, access, { before, elementRef: firstRef, parentTag: 'label' });
  expect(large.scope).toMatchObject({ kind: 'full', fallbackReason: 'scoped-response-limit' });
  expect(large.scope).not.toHaveProperty('parentSummaryOnly');
});


it('does not retain a page tree on an ordinary action snapshot', async () => {
  state.stored['mcp-settings-v1'] = { ...defaultMcpSettings(), mode: 'read-write' };
  const retain = vi.fn();
  await readMcpContext(7, () => {}, true, new AbortController().signal, undefined, {owner:'synthetic-owner',expires:Date.now()+60000,write:true,retain});
  expect(retain.mock.calls[0]![0].scopeTree).toBeUndefined();
});

it('bounds targeted tool envelopes and discards refs on unavailable results', async () => {
  state.stored['mcp-settings-v1'] = { ...defaultMcpSettings(), mode: 'read-write' };
  const ref = crypto.randomUUID(), outside = crypto.randomUUID();
  const retain = vi.fn(), access = { owner: 'targeted-owner', expires: Date.now() + 60000, write: true, retain };
  const source = (name: string) => ({ schemaVersion: 1, root: { role: 'page', children: [
    { role: 'textbox', name: 'Notes', value: name, actionRef: ref, children: [] },
    { role: 'button', name: 'Outside', actionRef: outside, children: [] },
  ] } });
  state.capture.mockResolvedValueOnce({ ok: true, tree: source('Small') });
  const first = await readMcpContext(7, () => {}, true, new AbortController().signal, undefined, access, undefined, { target: { role: 'textbox', name: 'Notes' } });
  expect(first.target?.outcome).toBe('found'); expect([...retain.mock.calls[0]![0].targets.keys()]).toEqual([ref]);
  state.capture.mockResolvedValueOnce({ ok: true, tree: source('"'.repeat(10000)) });
  const large = await readMcpContext(7, () => {}, true, new AbortController().signal, undefined, access, undefined, { target: { role: 'textbox', name: 'Notes' } });
  expect(large.target).toMatchObject({ outcome: 'context-unavailable', reason: 'target-response-limit' });
  expect(retain.mock.calls[1]![0].targets.size).toBe(0);
  expect(new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(large) }] })).length).toBeLessThan(16 * 1024);
  state.stored['popup-settings'] = { compression: 'maximum' };
  state.capture.mockResolvedValueOnce({ ok: true, tree: source('Small') });
  const maximum = await readMcpContext(7, () => {}, true, new AbortController().signal, undefined, undefined, undefined, { target: { role: 'textbox', name: 'Notes' } });
  expect(maximum.target).toMatchObject({ outcome: 'context-unavailable', reason: 'semantic-compression-unavailable' });
});

it('measures complete synthetic request/response envelopes for targeted and full reads', async () => {
  const source = { schemaVersion: 1, root: { role: 'page', children: [
    { role: 'form', name: 'Profile', children: [
      { role: 'textbox', name: 'Public name', value: 'Example', description: 'Use a public name', children: [] },
      { role: 'status', name: 'Ready', children: [] },
    ] },
    ...Array.from({ length: 100 }, (_, n) => ({ role: 'paragraph', name: `Unrelated page text ${n}`, children: [] })),
  ] } };
  const connectionId = 'synthetic_connection_001', signal = new AbortController().signal;
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  const response = (payload: unknown) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ ...(payload as object), connectionId }) }] } });
  const request = (name: string, args: object) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { connectionId, ...args } } });
  state.capture.mockResolvedValue({ ok: true, tree: source });
  const full = await readMcpContext(7, () => {}, true, signal);
  for (const context of ['target', 'group'] as const) {
    const query = { target: { role: 'textbox', name: 'Public name' }, group: { role: 'form', name: 'Profile' }, context };
    const targeted = await readMcpContext(7, () => {}, true, signal, undefined, undefined, undefined, query);
    expect(targeted.target?.outcome).toBe('found'); expect(targeted.context).not.toContain('Unrelated');
    expect(bytes(response(targeted))).toBeLessThan(bytes(response(full)));
    console.info(JSON.stringify({ scenario: context, fullRequestBytes: bytes(request('read_page_context', {})), targetedRequestBytes: bytes(request('read_target_context', query)),
      fullResponseBytes: bytes(response(full)), targetedResponseBytes: bytes(response(targeted)), callsPerRead: 1, captureWork: 'full in both cases' }));
  }
});

it.each(['chrome-error://chromewebdata/', 'about:neterror', 'https://other.test/private', 'invalid-document-url'])(
  'refuses an actual captured document outside the HTTP tab grant before serialization/ref retention: %s', async sourceUrl => {
    state.stored['mcp-settings-v1'] = { ...defaultMcpSettings(), enabled: true, mode: 'read-write' };
    const retain = vi.fn(), ref = crypto.randomUUID();
    const access = { owner: 'document-boundary-test', expires: Date.now() + 60000, write: true, retain };
    const payload = { ok: true, tree: { schemaVersion: 1, sourceUrl, root: { role: 'page', children: [
      { role: 'button', name: 'Unauthorized document action', actionRef: ref, children: [] },
    ] } } };
    for (const targeted of [false, true]) {
      state.capture.mockResolvedValueOnce(payload);
      await expect(readMcpContext(7, () => {}, false, new AbortController().signal, undefined, access, undefined,
        targeted ? { target: { role: 'button', name: 'Unauthorized document action' } } : undefined)).rejects.toThrow('captured document is unavailable');
    }
    expect(retain).not.toHaveBeenCalled();
    expect(createActionSnapshot).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(createActionSnapshot).mock.results) {
      const snapshot = await call.value; expect(snapshot.dispose).toHaveBeenCalledTimes(1); expect(snapshot.targets.size).toBe(0);
    }
  },
);

it('accepts the actual same-origin HTTP document and applies page URL exclusion after checking access', async () => {
  state.stored['mcp-settings-v1'] = { ...defaultMcpSettings(), enabled: true };
  state.stored['data-controls-v1'] = { includeTitle: true, includeFormValues: true, pageUrl: 'omit', linkUrls: 'omit' };
  state.capture.mockResolvedValueOnce({ ok: true, tree: { schemaVersion: 1, sourceUrl: 'https://example.test/page', root: { role: 'page', children: [{ role: 'button', name: 'Allowed action', children: [] }] } } });
  const result = await readMcpContext(7, () => {}, false, new AbortController().signal, undefined, undefined, undefined, { target: { role: 'button', name: 'Allowed action' } });
  expect(result.target?.outcome).toBe('found'); expect(result.context).not.toContain('https://example.test');
});
