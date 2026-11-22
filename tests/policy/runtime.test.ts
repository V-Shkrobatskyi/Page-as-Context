// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ platform: vi.fn(), get: vi.fn(), localGet: vi.fn(), set: vi.fn(), listeners: new Set<(...args: any[]) => void>() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { getPlatformInfo: mocks.platform }, storage: { managed: { get: mocks.get }, local: { get: mocks.localGet, set: mocks.set }, onChanged: {
  addListener: (fn: (...args: any[]) => void) => mocks.listeners.add(fn), removeListener: (fn: (...args: any[]) => void) => mocks.listeners.delete(fn),
} } } }));
import { checkPolicy, readPolicy, watchPolicy, captureOptions, assertSource } from '@/src/policy/runtime';
import { loadRedactionSettings, saveRedactionSettings } from '@/src/redaction-settings';
import { DEFAULT_DATA_CONTROLS } from '@/src/core/data-controls';
const prefs = { format: 'markdown', compression: 'compact', redactSensitiveData: true } as const;
beforeEach(() => { mocks.platform.mockReset().mockResolvedValue({ os: 'linux' }); mocks.get.mockReset().mockResolvedValue({}); mocks.localGet.mockReset().mockResolvedValue({}); mocks.set.mockReset(); mocks.listeners.clear(); });
afterEach(() => vi.unstubAllEnvs());
describe('managed storage enforcement', () => {
  it('keeps Android capture available without calling unsupported managed storage, preserving personal controls', async () => {
    vi.stubEnv('BROWSER', 'firefox');
    mocks.platform.mockResolvedValue({ os: 'android' });
    mocks.get.mockRejectedValue(new Error('Managed storage is not supported'));
    mocks.localGet.mockResolvedValue({ 'data-controls-v1': { ...DEFAULT_DATA_CONTROLS, includeFormValues: false } });
    const snapshot = await checkPolicy('capture');
    expect(snapshot.dataControls?.includeFormValues).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each(['linux', 'unknown'])('does not bypass failed managed reads on Firefox %s', async os => {
    vi.stubEnv('BROWSER', 'firefox');
    if (os === 'unknown') mocks.platform.mockRejectedValue(new Error('Platform unavailable'));
    else mocks.platform.mockResolvedValue({ os });
    mocks.get.mockRejectedValue(new Error('Managed storage is not supported'));
    await expect(readPolicy()).rejects.toThrow('Unable to load organization policies');
  });
  it('does not manufacture a revision on ordinary installations', async () => {
    expect(await readPolicy()).toEqual({ policy: expect.any(Object) });
    await expect(checkPolicy('copy', prefs)).resolves.toBeDefined();
  });
  it('requires a matching revision and rejects stale contexts after change or removal', async () => {
    mocks.get.mockResolvedValue({ PolicyVersion: 1, RedactionMode: 'force-on' });
    const snapshot = await readPolicy();
    expect(snapshot.revision).toMatch(/^[a-f0-9]{64}$/);
    await expect(checkPolicy('copy')).rejects.toThrow('Prepare the context again');
    await expect(checkPolicy('copy', { ...prefs, policyRevision: snapshot.revision })).resolves.toBeDefined();
    await expect(checkPolicy('copy', { ...prefs, redactSensitiveData: false, policyRevision: snapshot.revision })).rejects.toThrow('restricted');
    mocks.get.mockResolvedValue({ PolicyVersion: 1, RedactionMode: 'force-on', FileExportAllowed: false });
    await expect(checkPolicy('copy', { ...prefs, policyRevision: snapshot.revision })).rejects.toThrow('changed');
    mocks.get.mockResolvedValue({});
    await expect(checkPolicy('copy', { ...prefs, policyRevision: snapshot.revision })).rejects.toThrow('changed');
  });
  it('never opens export on a failed read; permits only Firefox’s explicit no-manifest result', async () => {
    mocks.get.mockRejectedValue(new Error('Synthetic storage failure with private value'));
    await expect(checkPolicy('capture')).rejects.toThrow('Unable to load organization policies');
    vi.stubEnv('BROWSER', 'firefox');
    mocks.get.mockRejectedValue(new Error('Managed storage manifest not found'));
    expect((await readPolicy()).revision).toBeUndefined();
    vi.stubEnv('BROWSER', 'chrome');
    await expect(readPolicy()).rejects.toThrow('Unable to load organization policies');
  });
  it('normalizes object/list order for revisions and does not expose rule text in revisions', async () => {
    mocks.get.mockResolvedValue({ FileExportAllowed: false, AllowedExportFormats: ['markdown', 'semantic-text'] });
    const a = await readPolicy();
    mocks.get.mockResolvedValue({ AllowedExportFormats: ['semantic-text', 'markdown'], FileExportAllowed: false });
    expect((await readPolicy()).revision).toBe(a.revision);
  });
  it('watches only managed changes and removes its listener on disposal', () => {
    const changed = vi.fn(); const stop = watchPolicy(changed);
    for (const fn of mocks.listeners) { fn({}, 'local'); fn({}, 'managed'); }
    expect(changed).toHaveBeenCalledOnce(); stop(); expect(mocks.listeners.size).toBe(0);
  });
  it('cannot persist personal filters under either save or customization restrictions', async () => {
    const { defaultRedactionSettings } = await import('@/src/core/privacy/settings');
    for (const policy of [{ UserPreferencesSaveAllowed: false }, { UserRedactionRulesAllowed: false }, { FilterSettingsAllowed: false }]) {
      mocks.get.mockResolvedValue(policy);
      await expect(saveRedactionSettings(defaultRedactionSettings())).rejects.toThrow('disabled');
    }
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('loads corporate rules despite unreadable personal filters when personal customization is disabled', async () => {
    mocks.get.mockResolvedValue({ UserRedactionRulesAllowed: false, RequiredBuiltinFilters: ['email-hide'] });
    mocks.localGet.mockImplementation(async (key: string) => { if ((key === 'data-controls-v1' || key === 'capture-sources-v1')) return {}; throw new Error('Unreadable personal configuration'); });
    const filters = await loadRedactionSettings();
    expect(filters.disabledBuiltins).not.toContain('email-hide');
    expect(mocks.localGet.mock.calls.every(([key]) => (key === 'data-controls-v1' || key === 'capture-sources-v1'))).toBe(true);
  });
});


it('keeps managed on/off overrides outside saved preferences and restores personal states after removal', async () => {
  const { defaultRedactionSettings } = await import('@/src/core/privacy/settings');
  const original = defaultRedactionSettings();
  mocks.localGet.mockResolvedValue({ 'redaction-filters-v1': original });
  mocks.get.mockResolvedValue({ RequiredBuiltinFilters: ['email-hide'], DisabledBuiltinFilters: ['authorization'] });
  const managed = await loadRedactionSettings();
  expect(managed.disabledBuiltins).toContain('authorization'); expect(managed.disabledBuiltins).not.toContain('email-hide');
  expect(mocks.set).not.toHaveBeenCalled(); expect(original).toEqual(defaultRedactionSettings());
  mocks.get.mockResolvedValue({});
  expect(await loadRedactionSettings()).toEqual(original);
});

it('invalidates prepared contexts when personal data exclusions change without a managed policy', async () => {
  const old = await readPolicy();
  mocks.localGet.mockResolvedValue({ 'data-controls-v1': { includeTitle: false, includeFormValues: false, pageUrl: 'origin', linkUrls: 'omit' } });
  const current = await readPolicy(); expect(current.revision).toMatch(/^[a-f0-9]{64}$/);
  await expect(checkPolicy('copy', { ...prefs, policyRevision: old.revision })).rejects.toThrow('changed');
  await expect(checkPolicy('copy', { ...prefs, policyRevision: current.revision })).resolves.toBeDefined();
});

it('enforces personal sources across main-document checks and adapter controls and invalidates old results', async () => {
  const old = await readPolicy();
  mocks.get.mockResolvedValue({ AllowedCaptureSources: ['https://*.company.test'] });
  mocks.localGet.mockResolvedValue({ 'capture-sources-v1': { allowlistEnabled: false, allowed: [], blocked: ['https://private.company.test'] } });
  const snapshot = await readPolicy();
  expect(() => assertSource('https://private.company.test', snapshot)).toThrow('personal site settings');
  expect(() => assertSource('https://outside.test', snapshot)).toThrow('administrator');
  expect(() => assertSource('https://team.company.test', snapshot)).not.toThrow();
  expect(captureOptions(snapshot).sources).toMatchObject({ AllowedCaptureSources: ['https://*.company.test'], personal: { BlockedCaptureSources: ['https://private.company.test'] } });
  await expect(checkPolicy('copy', { ...prefs, policyRevision: old.revision })).rejects.toThrow('changed');
  mocks.localGet.mockResolvedValue({ 'capture-sources-v1': { allowlistEnabled: 'invalid' } });
  await expect(readPolicy()).rejects.toThrow('capture source settings');
  await expect(readPolicy(false)).resolves.toBeDefined();
});

it('watches personal source changes and normalizes source-list order for revisions', async () => {
  const changed = vi.fn(); const stop = watchPolicy(changed);
  for (const listener of mocks.listeners) listener({ 'capture-sources-v1': {} }, 'local');
  expect(changed).toHaveBeenCalledOnce(); stop();
  mocks.localGet.mockResolvedValue({ 'capture-sources-v1': { allowlistEnabled: true, allowed: ['https://b.test', 'https://a.test'], blocked: [] } });
  const first = await readPolicy();
  mocks.localGet.mockResolvedValue({ 'capture-sources-v1': { allowlistEnabled: true, allowed: ['https://a.test', 'https://b.test'], blocked: [] } });
  expect((await readPolicy()).revision).toBe(first.revision);
});
