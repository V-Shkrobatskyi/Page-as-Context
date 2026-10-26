// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/diagnostics/client', () => ({ technicalEvent: vi.fn() }));


import { prepareExport, type CaptureResult, type SemanticTree } from '@/src/core';
const previewMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/src/preview-session', () => ({ openPreview: previewMock }));

import type { CaptureActiveTabRequest } from '@/src/capture-message';

class FakeElement {
  value = '';
  min = '0';
  max = '3';
  disabled = false;
  hidden = false;
  checked = false;
  textContent = '';
  innerHTML = '';
  setAttribute = vi.fn();
  readonly style = { setProperty: vi.fn() };
  private readonly listeners = new Map<string, (event: Event) => void>();

  // noinspection JSUnusedGlobalSymbols
  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, listener);
  }

  change(): void { this.listeners.get('change')?.(new Event('change')); }

  click(): Event {
    const event = new Event('click', { cancelable: true });
    this.listeners.get('click')?.(event);
    return event;
  }
}

interface PopupHarness {
  app: FakeElement;
  compression: FakeElement;
  format: FakeElement;
  markdown: FakeElement;
  redactSensitiveData: FakeElement;
  saveSettings: FakeElement;
  optionsSummary: FakeElement;
  otherSiteFrames: FakeElement;
  copy: FakeElement;
  save: FakeElement;
  saveLabel: FakeElement;
  preview: FakeElement;
  selectElement: FakeElement;
  customize: FakeElement;
  guideLink: FakeElement;
  diagnosticsLink: FakeElement;
  licenseLink: FakeElement;
  shortcutsLink: FakeElement;
  status: FakeElement;
  metrics: FakeElement;
  feedback: FakeElement;
  clipboardWrite: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  downloadSearch: ReturnType<typeof vi.fn>;
  downloadChanged: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
  storageSet: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  createTab: ReturnType<typeof vi.fn>;
  managedGet: ReturnType<typeof vi.fn>;
  changePolicy(): void;
}

const SECRET = 'synthetic-popup-password-value';

function successfulCapture(): CaptureResult {
  const tree: SemanticTree = {
    schemaVersion: 1,
    root: {
      role: 'page',
      children: [{ role: 'textbox', name: 'Password', value: SECRET, children: [] }],
    },
  };
  return { ok: true, tree };
}

async function loadPopup(response: CaptureResult | unknown, options?: {
  managedPolicy?: Record<string, unknown>;
  managedError?: boolean;
  clipboardError?: boolean;
  downloadError?: boolean;
  storedSettings?: unknown;
  firefox?: boolean;
  downloadsUnavailable?: boolean;
  android?: boolean;
  permissionDenied?: boolean;
  siteAccessGranted?: boolean;
  platformError?: boolean;
}): Promise<PopupHarness> {
  const app = new FakeElement();
  const compression = new FakeElement();
  const format = new FakeElement();
  const copy = new FakeElement();
  const save = new FakeElement();
  const saveLabel = new FakeElement();
  const preview = new FakeElement();
  const selectElement = new FakeElement();
  const customize = new FakeElement();
  const status = new FakeElement();
  const metrics = new FakeElement();
  const semanticTextFormat = format;
  const markdownFormat = new FakeElement();
  const feedback = new FakeElement();
  const guideLink = new FakeElement();
  const diagnosticsLink = new FakeElement();
  const licenseLink = new FakeElement();
  const shortcutsLink = new FakeElement();
  const redactSensitiveData = new FakeElement();
  const saveSettings = new FakeElement();
  const optionsSummary = new FakeElement();
  const otherSiteFrames = new FakeElement();
  compression.value = '2';
  semanticTextFormat.value = 'semantic-text';
  semanticTextFormat.checked = true;
  markdownFormat.value = 'markdown';
  redactSensitiveData.checked = true;
  const elements = new Map<string, FakeElement>([
    ['#shortcuts-link', shortcutsLink], ['#app', app], ['#compression', compression], ['#format', format],
    ['#format-semantic-text', semanticTextFormat], ['#format-markdown', markdownFormat],
    ['#customize', customize], ['#preview', preview], ['#select-element', selectElement], ['.primary-action', copy], ['.secondary-action', save], ['.status', status], ['.metrics', metrics],
    ['#save-label', saveLabel], ['.feedback', feedback], ['#guide-link', guideLink], ['#diagnostics-link', diagnosticsLink], ['#license-link', licenseLink],
    ['#redact-sensitive-data', redactSensitiveData], ['#save-settings', saveSettings], ['#options-summary', optionsSummary],
    ['#include-other-site-frames', otherSiteFrames],
  ]);
  const clipboardWrite = vi.fn().mockImplementation(async () => {
    if (options?.clipboardError) throw new Error('clipboard denied');
  });
  const download = vi.fn().mockImplementation(async () => {
    if (options?.downloadError) throw new Error('download denied');
    return 1;
  });
  const downloadSearch = vi.fn().mockResolvedValue([{ id: 1, state: 'complete' }]);
  const downloadChanged = { addListener: vi.fn(), removeListener: vi.fn() };
  const storageSet = vi.fn().mockResolvedValue(undefined);
  const sendMessage = vi.fn().mockImplementation(async (request: CaptureActiveTabRequest) => {
    if (request.type === 'save-firefox-export' as string) return { accepted: true };
    if (typeof response === 'object' && response !== null && 'ok' in response && response.ok === true && 'tree' in response) {
      return { ok: true, export: prepareExport(response.tree as SemanticTree, request.compression, request.format, request.redactSensitiveData) };
    }
    return response;
  });

  const requestPermission = vi.fn().mockResolvedValue(!options?.permissionDenied);
  vi.stubEnv('BROWSER', options?.firefox ? 'firefox' : 'chrome');
  vi.stubGlobal('document', {
    body: { dataset: {} },
    querySelector: <T extends Element>(selector: string): T | null =>
      (elements.get(selector) as unknown as T | undefined) ?? null,
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn() });
  vi.stubGlobal('navigator', { clipboard: { writeText: clipboardWrite }, userAgent: options?.android ? 'Firefox Android' : 'Firefox Desktop' });
  const managedGet = options?.managedError ? vi.fn().mockRejectedValue(new Error('Private policy error')) : vi.fn().mockResolvedValue(options?.managedPolicy ?? {});
  const policyListeners = new Set<(...args: any[]) => void>();
  const extensionApi = {
    commands: {},
    tabs: { create: vi.fn().mockResolvedValue({ id: 2 }), remove: vi.fn().mockResolvedValue(undefined) },
    runtime: {
      sendMessage,
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    downloads: options?.downloadsUnavailable ? undefined : {
      download, search: downloadSearch, onChanged: downloadChanged, onErased: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      managed: { get: managedGet },
      onChanged: { addListener: (fn: (...args: any[]) => void) => policyListeners.add(fn), removeListener: (fn: (...args: any[]) => void) => policyListeners.delete(fn) },
      local: {
        get: vi.fn().mockResolvedValue({ 'popup-settings': options?.storedSettings }),
        set: storageSet,
      },
    },
  };
  vi.stubGlobal('chrome', extensionApi);
  const firefoxApi = {
      ...extensionApi,
      permissions: { request: requestPermission, contains: vi.fn().mockResolvedValue(options?.siteAccessGranted ?? false),
        getAll: vi.fn().mockResolvedValue({ origins: [] }), remove: vi.fn().mockResolvedValue(true),
        onAdded: { addListener: vi.fn(), removeListener: vi.fn() }, onRemoved: { addListener: vi.fn(), removeListener: vi.fn() } },
      runtime: {
        id: 'synthetic-firefox-id',
        getPlatformInfo: options?.platformError
          ? vi.fn().mockRejectedValue(new Error('platform unavailable'))
          : vi.fn().mockResolvedValue({ os: options?.android ? 'android' : 'linux' }),
        sendMessage,
        getURL: (path: string) => `moz-extension://test/${path}`,
      },
  };
  vi.doMock('wxt/browser', () => ({ browser: options?.firefox ? firefoxApi : extensionApi }));
  if (options?.firefox) {
    vi.stubGlobal('browser', firefoxApi);
    vi.stubGlobal('chrome', undefined);
  }
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:popup-test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  await import('@/entrypoints/popup/main');
  await settle();
  return {
    app, compression, format, markdown: markdownFormat, redactSensitiveData, saveSettings, optionsSummary, otherSiteFrames,
    copy, save, saveLabel, preview, selectElement, customize, guideLink, diagnosticsLink, licenseLink, shortcutsLink, status, metrics, feedback, clipboardWrite, download, downloadSearch, downloadChanged, storageSet, sendMessage, requestPermission, createTab: extensionApi.tabs.create, managedGet, changePolicy: () => { for (const fn of policyListeners) fn({}, 'managed'); },
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  previewMock.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('popup export flow', () => {
  it('uses the native Firefox shortcut manager when available', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true });
    const { browser } = await import('wxt/browser');
    const openShortcutSettings = vi.fn().mockResolvedValue(undefined);
    Object.assign(browser.commands, { openShortcutSettings });
    popup.shortcutsLink.click(); await settle();
    expect(openShortcutSettings).toHaveBeenCalledOnce();
    expect(popup.createTab).not.toHaveBeenCalled();
    expect(window.close).toHaveBeenCalledOnce();
  });
  it('keeps the popup open with instructions when shortcut settings fail to open', async () => {
    const popup = await loadPopup(successfulCapture());
    popup.createTab.mockRejectedValueOnce(new Error('Synthetic failure'));
    popup.shortcutsLink.click(); await settle();
    expect(window.close).not.toHaveBeenCalled();
    expect(popup.status.textContent).toContain('chrome://extensions/shortcuts');
  });

  it.each([{ firefox: false }, { firefox: true }])('opens the browser shortcut settings without exporting: %j', async options => {
    const popup = await loadPopup(successfulCapture(), options);
    const event = popup.shortcutsLink.click(); await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(popup.createTab).toHaveBeenCalledWith({ url: options.firefox ? 'about:addons' : 'chrome://extensions/shortcuts', active: true });
    expect(window.close).toHaveBeenCalledOnce();
    expect(popup.sendMessage).not.toHaveBeenCalled();
    expect(popup.clipboardWrite).not.toHaveBeenCalled();
  });

  for (const [link, path] of [['guideLink', '/guide.html'], ['diagnosticsLink', '/data-controls.html'], ['licenseLink', '/license.html']] as const) {
    it.each([{ firefox: false }, { firefox: true }, { firefox: true, android: true }])(`opens ${path} once and closes only after the tab opens: %j`, async options => {
      const popup = await loadPopup(successfulCapture(), options);
      let opened!: (value: { id: number }) => void;
      popup.createTab.mockReturnValueOnce(new Promise(resolve => { opened = resolve; }));
      const event = popup[link].click();
      expect(event.defaultPrevented).toBe(true);
      expect(popup.createTab).toHaveBeenCalledExactlyOnceWith({ url: expect.stringContaining(path), active: true });
      expect(window.close).not.toHaveBeenCalled();
      opened({ id: 5 }); await settle();
      expect(window.close).toHaveBeenCalledOnce();
      expect(popup.sendMessage).not.toHaveBeenCalled();
      expect(popup.storageSet).not.toHaveBeenCalled();
    });

    it(`keeps Firefox popup open if ${path} cannot be opened`, async () => {
      const popup = await loadPopup(successfulCapture(), { firefox: true });
      popup.createTab.mockRejectedValueOnce(new Error('Synthetic tab failure'));
      popup[link].click(); await settle();
      expect(window.close).not.toHaveBeenCalled();
      expect(popup.status.textContent).toBe('Unable to open this page. Try again.');
    });
  }

  it('starts the picker with current preferences and closes only after readiness', async () => {
    const popup = await loadPopup({ ok: true });
    popup.markdown.checked = true; popup.compression.value = '1';
    let finish!: (value: unknown) => void;
    popup.sendMessage.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    popup.selectElement.click();
    await settle();
    expect(popup.sendMessage).toHaveBeenCalledWith({ type: 'element-picker-start-v1', compression: 'detailed', format: 'markdown', redactSensitiveData: true });
    expect(popup.selectElement.disabled).toBe(true);
    expect(window.close).not.toHaveBeenCalled();
    finish({ ok: true }); await settle();
    expect(window.close).toHaveBeenCalledOnce();
    expect(popup.clipboardWrite).not.toHaveBeenCalled(); expect(popup.download).not.toHaveBeenCalled();
  });

  it('keeps the popup usable after picker failure', async () => {
    const popup = await loadPopup({ ok: false, error: { message: 'Synthetic picker failure' } });
    popup.selectElement.click(); await settle();
    expect(popup.status.textContent).toBe('Synthetic picker failure'); expect(popup.copy.disabled).toBe(false);
    expect(window.close).not.toHaveBeenCalled();
  });

  it('hides the picker action on Android', async () => {
    const android = await loadPopup({ ok: true }, { firefox: true, android: true });
    expect(android.selectElement.hidden).toBe(true);
  });
  it.each([{ firefox: false }, { firefox: true }, { firefox: true, android: true }])('opens Customize and dismisses the popup without changing privacy preferences: %j', async options => {
    const popup = await loadPopup(successfulCapture(), options);
    popup.customize.click(); await settle();
    expect(popup.createTab).toHaveBeenCalledExactlyOnceWith({ url: expect.stringContaining('/filters.html'), active: true });
    expect(window.close).toHaveBeenCalledOnce();
    expect(popup.sendMessage).not.toHaveBeenCalled();
    expect(popup.storageSet).not.toHaveBeenCalled();
    expect(popup.clipboardWrite).not.toHaveBeenCalled();
    expect(popup.app.innerHTML).toContain('Filters');
    expect(popup.app.innerHTML).toContain('aria-label="Preview and edit context"');
  });

  it('waits until the settings tab opens before dismissing the Android popup', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true, android: true });
    let openTab!: (tab: { id: number }) => void;
    popup.createTab.mockReturnValueOnce(new Promise(resolve => { openTab = resolve; }));
    popup.customize.click(); await settle();
    expect(window.close).not.toHaveBeenCalled();
    openTab({ id: 2 }); await settle();
    expect(window.close).toHaveBeenCalledOnce();
  });

  it('keeps the Android popup open and shows an error if Customize cannot open', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true, android: true });
    popup.createTab.mockRejectedValueOnce(new Error('tab unavailable'));
    popup.customize.click(); await settle();
    expect(window.close).not.toHaveBeenCalled();
    expect(popup.status.textContent).toContain('Unable to open filter settings. Try again.');
  });

  it.each([{ firefox: false }, { firefox: true }, { firefox: true, android: true }])('opens Preview without copying, downloading or requesting permissions: %j', async options => {
    const popup = await loadPopup(successfulCapture(), options);
    popup.markdown.checked = true;
    popup.compression.value = '3';
    popup.preview.click();
    popup.copy.click(); popup.save.click(); popup.preview.click();
    expect(popup.copy.disabled).toBe(true);
    expect(popup.preview.disabled).toBe(true);
    await settle();
    expect(popup.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'capture-active-tab', compression: 'maximum', format: 'markdown', redactSensitiveData: true });
    expect(previewMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      content: expect.stringContaining('[REDACTED]'), compression: 'maximum', format: 'markdown',
      redactSensitiveData: true, redactionCount: 1, reductionRatio: expect.any(Number), warnings: [],
    }));
    expect(previewMock.mock.calls[0]![0].content).not.toContain(SECRET);
    expect(window.close).toHaveBeenCalledOnce();
    expect(popup.clipboardWrite).not.toHaveBeenCalled();
    expect(popup.download).not.toHaveBeenCalled();
    expect(popup.requestPermission).not.toHaveBeenCalled();
    expect(popup.preview.disabled).toBe(false);
  });

  it('keeps the Android popup open until Preview receives its content and becomes active', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true, android: true });
    let ready!: () => void;
    previewMock.mockReturnValueOnce(new Promise<void>(resolve => { ready = resolve; }));
    popup.preview.click(); await settle();
    expect(previewMock).toHaveBeenCalledOnce();
    expect(window.close).not.toHaveBeenCalled();
    expect(popup.preview.disabled).toBe(true);
    ready(); await settle();
    expect(window.close).toHaveBeenCalledOnce();
  });

  it('handles a failed preview transfer and allows another attempt', async () => {
    const popup = await loadPopup(successfulCapture());
    previewMock.mockRejectedValueOnce(new Error('synthetic private details'));
    popup.preview.click(); await settle();
    expect(popup.status.textContent).toContain('Unable to open the preview');
    expect(window.close).not.toHaveBeenCalled();
    expect(popup.status.textContent).not.toContain('synthetic private details');
    expect(popup.preview.disabled).toBe(false);
    popup.preview.click(); await settle();
    expect(popup.status.textContent).toContain('Preview opened');
  });

  it('exposes broad frame access only in Firefox and does not export when permission is denied', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true, permissionDenied: true });
    expect(popup.app.innerHTML).toContain('Include frames from other sites');
    expect(popup.app.innerHTML).not.toContain('Embedded site access');
    popup.otherSiteFrames.checked = true; popup.otherSiteFrames.change();
    expect(popup.requestPermission).toHaveBeenCalledExactlyOnceWith({ origins: ['http://*/*', 'https://*/*'] });
    expect(popup.copy.disabled).toBe(true);
    await settle();
    expect(popup.otherSiteFrames.checked).toBe(false); expect(popup.copy.disabled).toBe(false);
    expect(popup.sendMessage).not.toHaveBeenCalled(); expect(popup.clipboardWrite).not.toHaveBeenCalled();
  });
  it('omits the Firefox frame access checkbox from Chrome', async () => {
    const popup = await loadPopup(successfulCapture());
    expect(popup.app.innerHTML).not.toContain('Include frames from other sites');
  });

  it('shows validated scope warnings after a successful export and blocks concurrent actions', async () => {
    const result = successfulCapture();
    if (!result.ok) throw new Error('Expected fixture');
    const popup = await loadPopup(result);
    let finish!: (value: unknown) => void;
    popup.sendMessage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    popup.copy.click(); popup.copy.click(); popup.save.click();
    await settle();
    expect(popup.sendMessage.mock.calls.filter(([m]) => m.type === 'capture-active-tab')).toHaveLength(1);
    finish({ ok: true, export: prepareExport(result.tree, 'compact', 'semantic-text'), warnings: ['embedded-frames', 'canvas-content'] });
    await settle();
    expect(popup.clipboardWrite).toHaveBeenCalledOnce();
    expect(popup.download).not.toHaveBeenCalled();
    expect(popup.metrics.textContent).toContain('Embedded frames are not included.');
    expect(popup.metrics.textContent).toContain('Canvas content is not included.');
    expect(popup.copy.disabled).toBe(false);
  });

  it('describes Chrome partial iframe capture without the Firefox omission warning', async () => {
    const result = successfulCapture();
    if (!result.ok) throw new Error('Expected fixture');
    const popup = await loadPopup({ ok: true, export: prepareExport(result.tree, 'compact', 'semantic-text'), warnings: ['embedded-frames-partial'] });
    popup.copy.click(); await settle();
    expect(popup.clipboardWrite).toHaveBeenCalledOnce();
    expect(popup.metrics.textContent).toContain('Some embedded documents could not be captured.');
    expect(popup.metrics.textContent).not.toContain('Embedded frames are not included.');
  });
  it.each([false, true])('shows a short Firefox frame warning with site access %s', async (siteAccessGranted) => {
    const result = successfulCapture();
    if (!result.ok) throw new Error('Expected fixture');
    const popup = await loadPopup({ ok: true, export: prepareExport(result.tree, 'compact', 'semantic-text'), warnings: ['embedded-frames-partial', 'canvas-content'] }, { firefox: true, siteAccessGranted });
    popup.copy.click();
    await settle();
    expect(popup.metrics.textContent).toContain('Canvas content is not included.');
    expect(popup.otherSiteFrames.setAttribute).toHaveBeenLastCalledWith('data-capture-hint', String(!siteAccessGranted));
    if (siteAccessGranted) {
      expect(popup.metrics.textContent).toContain('Some embedded documents could not be captured.');
      expect(popup.metrics.textContent).not.toContain('Enable other-site frames');
    } else {
      expect(popup.metrics.textContent).toContain('Some frames skipped. Enable other-site frames and capture again.');
      popup.compression.value = '3';
      popup.compression.change();
      expect(popup.otherSiteFrames.setAttribute).toHaveBeenLastCalledWith('data-capture-hint', 'false');
    }
    expect(popup.requestPermission).not.toHaveBeenCalled();
  });

  it('rejects an unknown warning rather than displaying arbitrary content', async () => {
    const result = successfulCapture();
    if (!result.ok) throw new Error('Expected fixture');
    const popup = await loadPopup({ ok: true, export: prepareExport(result.tree, 'compact', 'semantic-text'), warnings: ['synthetic-private-detail'] });
    popup.copy.click(); await settle();
    expect(popup.clipboardWrite).not.toHaveBeenCalled();
    expect(popup.status.textContent).not.toContain('synthetic-private-detail');
  });
  it('uses native Firefox APIs for preferences and reports unfinished capture without exporting', async () => {
    const popup = await loadPopup({
      ok: false,
      error: { code: 'capture-unavailable', message: 'synthetic private details' },
    }, { firefox: true });
    await settle();
    popup.redactSensitiveData.checked = false;
    popup.redactSensitiveData.change();
    popup.saveSettings.click();
    await settle();
    expect(popup.storageSet).toHaveBeenCalledOnce();
    for (const action of [popup.copy, popup.save]) {
      action.click();
      await settle();
      expect(popup.status.textContent).toBe('Page capture is not available in this build yet.');
      expect(action.disabled).toBe(false);
    }
    expect(popup.clipboardWrite).not.toHaveBeenCalled();
    expect(popup.download).not.toHaveBeenCalled();
  });
  it.each(['semantic-text', 'markdown'] as const)('wraps Copy and preserves Save across all profiles and privacy settings in %s', async (format) => {
    const capture = successfulCapture();
    if (!capture.ok) throw new Error('Expected successful fixture');
    for (const [index, compression] of (['without', 'detailed', 'compact', 'maximum'] as const).entries()) {
      for (const privacy of [true, false]) {
        vi.resetModules();
        const popup = await loadPopup(capture);
        await settle();
        popup.compression.value = String(index);
        popup.markdown.checked = format === 'markdown';
        popup.redactSensitiveData.checked = privacy;
        const result = prepareExport(capture.tree, compression, format, privacy);
        const opening = compression === 'maximum' ? '**' : '<web_page>';
        const closing = compression === 'maximum' ? '**' : '</web_page>';
        const expected = `${opening}\n${result.serialized.content}${closing}\n`;

        popup.copy.click();
        await settle();
        expect(popup.clipboardWrite).toHaveBeenCalledExactlyOnceWith(expected);
        expect(popup.metrics.textContent).toContain(`${expected.length} characters copied`);
        expect(popup.metrics.textContent).toContain(`~${Math.ceil(expected.length / 4)} tokens`);
        expect(popup.metrics.textContent).toContain(`context ${Math.round(result.reductionRatio! * 100)}% smaller than Without`);
        expect(popup.download).not.toHaveBeenCalled();

        popup.save.click();
        await settle();
        const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0] as Blob;
        expect(await blob.text()).toBe(result.serialized.content);
        expect(popup.status.textContent).toBe(`Saved ${format === 'markdown' ? 'Markdown' : 'Semantic Text'} file.`);
        expect(popup.metrics.textContent).toContain(`${result.characterCount} characters ·`);
        expect(popup.clipboardWrite).toHaveBeenCalledOnce();
      }
    }
  });

  it('renders Compact Semantic Text defaults and accessible export controls', async () => {
    const popup = await loadPopup(successfulCapture());

    expect(popup.compression.value).toBe('2');
    expect(popup.format.value).toBe('semantic-text');
    expect(popup.app.innerHTML).toContain('type="range"');
    expect(popup.app.innerHTML).toContain('Without');
    expect(popup.app.innerHTML).toContain('type="radio"');
    expect(popup.app.innerHTML).toContain('Redact sensitive data');
    expect(popup.app.innerHTML).toContain('Remember settings');
    expect(popup.app.innerHTML).toContain('Copy context');
    expect(popup.app.innerHTML).toContain('Save to file');
  });

  it('copies only redacted content and never places page content in popup UI', async () => {
    const popup = await loadPopup(successfulCapture());

    popup.copy.click();
    expect(popup.copy.disabled).toBe(true);
    expect(popup.save.disabled).toBe(true);
    await settle();

    expect(popup.sendMessage).toHaveBeenCalledWith({ type: 'capture-active-tab', compression: 'compact', format: 'semantic-text', redactSensitiveData: true });
    expect(popup.clipboardWrite).toHaveBeenCalledOnce();
    const copied = popup.clipboardWrite.mock.calls[0]?.[0] as string;
    expect(copied).toContain('[REDACTED]');
    expect(copied).not.toContain(SECRET);
    expect(popup.status.textContent).toBe('Copied Semantic Text.');
    expect(popup.metrics.textContent).toContain('1 redaction');
    expect(`${popup.app.innerHTML}${popup.status.textContent}${popup.metrics.textContent}`).not.toContain(SECRET);
    expect(popup.copy.disabled).toBe(false);
    expect(popup.save.disabled).toBe(false);
  });

  it('recovers from capture and clipboard failures without exposing error details', async () => {
    const captureFailure: CaptureResult = {
      ok: false,
      error: { code: 'unsupported-page', message: 'synthetic internal page details' },
    };
    const capturePopup = await loadPopup(captureFailure);
    capturePopup.copy.click();
    await settle();
    expect(capturePopup.status.textContent).toContain('cannot be captured');
    expect(capturePopup.status.textContent).not.toContain('synthetic internal page details');
    expect(capturePopup.copy.disabled).toBe(false);

    vi.resetModules();
    const clipboardPopup = await loadPopup(successfulCapture(), { clipboardError: true });
    clipboardPopup.copy.click();
    await settle();
    expect(clipboardPopup.status.textContent).toContain('Unable to copy');
    expect(clipboardPopup.copy.disabled).toBe(false);
  });

  it('recovers from download initiation failures and releases the unused Blob URL', async () => {
    const popup = await loadPopup(successfulCapture(), { downloadError: true });
    popup.markdown.checked = true;

    popup.save.click();
    expect(popup.save.disabled).toBe(true);
    await settle();

    expect(popup.download).toHaveBeenCalledOnce();
    expect(popup.download.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      filename: expect.stringMatching(/^\d{4}\.\d{2}\.\d{2}_\d{6}\.md$/u),
      saveAs: true,
    }));
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    const content = await blob.text();
    expect(content).toContain('[REDACTED]');
    expect(content).not.toContain(SECRET);
    expect(popup.status.textContent).toContain('Unable to save');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:popup-test');
    expect(popup.copy.disabled).toBe(false);
    expect(popup.save.disabled).toBe(false);
  });

  it('hands Firefox Save to a separate document without creating a popup Blob', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true });
    popup.save.click();
    await settle();
    expect(popup.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'save-firefox-export', format: 'semantic-text', content: expect.stringContaining('[REDACTED]') }));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(popup.download).not.toHaveBeenCalled();
    expect(popup.status.textContent).toContain('Saving file in a separate tab');
  });

  it('keeps Save unavailable after Copy when the browser has no downloads API', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true, android: true, downloadsUnavailable: true });
    expect(popup.save.disabled).toBe(true);
    expect(popup.saveLabel.textContent).toBe('Save unavailable');
    popup.copy.click();
    await settle();
    expect(popup.clipboardWrite).toHaveBeenCalledOnce();
    expect(popup.save.disabled).toBe(true);
    popup.save.click();
    await settle();
    expect(popup.sendMessage.mock.calls.filter(([m]) => m.type === 'capture-active-tab')).toHaveLength(1);
    expect(popup.download).not.toHaveBeenCalled();
    expect(popup.status.textContent).toContain('Saving files is unavailable');
  });

  it('requests Firefox download permission from Save before capturing the page', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true });
    expect(popup.requestPermission).not.toHaveBeenCalled();
    popup.copy.click();
    await settle();
    expect(popup.requestPermission).not.toHaveBeenCalled();
    popup.sendMessage.mockClear();
    popup.save.click();
    expect(popup.requestPermission).toHaveBeenCalledWith({ permissions: ['downloads'] });
    expect(popup.sendMessage).not.toHaveBeenCalled();
    await settle();
    expect(popup.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'save-firefox-export' }));
    expect(popup.status.textContent).toContain('Saving');
  });

  it('keeps Copy usable when Firefox download permission is denied', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true, permissionDenied: true });
    popup.save.click();
    await settle();
    expect(popup.sendMessage).not.toHaveBeenCalled();
    expect(popup.download).not.toHaveBeenCalled();
    expect(popup.status.textContent).toContain('permission was not granted');
    expect(popup.save.disabled).toBe(false);
    popup.copy.click();
    await settle();
    expect(popup.clipboardWrite).toHaveBeenCalledOnce();
    popup.requestPermission.mockResolvedValue(true);
    popup.save.click();
    await settle();
    expect(popup.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'save-firefox-export' }));
    expect(popup.status.textContent).toContain('Saving');
  });

  it('blocks Save on Android even if a downloads API stub is exposed', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true, android: true });
    expect(document.body.dataset.platform).toBe('android');
    expect(popup.save.disabled).toBe(true);
    popup.save.click();
    await settle();
    expect(popup.requestPermission).not.toHaveBeenCalled();
    expect(popup.sendMessage).not.toHaveBeenCalled();
    expect(popup.download).not.toHaveBeenCalled();
    popup.copy.click();
    await settle();
    expect(popup.clipboardWrite).toHaveBeenCalledOnce();
    expect(popup.save.disabled).toBe(true);
  });

  it('keeps Copy usable when Firefox platform detection fails', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true, platformError: true });
    expect(popup.save.disabled).toBe(true);
    popup.copy.click();
    await settle();
    expect(popup.clipboardWrite).toHaveBeenCalledOnce();
    expect(popup.requestPermission).not.toHaveBeenCalled();
  });

  it.each(['compression', 'markdown', 'redactSensitiveData'] as const)('clears the previous capture result when %s changes', async (control) => {
    const popup = await loadPopup(successfulCapture(), { firefox: true });
    popup.copy.click();
    await settle();
    expect(popup.feedback.hidden).toBe(false);
    expect(popup.metrics.textContent).toContain('characters copied');

    if (control === 'compression') popup.compression.value = '3';
    else popup[control].checked = !popup[control].checked;
    popup[control].change();

    expect(popup.feedback.hidden).toBe(true);
    expect(popup.status.textContent).toBe('');
    expect(popup.metrics.textContent).toBe('');
    expect(popup.saveSettings.hidden).toBe(false);
    expect(popup.clipboardWrite).toHaveBeenCalledOnce();
  });

  it('clears capture metrics when a new settings message is shown', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true });
    popup.compression.value = '3';
    popup.compression.change();
    popup.copy.click();
    await settle();
    expect(popup.metrics.textContent).toContain('characters copied');
    popup.saveSettings.click();
    await settle();
    expect(popup.feedback.hidden).toBe(false);
    expect(popup.status.textContent).toBe('Settings saved for future popup openings.');
    expect(popup.metrics.textContent).toBe('');
  });

  it('enables Remember settings only for changes and disables it after saving or reverting', async () => {
    const popup = await loadPopup(successfulCapture());
    expect(popup.saveSettings.disabled).toBe(true);
    expect(popup.saveSettings.hidden).toBe(true);
    popup.saveSettings.click();
    await settle();
    expect(popup.storageSet).not.toHaveBeenCalled();

    popup.compression.value = '3';
    popup.compression.change();
    expect(popup.saveSettings.disabled).toBe(false);
    expect(popup.saveSettings.hidden).toBe(false);
    popup.compression.value = '2';
    popup.compression.change();
    expect(popup.saveSettings.disabled).toBe(true);
    expect(popup.saveSettings.hidden).toBe(true);

    popup.redactSensitiveData.checked = false;
    popup.redactSensitiveData.change();
    expect(popup.saveSettings.disabled).toBe(false);
    popup.storageSet.mockRejectedValueOnce(new Error('storage unavailable'));
    popup.saveSettings.click();
    expect(popup.saveSettings.disabled).toBe(true);
    await settle();
    expect(popup.saveSettings.disabled).toBe(false);
    expect(popup.status.textContent).toContain('Unable to save');
    expect(popup.saveSettings.hidden).toBe(false);
    popup.saveSettings.click();
    await settle();
    expect(popup.saveSettings.disabled).toBe(true);
    expect(popup.saveSettings.hidden).toBe(true);
  });

  it('compares changes with saved preferences under the current organization policy', async () => {
    const popup = await loadPopup(successfulCapture(), {
      storedSettings: { compression: 'maximum', format: 'markdown', redactSensitiveData: false },
      managedPolicy: { ForcedCompression: 'compact', RedactionMode: 'force-on' },
    });
    await vi.waitFor(() => {
      expect(popup.compression.value).toBe('2');
      expect(popup.markdown.checked).toBe(true);
      expect(popup.redactSensitiveData.checked).toBe(true);
    });
    expect(popup.saveSettings.disabled).toBe(true);
    popup.markdown.checked = false;
    popup.format.checked = true;
    popup.format.change();
    expect(popup.saveSettings.disabled).toBe(false);
    popup.markdown.checked = true;
    popup.format.change();
    expect(popup.saveSettings.disabled).toBe(true);
  });

  it.each([false, true])('shows Firefox iframe access in Options and refreshes after permission changes: %s', async granted => {
    const popup = await loadPopup(successfulCapture(), { firefox: true, siteAccessGranted: granted });
    expect(popup.optionsSummary.textContent).toBe(`Semantic Text · Redaction on · iframes ${granted ? 'on' : 'off'}`);
    const { browser } = await import('wxt/browser');
    vi.mocked(browser.permissions.contains).mockImplementation(async () => !granted);
    const changed = vi.mocked(browser.permissions.onRemoved.addListener).mock.calls[0]![0];
    changed({ origins: ['<all_urls>'] });
    await settle();
    expect(popup.optionsSummary.textContent).toBe(`Semantic Text · Redaction on · iframes ${granted ? 'off' : 'on'}`);
    expect(popup.storageSet).not.toHaveBeenCalled();
  });

  it('keeps the Firefox iframe summary off after site access is denied', async () => {
    const popup = await loadPopup(successfulCapture(), { firefox: true, permissionDenied: true });
    popup.otherSiteFrames.checked = true;
    popup.otherSiteFrames.change();
    await settle();
    expect(popup.otherSiteFrames.checked).toBe(false);
    expect(popup.optionsSummary.textContent).toBe('Semantic Text · Redaction on · iframes off');
  });

  it('updates the Options summary for temporary choices without saving them', async () => {
    const popup = await loadPopup(successfulCapture());
    expect(popup.optionsSummary.textContent).toBe('Semantic Text · Redaction on');
    popup.markdown.checked = true;
    popup.markdown.change();
    popup.redactSensitiveData.checked = false;
    popup.redactSensitiveData.change();
    expect(popup.optionsSummary.textContent).toBe('Markdown · Redaction off');
    expect(popup.saveSettings.hidden).toBe(false);
    popup.copy.click();
    await settle();
    expect(popup.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ format: 'markdown', redactSensitiveData: false }));
    expect(popup.storageSet).not.toHaveBeenCalled();
    expect(popup.optionsSummary.textContent).toBe('Markdown · Redaction off');
    expect(popup.saveSettings.hidden).toBe(false);
  });

  it('persists settings and allows an explicitly unredacted export', async () => {
    const popup = await loadPopup(successfulCapture());
    popup.markdown.checked = true;
    popup.redactSensitiveData.checked = false;
    popup.saveSettings.click();
    await settle();

    expect(popup.storageSet).toHaveBeenCalledWith({
      'popup-settings': { compression: 'compact', format: 'markdown', redactSensitiveData: false },
    });
    expect(popup.status.textContent).toContain('Settings saved');

    popup.copy.click();
    await settle();
    expect(popup.clipboardWrite).toHaveBeenCalledWith(expect.stringContaining(SECRET));
    expect(popup.metrics.textContent).toContain('0 redactions');
  });

  it('restores previously saved settings when the popup opens', async () => {
    const popup = await loadPopup(successfulCapture(), {
      storedSettings: { compression: 'maximum', format: 'markdown', redactSensitiveData: false },
    });
    await settle();

    expect(popup.compression.value).toBe('3');
    expect(popup.markdown.checked).toBe(true);
    expect(popup.redactSensitiveData.checked).toBe(false);
  });

  it('rejects malformed prepared exports without copying content', async () => {
    const popup = await loadPopup({ ok: true, export: { serialized: { content: 'invalid' } } });
    popup.copy.click();
    await settle();
    expect(popup.clipboardWrite).not.toHaveBeenCalled();
    expect(popup.status.textContent).toContain('Unable to capture');
    expect(popup.copy.disabled).toBe(false);
  });

});


describe('managed popup', () => {
  it('shows forced values, blocks restricted actions, and cannot save managed preferences', async () => {
    const popup = await loadPopup(successfulCapture(), { managedPolicy: { ForcedCompression: 'maximum', ForcedExportFormat: 'markdown', RedactionMode: 'force-on', FileExportAllowed: false, ElementPickerAllowed: false, UserPreferencesSaveAllowed: false } });
    await vi.waitFor(() => expect(popup.compression.value).toBe('3'));
    expect(popup.compression.disabled).toBe(true); expect(popup.markdown.checked).toBe(true);
    expect(popup.redactSensitiveData.checked).toBe(true); expect(popup.redactSensitiveData.disabled).toBe(true);
    expect(popup.save.disabled).toBe(true); expect(popup.selectElement.disabled).toBe(true); expect(popup.copy.disabled).toBe(false);
    popup.saveSettings.click(); popup.save.click(); popup.selectElement.click(); await settle();
    expect(popup.storageSet).not.toHaveBeenCalled(); expect(popup.download).not.toHaveBeenCalled(); expect(popup.sendMessage).not.toHaveBeenCalled();
    const { readPolicy } = await import('@/src/policy/runtime');
    const snapshot = await readPolicy();
    const captured = successfulCapture(); if (!captured.ok) throw new Error('Synthetic capture failed');
    popup.sendMessage.mockResolvedValueOnce({ ok: true, policyRevision: snapshot.revision, export: prepareExport(captured.tree, 'maximum', 'markdown', true) });
    popup.copy.click(); await vi.waitFor(() => expect(popup.clipboardWrite).toHaveBeenCalledOnce());
  });
  it('uses corporate defaults only in the absence of a permitted personal choice', async () => {
    const popup = await loadPopup(successfulCapture(), { managedPolicy: { DefaultCompression: 'maximum', DefaultExportFormat: 'markdown' } });
    await vi.waitFor(() => expect(popup.compression.value).toBe('3'));
    expect(popup.markdown.checked).toBe(true); expect(popup.compression.disabled).toBe(false);
  });
  it('preserves a permitted saved choice over corporate defaults', async () => {
    const popup = await loadPopup(successfulCapture(), { managedPolicy: { DefaultCompression: 'maximum' }, storedSettings: { compression: 'detailed' } });
    await vi.waitFor(() => expect(popup.copy.disabled).toBe(false)); expect(popup.compression.value).toBe('1');
  });
  it('blocks all export on policy read failure and recovers after a successful refresh', async () => {
    const popup = await loadPopup(successfulCapture(), { managedError: true });
    expect(popup.copy.disabled).toBe(true); expect(popup.save.disabled).toBe(true); expect(popup.status.textContent).toContain('Unable to load organization policies');
    popup.copy.click(); await settle(); expect(popup.sendMessage).not.toHaveBeenCalled();
    popup.managedGet.mockResolvedValue({}); popup.changePolicy();
    await vi.waitFor(() => expect(popup.copy.disabled).toBe(false));
    popup.copy.click(); await settle(); expect(popup.clipboardWrite).toHaveBeenCalledOnce();
  });
});


it('blocks Preview and Customize at their operation boundaries as well as disabling the buttons', async () => {
  const popup = await loadPopup(successfulCapture(), { managedPolicy: { PreviewAllowed: false, FilterSettingsAllowed: false } });
  await vi.waitFor(() => expect(popup.copy.disabled).toBe(false));
  expect(popup.preview.disabled).toBe(true); expect(popup.customize.disabled).toBe(true);
  popup.preview.click(); popup.customize.click(); await settle();
  expect(popup.sendMessage).not.toHaveBeenCalled(); expect(popup.createTab).not.toHaveBeenCalled();
  expect(previewMock).not.toHaveBeenCalled();
});
