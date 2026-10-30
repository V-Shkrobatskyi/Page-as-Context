// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { setImmediate } from 'node:timers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ api: {} as any, capture: vi.fn(), preview: vi.fn(), save: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: mocks.api }));
vi.mock('@/src/page-capture', () => ({ capturePageContext: mocks.capture }));
vi.mock('@/src/preview-session', () => ({ openPreview: mocks.preview, openSelectionSave: mocks.save }));
import { installKeyboardShortcuts } from '@/src/keyboard-shortcuts';

let command: (name: string, tab?: any) => void;
const tab = { id: 42, active: true, url: 'https://example.test/', title: 'Example' };
const journal = { append: vi.fn().mockResolvedValue(undefined) };
const picker = vi.fn();
async function settle() { for (let i = 0; i < 3; i++) await new Promise<void>(resolve => setImmediate(resolve)); }

beforeEach(() => {
  vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new Uint8Array(32).buffer);
  vi.useFakeTimers(); vi.stubEnv('BROWSER', 'chrome');
  mocks.api.commands = { onCommand: { addListener: (fn: typeof command) => { command = fn; } } };
  mocks.api.storage = { managed: { get: vi.fn().mockResolvedValue({}) }, local: { get: vi.fn().mockResolvedValue({}) } };
  mocks.api.tabs = { query: vi.fn().mockResolvedValue([tab]), get: vi.fn().mockResolvedValue(tab) };
  mocks.api.runtime = { getPlatformInfo: vi.fn().mockResolvedValue({ os: 'linux' }), sendMessage: vi.fn() };
  mocks.api.action = { setBadgeText: vi.fn().mockResolvedValue(undefined), setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined), setTitle: vi.fn().mockResolvedValue(undefined) };
  mocks.api.permissions = { request: vi.fn().mockResolvedValue(true) };
  mocks.api.scripting = { executeScript: vi.fn().mockResolvedValue([{ frameId: 0, result: true }]) };
  mocks.capture.mockResolvedValue({ ok: true, operationId: 'operation', export: { serialized: { content: 'Prepared context' }, redactionCount: 0, reductionRatio: 0.5 } });
  mocks.preview.mockResolvedValue(undefined); mocks.save.mockResolvedValue(undefined); picker.mockResolvedValue({ ok: true });
  installKeyboardShortcuts(journal as any, picker);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('browser keyboard commands', () => {
  it.each(['chrome', 'firefox'])('copies with saved preferences and boundaries, then clears feedback in %s', async target => {
    vi.stubEnv('BROWSER', target);
    mocks.api.storage.local.get.mockResolvedValue({ 'popup-settings': { compression: 'maximum', format: 'markdown', redactSensitiveData: false } });
    command('copy-page-context', tab); await settle();
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith({ type: 'capture-active-tab', compression: 'maximum', format: 'markdown', redactSensitiveData: false }, journal, tab);
    expect(mocks.api.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 42, frameIds: [0] }, world: 'ISOLATED', args: [expect.stringContaining('Prepared context'), tab.url] }));
    expect(mocks.api.scripting.executeScript.mock.calls[0][0].args[0]).not.toBe('Prepared context');
    expect(mocks.api.action.setBadgeText).toHaveBeenCalledWith({ tabId: 42, text: '✓' });
    expect(mocks.api.permissions.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8000);
    expect(mocks.api.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 42, text: '' });
  });
  it.each([['preview-context', 'preview'], ['save-context-file', 'save']])('routes %s without copying', async (name, action) => {
    command(name, tab); await settle();
    expect(action === 'preview' ? mocks.preview : mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: 'Prepared context', compression: 'compact', format: 'semantic-text', redactSensitiveData: true }));
    expect(mocks.api.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('starts the picker on the original tab without capturing the page', async () => {
    command('select-element', tab); await settle();
    expect(picker).toHaveBeenCalledExactlyOnceWith({ compression: 'compact', format: 'semantic-text', redactSensitiveData: true }, tab);
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('requests Firefox download permission synchronously and does not capture after denial', async () => {
    vi.stubEnv('BROWSER', 'firefox'); mocks.api.permissions.request.mockResolvedValue(false);
    command('save-context-file', tab);
    expect(mocks.api.permissions.request).toHaveBeenCalledExactlyOnceWith({ permissions: ['downloads'] });
    expect(mocks.capture).not.toHaveBeenCalled(); await settle();
    expect(mocks.capture).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.api.action.setTitle).toHaveBeenCalledWith({ tabId: 42, title: expect.stringContaining('permission was not granted') });
  });
  it('saves in Firefox after permission approval', async () => {
    vi.stubEnv('BROWSER', 'firefox'); command('save-context-file', tab); await settle();
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('queries the active tab when Firefox does not supply a command tab', async () => {
    command('copy-page-context'); await settle();
    expect(mocks.api.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(mocks.capture).toHaveBeenCalledWith(expect.anything(), journal, tab);
  });
  it('ignores unknown commands and repeated keys while an action is pending', async () => {
    command('unknown', tab); await settle(); expect(mocks.capture).not.toHaveBeenCalled();
    let finish!: (value: any) => void;
    mocks.capture.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    command('copy-page-context', tab); await settle(); command('save-context-file', tab); command('copy-page-context', tab); await settle();
    expect(mocks.capture).toHaveBeenCalledOnce();
    finish({ ok: false, error: { message: 'Unable to prepare context.' } }); await settle();
    command('preview-context', tab); await settle(); expect(mocks.preview).toHaveBeenCalledOnce();
  });
  it('blocks managed actions before capture and uses forced preferences', async () => {
    mocks.api.storage.managed.get.mockResolvedValue({ ClipboardExportAllowed: false });
    command('copy-page-context', tab); await settle(); expect(mocks.capture).not.toHaveBeenCalled();
    mocks.api.storage.managed.get.mockResolvedValue({ ForcedExportFormat: 'markdown', ForcedCompression: 'detailed' });
    command('preview-context', tab); await settle();
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({ format: 'markdown', compression: 'detailed' }), journal, tab));
    await settle();
  });
  it('does not capture a tab that navigated or lost activation before capture', async () => {
    mocks.api.tabs.get.mockResolvedValue({ ...tab, url: 'https://other.test/' });
    command('copy-page-context', tab); await settle(); expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('does not copy when the user switches tabs during capture', async () => {
    mocks.api.tabs.get.mockResolvedValueOnce(tab).mockResolvedValueOnce({ ...tab, active: false });
    command('copy-page-context', tab); await settle(); expect(mocks.api.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('reports failed clipboard injection rather than success', async () => {
    mocks.api.scripting.executeScript.mockResolvedValue([{ frameId: 0, result: false }]);
    command('copy-page-context', tab); await settle();
    expect(mocks.api.action.setBadgeText).toHaveBeenCalledExactlyOnceWith({ tabId: 42, text: '!' });
  });
});

it('restores the current MCP toolbar state after temporary shortcut feedback', async () => {
  const restore = vi.fn().mockResolvedValue(undefined);
  installKeyboardShortcuts(journal as any, picker, restore);
  command('copy-page-context', tab); await settle();
  expect(restore).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(8000);
  expect(restore).toHaveBeenCalledOnce();
});
