// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ api: {} as any, capture: vi.fn(), preview: vi.fn(), save: vi.fn(), filters: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: mocks.api }));
vi.mock('../../src/adapters/capture', () => ({ captureActiveTab: mocks.capture }));
vi.mock('../../src/preview-session', () => ({ openPreview: mocks.preview, openSelectionSave: mocks.save }));
vi.mock('../../src/redaction-settings', () => ({ loadRedactionSettings: mocks.filters }));
vi.mock('../../src/platform/browser-info', () => ({ resolveBrowserInfo: async () => 'Test Browser' }));
import { createPickerCoordinator } from '@/src/element-picker-session';
import { PICKER_PORT, PICKER_SAVE_PERMISSION } from '@/src/element-picker-protocol';

function event() {
  const listeners = new Set<(...args: any[]) => void>();
  return { listeners, addListener: (listener: (...args: any[]) => void) => listeners.add(listener),
    removeListener: (listener: (...args: any[]) => void) => listeners.delete(listener),
    emit: (...args: any[]) => { for (const listener of [...listeners]) listener(...args); } };
}
function port(token: string, overrides = {}) {
  return { name: `${PICKER_PORT}${token}`, sender: { id: 'extension', tab: { id: 42 }, frameId: 0, documentId: 'doc', url: 'https://example.test/', ...overrides },
    onMessage: event(), onDisconnect: event(), postMessage: vi.fn(), disconnect: vi.fn() };
}
const preferences = { compression: 'compact', format: 'semantic-text', redactSensitiveData: false } as const;
let active: ReturnType<typeof port>;
let documentValid: boolean;
let coordinator: ReturnType<typeof createPickerCoordinator>;

beforeEach(() => {
  vi.useFakeTimers(); documentValid = true;
  mocks.api.storage = { managed: { get: vi.fn().mockResolvedValue({}) } };
  mocks.api.runtime = { id: 'extension', onConnect: event(), onMessage: event(), getPlatformInfo: vi.fn().mockResolvedValue({ os: 'linux' }) };
  mocks.api.permissions = { request: vi.fn().mockResolvedValue(true), contains: vi.fn().mockResolvedValue(true) };
  mocks.api.tabs = { get: vi.fn().mockResolvedValue({ id: 42, url: 'https://example.test/' }), query: vi.fn().mockResolvedValue([{ id: 42, url: 'https://example.test/', title: 'Test page' }]), onUpdated: event(), onRemoved: event() };
  mocks.api.scripting = { executeScript: vi.fn(async (details: any) => {
    if (details.files) return [{ frameId: 0, documentId: 'doc' }];
    if (details.func.name === 'selectedElementInfo') return [{ frameId: 0, documentId: 'doc', result: documentValid ? { tagName: 'div' } : undefined }];
    active = port(details.args[0]); mocks.api.runtime.onConnect.emit(active);
    active.onMessage.emit({ type: 'ready' });
    return [{ frameId: 0, documentId: 'doc' }];
  }) };
  mocks.capture.mockReset().mockResolvedValue({ ok: true, tree: { schemaVersion: 1, title: 'Test page', sourceUrl: 'https://example.test/', root: { role: 'page', children: [{ role: 'StaticText', name: 'Selected content', children: [] }] } } });
  mocks.preview.mockReset().mockResolvedValue(undefined);
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.filters.mockReset().mockResolvedValue(undefined);
  coordinator = createPickerCoordinator();
});
afterEach(async () => { mocks.api.tabs.onRemoved.emit(42); await vi.runAllTimersAsync(); vi.useRealTimers(); vi.unstubAllEnvs(); });
const flush = async () => { for (let index = 0; index < 25; index++) await Promise.resolve(); };

describe('background-owned selection sessions', () => {
  it('reuses an existing Firefox download grant without requesting a required permission again', async () => {
    vi.stubEnv('BROWSER', 'firefox');
    await coordinator.start(preferences);
    const reply = vi.fn();
    mocks.api.runtime.onMessage.emit({ type: PICKER_SAVE_PERMISSION, token: active.name.slice(PICKER_PORT.length) }, active.sender, reply);
    expect(reply).toHaveBeenCalledWith({ granted: true });
    expect(mocks.api.permissions.request).not.toHaveBeenCalled();
  });
  it('requests Firefox download permission only for the active authenticated document', async () => {
    vi.stubEnv('BROWSER', 'firefox');
    mocks.api.permissions.contains.mockResolvedValue(false);
    await coordinator.start(preferences);
    const reply = vi.fn();
    const message = { type: PICKER_SAVE_PERMISSION, token: active.name.slice(PICKER_PORT.length) };
    mocks.api.runtime.onMessage.emit(message, { ...active.sender, frameId: 5 }, reply);
    expect(mocks.api.permissions.request).not.toHaveBeenCalled();
    mocks.api.runtime.onMessage.emit(message, active.sender, reply);
    expect(mocks.api.permissions.request).toHaveBeenCalledWith({ permissions: ['downloads'] });
    await flush(); expect(reply).toHaveBeenCalledWith({ granted: true });
  });
  it('copies only prepared context with clipboard boundaries and waits for the matching acknowledgement', async () => {
    await coordinator.start(preferences);
    active.onMessage.emit({ type: 'copy' }); await flush();
    const reply = active.postMessage.mock.calls.find(([message]) => message.type === 'copy-content')![0];
    expect(reply.content).toMatch(/^<web_page>\n/u);
    expect(reply.content).toContain('Selected content');
    expect(reply.content).toContain('Element: Selected block <div>');
    active.onMessage.emit({ type: 'copied', operation: 'stale' }); await flush();
    expect(active.postMessage).not.toHaveBeenCalledWith({ type: 'complete' });
    expect(active.disconnect).not.toHaveBeenCalled();
    active.onMessage.emit({ type: 'copied', operation: reply.operation }); await flush();
    expect(active.postMessage).toHaveBeenCalledWith({ type: 'complete' });
    expect(active.disconnect).toHaveBeenCalledOnce();
    expect(mocks.api.runtime.onConnect.listeners.size).toBe(0);
    expect(mocks.api.tabs.onUpdated.listeners.size).toBe(0);
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it('saves prepared content without clipboard boundaries or opening the editor', async () => {
    await coordinator.start(preferences);
    active.onMessage.emit({ type: 'save' }); await flush();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Selected content'), scope: 'selection' }), expect.any(AbortSignal));
    expect(mocks.save.mock.calls[0]![0].content).not.toContain('<web_page>');
    expect(mocks.save.mock.calls[0]![0].content).toContain('Element: Selected block <div>');
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(active.postMessage).toHaveBeenCalledWith({ type: 'complete' });
    expect(active.disconnect).toHaveBeenCalledOnce();
    expect(mocks.api.runtime.onConnect.listeners.size).toBe(0);
    expect(mocks.api.tabs.onUpdated.listeners.size).toBe(0);
  });

  it('keeps the picker session until Save accepts the export and allows retry after a failed handoff', async () => {
    await coordinator.start(preferences);
    let rejectSave!: (error: Error) => void;
    mocks.save.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectSave = reject; }));
    active.onMessage.emit({ type: 'save' }); await flush();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(active.postMessage).not.toHaveBeenCalledWith({ type: 'complete' });
    expect(active.disconnect).not.toHaveBeenCalled();
    rejectSave(new Error('Unable to open the save document.')); await flush();
    expect(active.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Unable to open the save document.' });
    expect(active.disconnect).not.toHaveBeenCalled();
    active.onMessage.emit({ type: 'save' }); await flush();
    expect(active.postMessage).toHaveBeenCalledWith({ type: 'complete' });
    expect(active.disconnect).toHaveBeenCalledOnce();
  });

  it('restores the selection after clipboard failure and rejects delayed acknowledgements', async () => {
    await coordinator.start(preferences);
    active.onMessage.emit({ type: 'copy' }); await flush();
    const reply = active.postMessage.mock.calls.find(([message]) => message.type === 'copy-content')![0];
    active.onMessage.emit({ type: 'copy-failed', operation: reply.operation }); await flush();
    expect(active.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    active.onMessage.emit({ type: 'copied', operation: reply.operation }); await flush();
    expect(active.postMessage).not.toHaveBeenCalledWith({ type: 'complete' });
    expect(active.disconnect).not.toHaveBeenCalled();
  });
  it('fixes the target before popup closure and transfers only the prepared export', async () => {
    expect(await coordinator.start(preferences)).toEqual({ ok: true });
    mocks.api.tabs.query.mockResolvedValue([{ id: 999, url: 'https://other.test/' }]);
    active.onMessage.emit({ type: 'capture' }); await flush();
    expect(mocks.capture).toHaveBeenCalledWith({ id: 42, title: 'Test page', url: 'https://example.test/' }, expect.any(String), expect.any(String), expect.any(AbortSignal), expect.objectContaining({ data: expect.any(Object), sources: expect.any(Object) }));
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ scope: 'selection', content: expect.stringContaining('Selected content') }), expect.any(AbortSignal));
    expect(mocks.preview.mock.calls[0]![0].content).toContain('Element: Selected block <div>');
    expect(mocks.preview.mock.calls[0]![0]).not.toHaveProperty('tree');
    expect(active.postMessage).toHaveBeenCalledWith({ type: 'complete' });
    expect(mocks.api.runtime.onConnect.listeners.size).toBe(0);
    expect(mocks.api.tabs.onUpdated.listeners.size).toBe(0);
  });

  it('rejects foreign frames/documents and does not capture before ready', async () => {
    mocks.api.scripting.executeScript.mockImplementation(async (details: any) => {
      if (details.files) return [{ frameId: 0, documentId: 'doc' }];
      const wrong = port(details.args[0], { frameId: 7 });
      mocks.api.runtime.onConnect.emit(wrong); expect(wrong.disconnect).toHaveBeenCalled();
      const stale = port(details.args[0], { documentId: 'stale' });
      mocks.api.runtime.onConnect.emit(stale); expect(stale.disconnect).toHaveBeenCalled();
      active = port(details.args[0]); mocks.api.runtime.onConnect.emit(active);
      active.onMessage.emit({ type: 'capture' }); expect(mocks.capture).not.toHaveBeenCalled();
      active.onMessage.emit({ type: 'ready' }); return [{ frameId: 0 }];
    });
    expect(await coordinator.start(preferences)).toEqual({ ok: true });
  });

  it('drops late capture results after navigation or cancellation and prevents duplicate requests', async () => {
    let finish!: (value: unknown) => void;
    mocks.capture.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await coordinator.start(preferences);
    active.onMessage.emit({ type: 'capture' }); active.onMessage.emit({ type: 'capture' }); await flush();
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    const signal = mocks.capture.mock.calls[0]![3] as AbortSignal;
    mocks.api.tabs.onUpdated.emit(42, { status: 'loading' });
    expect(signal.aborted).toBe(true);
    finish({ ok: true, tree: { schemaVersion: 1, root: { role: 'page', children: [] } } }); await flush();
    expect(mocks.preview).not.toHaveBeenCalled(); expect(active.disconnect).toHaveBeenCalled();
  });

  it('refuses a stale selected node and allows retry after a capture/preview failure', async () => {
    await coordinator.start(preferences);
    documentValid = false; active.onMessage.emit({ type: 'capture' }); await flush();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(active.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    documentValid = true; mocks.preview.mockRejectedValueOnce(new Error('Preview unavailable'));
    active.onMessage.emit({ type: 'capture' }); await flush();
    expect(active.postMessage).toHaveBeenCalledWith({ type: 'error', message: 'Preview unavailable' });
    active.onMessage.emit({ type: 'capture' }); await flush();
    expect(active.postMessage).toHaveBeenCalledWith({ type: 'complete' });
  });

  it('expires a startup even if injection is still pending', async () => {
    mocks.api.scripting.executeScript.mockReturnValue(new Promise(() => {}));
    const started = coordinator.start(preferences);
    await flush(); await vi.advanceTimersByTimeAsync(8_001);
    expect(await started).toMatchObject({ ok: false });
    expect(mocks.api.runtime.onConnect.listeners.size).toBe(0);
  });

  it('blocks privileged pages and unavailable redaction settings', async () => {
    mocks.api.tabs.query.mockResolvedValueOnce([{ id: 42, url: 'chrome://settings/' }]);
    expect(await coordinator.start(preferences)).toMatchObject({ ok: false });
    mocks.filters.mockRejectedValueOnce(new Error('Settings unavailable'));
    expect(await coordinator.start({ ...preferences, redactSensitiveData: true })).toMatchObject({ ok: false });
    expect(mocks.api.scripting.executeScript).not.toHaveBeenCalled();
  });
});


it('refuses element selection under corporate policy before injection', async () => {
  mocks.api.storage.managed.get.mockResolvedValue({ ElementPickerAllowed: false });
  expect(await coordinator.start(preferences)).toMatchObject({ ok: false, error: { message: expect.stringContaining('disabled by your administrator') } });
  expect(mocks.api.scripting.executeScript).not.toHaveBeenCalled();
});
it('rejects a prohibited picker file action even if a message bypasses its disabled button', async () => {
  mocks.api.storage.managed.get.mockResolvedValue({ FileExportAllowed: false });
  await coordinator.start(preferences);
  expect(active.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'active', saveAllowed: false }));
  active.onMessage.emit({ type: 'save' }); await vi.waitFor(() => expect(active.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
  expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  expect(active.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('File export is disabled') }));
});


it('blocks picker preview independently of copying and saving', async () => {
  mocks.api.storage.managed.get.mockResolvedValue({ PreviewAllowed: false });
  await coordinator.start(preferences);
  expect(active.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'active', previewAllowed: false }));
  active.onMessage.emit({ type: 'capture' });
  await vi.waitFor(() => expect(active.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringContaining('Preview is disabled') })));
  expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
});

it('allows Android selection and preview while refusing file saving and download permission', async () => {
  vi.stubEnv('BROWSER', 'firefox');
  mocks.api.runtime.getPlatformInfo.mockResolvedValue({ os: 'android' });
  expect(await coordinator.start(preferences)).toEqual({ ok: true });
  expect(active.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'active', previewAllowed: true, copyAllowed: true, saveAllowed: false }));
  const reply = vi.fn();
  mocks.api.runtime.onMessage.emit({ type: PICKER_SAVE_PERMISSION, token: active.name.slice(PICKER_PORT.length) }, active.sender, reply);
  expect(reply).toHaveBeenCalledWith({ granted: false });
  expect(mocks.api.permissions.request).not.toHaveBeenCalled();
  active.onMessage.emit({ type: 'save' }); await flush();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.capture).not.toHaveBeenCalled();
  active.onMessage.emit({ type: 'capture' });
  for (let i = 0; i < 5; i++) await flush();
  expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ scope: 'selection' }), expect.any(AbortSignal));
});
