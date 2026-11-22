// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

// noinspection ES6PreferShortImport
// Keep direct module imports in this test; the protocol has no parent barrel.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRedactionSettings } from '@/src/core/privacy/settings';
import type { CaptureResult } from '@/src/core';
import type { CaptureActiveTabResponse } from '@/src/capture-message';

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../../src/adapters/chrome/capture', () => ({ captureChromeAccessibilityTree: capture }));

async function loadBackground(target = 'chrome') {
  let listener: ((message: unknown, sender: unknown, reply: (result: unknown) => void) => boolean | void) | undefined;
  vi.stubGlobal('defineBackground', (start: () => void) => start());
  const storage = { managed: { get: vi.fn().mockResolvedValue({}) }, local: { get: vi.fn().mockResolvedValue({}) } };
  const commands = { onCommand: { addListener: vi.fn() } };
  const chromeApi = { commands, storage, runtime: { sendMessage: vi.fn(), id: 'synthetic-chrome-id', getURL: (path: string) => `chrome-extension://test${path}`, onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } },
    tabs: { get: vi.fn().mockResolvedValue({ id: 42, url: 'https://example.test/' }), query: vi.fn().mockResolvedValue([{ id: 42, title: 'Synthetic', url: 'https://example.test/' }]) } };
  vi.stubGlobal('chrome', chromeApi);
  const firefoxApi = {
    commands: undefined, storage,
    runtime: { sendMessage: vi.fn(), getBrowserInfo: vi.fn().mockResolvedValue({ name: 'Firefox', version: '157.0' }), getPlatformInfo: vi.fn().mockResolvedValue({ os: 'android' }), id: 'synthetic-firefox-id', getURL: (path: string) => `moz-extension://test${path}`, onMessage: { addListener: (callback: typeof listener) => { listener = callback; } } },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42, url: 'https://example.test/' }]),
      get: vi.fn().mockResolvedValue({ id: 42, url: 'https://example.test/' }),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    scripting: { executeScript: vi.fn().mockResolvedValue([{ frameId: 0, result: {
      ok: true, tree: { schemaVersion: 1, title: 'Synthetic Firefox', sourceUrl: 'https://example.test/', root: { role: 'page', children: [{ role: 'button', name: 'Save', children: [] }] } }, warnings: ['embedded-frames'],
    } }]) },
  };
  if (target === 'firefox') vi.doMock('../../src/adapters/firefox/capture', () => ({ captureFirefoxPage: async () => (await firefoxApi.scripting.executeScript())[0]!.result }));
  vi.doMock('wxt/browser', () => ({ browser: target === 'firefox' ? firefoxApi : chromeApi }));
  vi.stubEnv('BROWSER', target);
  if (target === 'firefox') {
    vi.stubGlobal('browser', firefoxApi);
    vi.stubGlobal('chrome', undefined);
  }
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await import('../../entrypoints/background');
  const api = target === 'firefox' ? firefoxApi : chromeApi;
  const sender = { id: api.runtime.id, url: api.runtime.getURL('/popup.html') };
  return { request: (message: unknown) => new Promise<CaptureActiveTabResponse>((resolve) => listener!(message, sender, resolve as (result: unknown) => void)), listener: listener!, sender, firefoxApi, storage, api };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); capture.mockReset(); });

describe('background export boundary', () => {
  it.each(['chrome', 'firefox'])('rejects personally blocked pages before content capture in %s', async target => {
    const background = await loadBackground(target);
    background.storage.local.get.mockResolvedValue({ 'capture-sources-v1': { allowlistEnabled: false, allowed: [], blocked: ['https://example.test'] } });
    const response = await background.request({ type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: false });
    expect(response).toMatchObject({ ok: false, error: { code: 'policy-blocked', message: expect.stringContaining('personal site settings') } });
    expect(capture).not.toHaveBeenCalled(); expect(background.firefoxApi.scripting.executeScript).not.toHaveBeenCalled();
  });
  it.each(['chrome', 'firefox'])('loads saved custom filters for every request in %s', async target => {
    const background = await loadBackground(target);
    capture.mockResolvedValue({ ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [{ role: 'StaticText', name: 'Acme', children: [] }] } } });
    background.firefoxApi.scripting.executeScript.mockResolvedValue([{ frameId: 0, result: { ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [{ role: 'StaticText', name: 'Acme', children: [] }] } } } }]);
    const settings = { version: 1, disabledBuiltins: [], customRules: [{ id: 'client', name: 'Client', text: 'Acme', enabled: true, caseSensitive: false }] };
    background.storage.local.get.mockResolvedValue({ 'redaction-filters-v1': settings });
    const request = { type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true };
    const response = await background.request(request);
    expect(response.ok).toBe(true);
    if (response.ok) { expect(response.export.serialized.content).not.toContain('Acme'); expect(response.export.serialized.content).toContain('[REDACTED]'); }
    background.storage.local.get.mockResolvedValue({});
    const next = await background.request(request);
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.export.serialized.content).toContain('Acme');
  });

  it.each(['chrome', 'firefox'])('captures only its own demo through the explicit bridge and applies its live draft in %s', async target => {
    const background = await loadBackground(target);
    const url = background.api.runtime.getURL('/demo.html') + '#session-1';
    background.api.tabs.query.mockResolvedValue([{ id: 42, url }]);
    const settings = { ...defaultRedactionSettings(), customRules: [{ id: 'client', name: 'Client', type: 'text', text: 'Acme', enabled: true, caseSensitive: false }] };
    background.api.runtime.sendMessage.mockResolvedValue({ settings, capture: { ok: true, tree: { schemaVersion: 1, sourceUrl: url, root: { role: 'page', children: [{ role: 'StaticText', name: 'Acme', children: [] }] } } } });
    background.storage.local.get.mockImplementation(async (key: string) => { if ((key === 'data-controls-v1' || key === 'capture-sources-v1')) return {}; throw new Error('Saved filters unavailable'); });
    const request = { type: 'capture-active-tab', compression: 'without', format: 'semantic-text', redactSensitiveData: true };
    const response = await background.request(request);
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.export.serialized.content).toContain('[REDACTED]');
    expect(response).not.toHaveProperty('tree'); expect(response).not.toHaveProperty('filters');
    expect(capture).not.toHaveBeenCalled(); expect(background.firefoxApi.scripting.executeScript).not.toHaveBeenCalled();
    const raw = await background.request({ ...request, redactSensitiveData: false });
    if (raw.ok) expect(raw.export.serialized.content).toContain('Acme'); else throw new Error('Demo privacy-off capture failed');
    for (const blocked of [background.api.runtime.getURL('/filters.html'), url.replace('test', 'another'), background.api.runtime.getURL('/demo.html') + '?x=1']) {
      background.api.tabs.query.mockResolvedValue([{ id: 42, url: blocked }]);
      expect(await background.request(request)).toMatchObject({ ok: false, error: { code: 'unsupported-page' } });
    }
  });

  it('blocks redacted exports if saved filters cannot be read, while explicit privacy-off exports remain available', async () => {
    const background = await loadBackground();
    background.storage.local.get.mockRejectedValue(new Error('synthetic private details'));
    const request = { type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true };
    expect(await background.request(request)).toMatchObject({ ok: false, error: { code: 'policy-blocked' } });
    expect(capture).not.toHaveBeenCalled();
    background.storage.local.get.mockResolvedValue({ 'redaction-filters-v1': { version: 99 } });
    expect(await background.request(request)).toMatchObject({ ok: false, error: { code: 'redaction-settings' } });
    expect(capture).not.toHaveBeenCalled();
    capture.mockResolvedValue({ ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [] } } });
    expect((await background.request({ ...request, redactSensitiveData: false })).ok).toBe(true);
  });

  it('prepares Firefox DOM content and warnings without Chrome capture or raw trees in the popup', async () => {
    const background = await loadBackground('firefox');
    const response = await background.request({ type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.export.serialized.content).toContain('button "Save"');
      expect(response.warnings).toEqual(['embedded-frames']);
      expect(response.export.serialized.content).toContain('Browser: Firefox Android 157.0');
    }
    expect(capture).not.toHaveBeenCalled();
    expect(response).not.toHaveProperty('tree');
    expect(background.firefoxApi.scripting.executeScript).toHaveBeenCalledOnce();
  });
  it('preserves Chrome partial-frame warnings through document metadata and serialization', async () => {
    capture.mockResolvedValue({ ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [
      { role: 'embedded-document', name: 'Widget', value: 'Not captured: unavailable', children: [] },
    ] } }, warnings: ['embedded-frames-partial'] });
    const background = await loadBackground();
    const response = await background.request({ type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.warnings).toEqual(['embedded-frames-partial']);
      expect(response.export.serialized.content).toContain('embedded-document');
    }
  });
  it('exports even when browser metadata APIs reject', async () => {
    const background = await loadBackground('firefox');
    background.firefoxApi.runtime.getBrowserInfo.mockRejectedValue(Error('Unavailable'));
    background.firefoxApi.runtime.getPlatformInfo.mockRejectedValue(Error('Unavailable'));
    const response = await background.request({ type: 'capture-active-tab', compression: 'maximum', format: 'markdown', redactSensitiveData: true });
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.export.serialized.content).toContain('**Browser:**');
  });
  it('returns only prepared content and counters with request-selected privacy and format', async () => {
    const tree = { schemaVersion: 1 as const, root: { role: 'page', children: [
      { role: 'textbox', name: 'Password', value: 'synthetic-private-value', children: [] },
    ] } };
    capture.mockResolvedValue({ ok: true, tree } satisfies CaptureResult);
    const background = await loadBackground();
    for (const privacy of [true, false]) {
      const response = await background.request({ type: 'capture-active-tab', compression: 'without', format: 'markdown', redactSensitiveData: privacy });
      expect(capture).toHaveBeenCalledWith(42, undefined, undefined, expect.objectContaining({ data: expect.any(Object), sources: expect.any(Object) }));
      expect(response.ok).toBe(true);
      expect(response).not.toHaveProperty('tree');
      if (response.ok) {
        expect(response.export.serialized.format).toBe('markdown');
        expect(response.export.serialized.content.includes('synthetic-private-value')).toBe(!privacy);
        expect(response.export.redactionCount).toBe(privacy ? 1 : 0);
        expect(response.export.reductionRatio).toBe(0);
      }
    }
  });

  it('rejects invalid options before capturing and passes capture failures without raw data', async () => {
    const background = await loadBackground();
    for (const invalid of [undefined, 'unknown', 'json']) {
      expect((await background.request({ type: 'capture-active-tab', compression: 'compact', format: invalid, redactSensitiveData: true })).ok).toBe(false);
    }
    expect(capture).not.toHaveBeenCalled();
    capture.mockResolvedValue({ ok: false, error: { code: 'debugger-busy', message: 'Busy' } });
    expect(await background.request({ type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true })).toEqual({ ok: false, error: { code: 'debugger-busy', message: 'Busy' } });
  });

  it('ignores unrelated messages and recovers after preparation errors', async () => {
    const background = await loadBackground();
    const reply = vi.fn();
    expect(background.listener({ type: 'unrelated' }, {}, reply)).toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
    capture.mockRejectedValue(new Error('synthetic-internal-value'));
    const request = { type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true };
    expect(await background.request(request)).toEqual({ ok: false, error: { code: 'capture-failed', message: 'Unable to prepare this page’s context.' } });
    capture.mockResolvedValue({ ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [] } } });
    expect((await background.request(request)).ok).toBe(true);
  });

  it('finishes capture if the popup closes before receiving the response', async () => {
    let finishCapture: ((value: CaptureResult) => void) | undefined;
    capture.mockImplementation(() => new Promise<CaptureResult>((resolve) => { finishCapture = resolve; }));
    const background = await loadBackground();
    const reply = vi.fn(() => { throw new Error('Receiver closed'); });
    expect(background.listener({ type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true }, background.sender, reply)).toBe(true);
    await vi.waitFor(() => expect(finishCapture).toBeTypeOf('function'));
    finishCapture!({ ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [] } } });
    await vi.waitFor(() => expect(reply).toHaveBeenCalledOnce());
    expect(capture).toHaveBeenCalledOnce();
  });

  it('ignores capture requests from content scripts, other extensions and non-popup documents', async () => {
    const background = await loadBackground();
    const reply = vi.fn();
    const message = { type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true };
    for (const sender of [{}, { ...background.sender, tab: { id: 42 } }, { ...background.sender, id: 'another-extension' }, { ...background.sender, url: 'https://example.test/' }]) {
      expect(background.listener(message, sender, reply)).toBeUndefined();
    }
    expect(reply).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
});


describe('enterprise capture boundary', () => {
  const request = { type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true };
  it('rejects a request that turns off forced redaction before reading the page', async () => {
    const background = await loadBackground();
    background.storage.managed.get.mockResolvedValue({ RedactionMode: 'force-on' });
    expect(await background.request({ ...request, redactSensitiveData: false })).toMatchObject({ ok: false, error: { code: 'policy-blocked' } });
    expect(capture).not.toHaveBeenCalled();
  });
  it.each(['chrome', 'firefox'])('applies mandatory corporate rules and returns a revision in %s', async target => {
    const background = await loadBackground(target);
    background.firefoxApi.runtime.getPlatformInfo.mockResolvedValue({ os: 'linux' });
    background.storage.managed.get.mockResolvedValue({ ManagedRedactionRules: [{ id: 'company', name: 'Company', type: 'text', text: 'Acme', enabled: true, caseSensitive: false }] });
    const result = { ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [{ role: 'StaticText', name: 'Acme', children: [] }] } } };
    capture.mockResolvedValue(result);
    background.firefoxApi.scripting.executeScript.mockResolvedValue([{ frameId: 0, result }]);
    const response = await background.request(request);
    expect(response).toMatchObject({ ok: true, policyRevision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    if (response.ok) { expect(response.export.serialized.content).not.toContain('Acme'); expect(response.export.serialized.content).toContain('[REDACTED]'); }
  });
  it('discards a capture when policy changes while it is pending', async () => {
    const background = await loadBackground();
    capture.mockImplementation(async () => {
      background.storage.managed.get.mockResolvedValue({ FileExportAllowed: false });
      return { ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [] } } };
    });
    expect(await background.request(request)).toMatchObject({ ok: false, error: { code: 'policy-blocked' } });
  });
  it('does not bypass a failed or invalid policy read', async () => {
    const background = await loadBackground();
    background.storage.managed.get.mockRejectedValue(new Error('Synthetic policy read failure'));
    expect(await background.request(request)).toMatchObject({ ok: false, error: { code: 'policy-blocked' } });
    background.storage.managed.get.mockResolvedValue({ PolicyVersion: 999 });
    expect(await background.request(request)).toMatchObject({ ok: false, error: { code: 'policy-blocked' } });
    expect(capture).not.toHaveBeenCalled();
  });
});


it.each(['chrome', 'firefox'])('enforces both forced-on and forced-off built-ins at the %s capture boundary', async target => {
  const background = await loadBackground(target);
  background.firefoxApi.runtime.getPlatformInfo.mockResolvedValue({ os: 'linux' });
  background.storage.managed.get.mockResolvedValue({ RequiredBuiltinFilters: ['email-hide'], DisabledBuiltinFilters: ['authorization'] });
  const result = { ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [{ role: 'StaticText', name: 'person@example.test Bearer abcdefghijklmnop', children: [] }] } } };
  capture.mockResolvedValue(result); background.firefoxApi.scripting.executeScript.mockResolvedValue([{ frameId: 0, result }]);
  const response = await background.request({ type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true });
  expect(response.ok).toBe(true);
  if (response.ok) { expect(response.export.serialized.content).not.toContain('person@example.test'); expect(response.export.serialized.content).toContain('Bearer abcdefghijklmnop'); }
});

it('applies mandatory data exclusions and sends only source rules to the capture adapter', async () => {
  const background = await loadBackground();
  background.storage.managed.get.mockResolvedValue({ PolicyVersion: 1, IncludeFormValues: false, IncludePageTitle: false, PageUrlMode: 'omit', LinkUrlMode: 'omit', RequiredBuiltinFilters: ['email-hide'] });
  capture.mockResolvedValue({ ok: true, tree: { schemaVersion: 1, title: 'PRIVATE-TITLE', sourceUrl: 'https://private.test/', root: { role: 'page', children: [{ role: 'textbox', name: 'Account', value: 'PRIVATE-VALUE', children: [] }] } } });
  const response = await background.request({ type: 'capture-active-tab', compression: 'maximum', format: 'semantic-text', redactSensitiveData: true });
  expect(response.ok).toBe(true);
  expect(JSON.stringify(response)).not.toContain('PRIVATE-'); expect(JSON.stringify(response)).not.toContain('private.test');
  expect(capture.mock.calls[0]![3].sources).not.toHaveProperty('RequiredBuiltinFilters');
  expect(response).toHaveProperty('operationId', expect.stringMatching(/^[0-9a-f-]{36}$/));
});

it('starts Android background without commands and captures despite unsupported managed storage', async () => {
  const background = await loadBackground('firefox');
  background.storage.managed.get.mockRejectedValue(new Error('Managed storage is not supported'));
  const response = await background.request({ type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true });
  expect(response.ok).toBe(true);
  expect(background.storage.managed.get).not.toHaveBeenCalled();
});
