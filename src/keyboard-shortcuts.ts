// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { browser, type Browser } from 'wxt/browser';
import { capturePageContext } from './page-capture';
import { CAPTURE_ACTIVE_TAB_MESSAGE } from './capture-message';
import { wrapClipboardContext } from './clipboard-context';
import { copyShortcutContext } from './shortcut-clipboard';
import { openPreview, openSelectionSave } from './preview-session';
import { captureWarningText } from './preview-message';
import { readPolicy, checkPolicy, policyMessage } from './policy/runtime';
import { assertAction, PolicyError, resolvePreferences, type ExportPreferences } from './policy/model';
import type { installDiagnostics } from './diagnostics/background';

class ShortcutError extends Error {}

type Tab = Browser.tabs.Tab;
type StartPicker = (preferences: ExportPreferences, target?: Tab) => Promise<{ ok: true } | { ok: false; error: { message: string } }>;
const actions = { 'preview-context': 'preview', 'copy-page-context': 'copy', 'save-context-file': 'save', 'select-element': 'picker' } as const;

/** Browser commands grant activeTab and keep capture independent of the popup lifetime. */
export function installKeyboardShortcuts(journal: ReturnType<typeof installDiagnostics>, startPicker: StartPicker, restoreAction?: () => Promise<void>): void {
  let pending = false;
  const feedbackTimers = new Map<number, ReturnType<typeof setTimeout>>();
  async function feedback(tabId: number, message: string, success: boolean): Promise<void> {
    clearTimeout(feedbackTimers.get(tabId));
    await Promise.allSettled([
      browser.action.setBadgeText({ tabId, text: success ? '✓' : '!' }),
      browser.action.setBadgeBackgroundColor({ tabId, color: success ? '#18794e' : '#b42318' }),
      browser.action.setBadgeTextColor?.({ tabId, color: '#FFFFFF' }),
      browser.action.setTitle({ tabId, title: `Page as Context — ${message}` }),
    ]);
    feedbackTimers.set(tabId, setTimeout(() => {
      feedbackTimers.delete(tabId);
      void Promise.allSettled([
        browser.action.setBadgeText({ tabId, text: '' }),
        browser.action.setTitle({ tabId, title: 'Page as Context' }),
      ]).then(() => restoreAction?.()).catch(() => {});
    }, 8000));
  }

  browser.commands.onCommand.addListener((command, sourceTab) => {
    if (!Object.hasOwn(actions, command) || pending) return;
    const action = actions[command as keyof typeof actions];
    pending = true;
    // Firefox requires permissions.request directly in the keyboard user gesture.
    let permission: Promise<boolean>;
    try {
      permission = action === 'save' && import.meta.env.BROWSER === 'firefox'
        ? browser.permissions.request({ permissions: ['downloads'] })
        : Promise.resolve(true);
    } catch { permission = Promise.resolve(false); }
    // Handle rejection immediately, even while the active-tab query is pending.
    permission = permission.catch(() => false);
    void (async () => {
      let tab: Tab | undefined = sourceTab;
      try {
        tab ??= (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
        if (tab?.id === undefined) throw new ShortcutError('Open a regular web page and try again.');
        const target = tab;
        const tabId = tab.id;
        const snapshot = await readPolicy();
        assertAction(snapshot.policy, action);
        const stored = await browser.storage.local.get('popup-settings');
        const raw = stored['popup-settings'];
        const preferences = resolvePreferences(snapshot.policy, raw && typeof raw === 'object' ? raw : {});
        const context = { ...preferences, policyRevision: snapshot.revision };
        await checkPolicy(action, context);
        if (!await permission) throw new ShortcutError('Download permission was not granted. Use Save to file to try again.');
        // Permission prompts or settings reads must not redirect the command to a newer tab.
        const current = await browser.tabs.get(tabId);
        if (current.url !== target.url || !current.active) throw new ShortcutError('The page changed. Try the shortcut again.');
        if (action === 'picker') {
          const result = await startPicker(preferences, target);
          if (!result.ok) throw new ShortcutError(result.error.message);
          return;
        }
        if (action === 'save' && import.meta.env.BROWSER === 'firefox' && (await browser.runtime.getPlatformInfo()).os === 'android') {
          throw new ShortcutError('Saving files is currently available on desktop only.');
        }
        const response = await capturePageContext({ type: CAPTURE_ACTIVE_TAB_MESSAGE, ...preferences }, journal, target);
        if (!response.ok) throw new ShortcutError(response.error.message);
        const payload = {
          ...context, operationId: response.operationId, policyRevision: response.policyRevision,
          content: response.export.serialized.content, redactionCount: response.export.redactionCount,
          reductionRatio: response.export.reductionRatio, warnings: response.warnings ?? [],
        };
        await checkPolicy(action, payload);
        if (action === 'preview') await openPreview(payload);
        else if (action === 'save') await openSelectionSave(payload);
        else {
          const latest = await browser.tabs.get(tabId);
          if (latest.url !== target.url || !latest.active) throw new ShortcutError('The page changed. Try the shortcut again.');
          const copied = await browser.scripting.executeScript({
            target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: copyShortcutContext,
            args: [wrapClipboardContext(payload.content, preferences.compression), target.url ?? ''],
          });
          if (copied.length !== 1 || copied[0]?.result !== true) throw new ShortcutError('Unable to copy page context. Keep the page focused and try again.');
          void journal.append({ code: 'clipboard-complete', result: 'success', operation: response.operationId });
        }
        const warning = captureWarningText(payload.warnings);
        await feedback(tabId, `${action === 'copy' ? 'Context copied.' : action === 'save' ? 'Saving file in a separate tab.' : 'Preview opened.'}${warning ? ` ${warning}` : ''}`, true);
      } catch (error) {
        if (tab?.id !== undefined) await feedback(tab.id, error instanceof PolicyError ? policyMessage(error) : error instanceof ShortcutError ? error.message : 'Unable to run this shortcut. Open the extension and try again.', false);
      } finally { pending = false; }
    })();
  });
}
