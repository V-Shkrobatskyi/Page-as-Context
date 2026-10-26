// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { browser } from 'wxt/browser';
import { installDiagnostics } from '@/src/diagnostics/background';
import { capturePageContext } from '@/src/page-capture';
import { CAPTURE_ACTIVE_TAB_MESSAGE, isCaptureActiveTabRequest } from '@/src/capture-message';
import { PICKER_START, isPickerStart } from '@/src/element-picker-protocol';
import { createPickerCoordinator } from '@/src/element-picker-session';
import { installKeyboardShortcuts } from '@/src/keyboard-shortcuts';
import { createMcpController } from '@/src/mcp/background';
import { PolicyError } from '@/src/policy/model';

// noinspection JSUnusedGlobalSymbols
export default defineBackground(() => {
  const journal = installDiagnostics();
  void journal.append({ code: 'background-ready', result: 'success' });
  let picker: ReturnType<typeof createPickerCoordinator> | undefined;
  const startPicker: ReturnType<typeof createPickerCoordinator>['start'] = (preferences, target) => {
    picker ??= createPickerCoordinator();
    return picker.start(preferences, target);
  };
  installKeyboardShortcuts(journal, startPicker);
  let mcp: ReturnType<typeof createMcpController> | undefined;

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && typeof message === 'object' && message.type === 'mcp-ui-v1') {
      if (sender.id !== browser.runtime.id || !sender.url ||
        ![browser.runtime.getURL('/popup.html'), browser.runtime.getURL('/mcp.html'), browser.runtime.getURL('/mcp-approval.html')].includes(sender.url.split('#')[0]!)) return;
      mcp ??= createMcpController();
      const reply = (value: unknown) => { try { sendResponse(value); } catch { /* The settings page or popup may have closed. */ } };
      void mcp.ui(message, sender).then(reply, (error: unknown) => {
        const code = error instanceof Error && ['invalid-source', 'invalid-sender', 'invalid-route', 'not-connected', 'source-required', 'permission-required', 'page-changed', 'invalid-instance', 'invalid-clients'].includes(error.message) ? error.message : 'request-unavailable';
        reply({ ok: false, code, error: error instanceof PolicyError ? error.message : 'MCP request unavailable. Check permissions, policies and the connected source, then reload.' });
      });
      return true;
    }
    if (sender.tab || sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL('/popup.html')) return;
    if (message && typeof message === 'object' && (message as { type?: unknown }).type === PICKER_START) {
      if (!isPickerStart(message)) { sendResponse({ ok: false, error: { message: 'Invalid selection preferences.' } }); return; }
      void startPicker(message).then(sendResponse);
      return true;
    }
    if (typeof message !== 'object' || message === null || (message as { type?: unknown }).type !== CAPTURE_ACTIVE_TAB_MESSAGE) return;
    if (!isCaptureActiveTabRequest(message)) {
      sendResponse({ ok: false, error: { code: 'capture-failed', message: 'Invalid export preferences.' } });
      return;
    }
    void capturePageContext(message, journal).then(result => {
      try { sendResponse(result); }
      catch { /* The popup may have closed while capture was finishing. */ }
    });
    return true;
  });
});
