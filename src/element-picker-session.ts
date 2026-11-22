// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { captureMetadata } from './history/model';
import { recordCaptureHistory } from './history/client';
import { technicalEvent } from './diagnostics/client';
import { checkPolicy, watchPolicy, captureDataControls, captureOptions, assertSource } from './policy/runtime';
import { browser, type Browser } from 'wxt/browser';
import { captureActiveTab } from './adapters/capture';
import { prepareExport } from './core';
import { loadRedactionSettings } from './redaction-settings';
import { resolveBrowserInfo } from './platform/browser-info';
import { openPreview, openSelectionSave } from './preview-session';
import { wrapClipboardContext } from './clipboard-context';
import { PICKER_PORT, PICKER_TTL, PICKER_SAVE_PERMISSION, selectedElementInfo, type PickerPreferences, type PickerAction } from './element-picker-protocol';
import type { RedactionSettings } from './core/privacy/settings';

type Port = ReturnType<typeof browser.runtime.connect>;
interface Session {
  tabId: number;
  url: string;
  token: string;
  documentId?: string;
  port?: Port;
  abort: AbortController;
  close(): void;
}

/** Background-owned sessions survive popup closure without persisting page data. */
export function createPickerCoordinator() {
  const sessions = new Map<number, Session>();
  const requests = new Map<number, symbol>();
  return {
    async start(preferences: PickerPreferences, target?: Browser.tabs.Tab): Promise<{ ok: true } | { ok: false; error: { message: string } }> {
      let session: Session | undefined;
      let requestTab: number | undefined;
      let requestKey: symbol | undefined;
      try {
        const snapshot = await checkPolicy('picker');
        const context = { ...preferences, policyRevision: snapshot.revision };
        await checkPolicy('picker', context);
        const platform = await browser.runtime.getPlatformInfo();
        const canSave = platform.os !== 'android';
        const tab = target ?? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
        if (tab?.id === undefined || !tab.url || !/^https?:\/\//u.test(tab.url)) throw new Error('Open a regular HTTP or HTTPS page to select a block.');
        if (target) {
          const current = await browser.tabs.get(tab.id);
          if (current.url !== tab.url || !current.active) throw new Error('The page changed. Try the shortcut again.');
        }
        assertSource(tab.url, snapshot);
        sessions.get(tab.id)?.close();
        const token = crypto.randomUUID();
        const tabId = tab.id;
        const request = Symbol();
        requestTab = tabId; requestKey = request;
        requests.set(tabId, request);
        const url = tab.url;
        const abort = new AbortController();
        let filters: RedactionSettings | undefined;
        let downloadsGranted = import.meta.env.BROWSER !== 'firefox' || await browser.permissions.contains({ permissions: ['downloads'] });
        if (preferences.redactSensitiveData) {
          try { filters = await loadRedactionSettings(); }
          catch { throw new Error('Unable to load redaction filters. Open Customize and try again.'); }
        }
        if (requests.get(tabId) !== request) throw new Error('A newer element selection was started.');
        // Another popup may have started a newer request while settings were loading.
        sessions.get(tabId)?.close();
        let timer: ReturnType<typeof setTimeout>;
        let resolveReady!: () => void;
        let rejectReady!: (error: Error) => void;
        let ready = false;
        let capturing = false;
        let copyAck: { operation: string; resolve(): void; reject(error: Error): void } | undefined;
        const started = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
        void started.catch(() => {});
        const cancelled = new Promise<never>((_resolve, reject) => abort.signal.addEventListener('abort', () => reject(new Error('Element selection ended.')), { once: true }));
        void cancelled.catch(() => {});
        const run = <T>(task: Promise<T>) => Promise.race([task, cancelled]);
        const ensure = () => {
          if (abort.signal.aborted || sessions.get(tabId) !== session) throw new Error('Element selection was cancelled.');
        };
        const verify = async () => {
          ensure();
          const results = await run(browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: selectedElementInfo, args: [token] }));
          ensure();
          const result = results[0];
          if (results.length !== 1 || result?.frameId !== 0 || !result.result || typeof result.result.tagName !== 'string' ||
            !/^[a-z][a-z0-9._-]{0,127}$/u.test(result.result.tagName) ||
            session?.documentId && result.documentId !== session.documentId) throw new Error('The selected element is no longer available. Pick the block again.');
          return result.result.tagName;
        };
        const capture = async (action: PickerAction) => {
          if (!ready || capturing) return;
          capturing = true;
          const operation = crypto.randomUUID();
          technicalEvent({ code: 'capture-start', result: 'started', operation });
          try {
            await checkPolicy('picker', context);
            await checkPolicy(action, context);
            if (action === 'save' && !canSave) throw new Error('Saving files is unavailable on Android.');
            if (action === 'save' && import.meta.env.BROWSER === 'firefox' &&
              !await browser.permissions.contains({ permissions: ['downloads'] })) {
              downloadsGranted = false;
              throw new Error('Download permission was not granted. Try Save again.');
            }
            assertSource((await browser.tabs.get(tabId)).url, snapshot);
            await verify();
            const date = new Date();
            const pad = (value: number) => String(value).padStart(2, '0');
            const capturedAt = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
            const outcome = await captureActiveTab({ id: tabId, url, title: tab.title }, capturedAt, token, abort.signal, captureOptions(snapshot));
            ensure();
            if (!outcome.ok) throw new Error(outcome.error.message);
            outcome.tree.selectedElementTag = await verify();
            const runtime = browser.runtime as typeof browser.runtime & { getBrowserInfo?: () => Promise<{ name: string; vendor: string; version: string; buildID: string }> };
            outcome.tree.browser = await resolveBrowserInfo({
              getBrowserInfo: runtime.getBrowserInfo ? () => runtime.getBrowserInfo!() : undefined,
              getPlatformInfo: () => browser.runtime.getPlatformInfo(),
              userAgent: globalThis.navigator?.userAgent,
            });
            ensure();
            await checkPolicy(action, context);
            assertSource((await browser.tabs.get(tabId)).url, snapshot);
            const result = prepareExport(outcome.tree, preferences.compression, preferences.format, preferences.redactSensitiveData, filters, captureDataControls(snapshot));
            if (!tab.incognito) recordCaptureHistory(captureMetadata(outcome.tree, captureDataControls(snapshot), preferences.redactSensitiveData, filters, preferences.compression));
            const payload = { operationId: operation, policyRevision: snapshot.revision, content: result.serialized.content, scope: 'selection' as const,
              compression: preferences.compression, format: preferences.format, redactSensitiveData: preferences.redactSensitiveData,
              redactionCount: result.redactionCount, reductionRatio: result.reductionRatio, warnings: outcome.warnings ?? [],
            };
            if (action === 'copy') {
              const acknowledged = new Promise<void>((resolve, reject) => { copyAck = { operation, resolve, reject }; });
              void acknowledged.catch(() => {});
              const timeout = setTimeout(() => copyAck?.reject(new Error('Copy took too long. Try again.')), 8_000);
              try {
                session?.port?.postMessage({ type: 'copy-content', operation, content: wrapClipboardContext(payload.content, preferences.compression) });
                await run(acknowledged);
              } finally { clearTimeout(timeout); copyAck = undefined; }
            } else if (action === 'save') await openSelectionSave(payload, abort.signal);
            else await openPreview(payload, abort.signal);
            ensure();
            technicalEvent({ code: action === 'copy' ? 'clipboard-complete' : 'picker-complete', result: 'success', operation });
            session?.port?.postMessage({ type: 'complete' });
            session?.close();
          } catch (error) {
            technicalEvent({ code: 'picker-complete', result: 'error', reason: 'failed', operation });
            if (!abort.signal.aborted) {
              try { session?.port?.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Unable to prepare the selection. Try again.' }); }
              catch { session?.close(); }
            }
          } finally { capturing = false; }
        };
        const onMessage = (message: unknown) => {
          if (!message || typeof message !== 'object' || abort.signal.aborted) return;
          const data = message as { type?: string; operation?: string };
          const type = data.type;
          if (type === 'ready' && !ready) { ready = true; session?.port?.postMessage({ type: 'active', previewAllowed: snapshot.policy.PreviewAllowed !== false, copyAllowed: snapshot.policy.ClipboardExportAllowed !== false, saveAllowed: canSave && snapshot.policy.FileExportAllowed !== false }); resolveReady(); }
          else if (type === 'cancel') session?.close();
          else if (type === 'capture') void capture('preview');
          else if (type === 'copy' || type === 'save') void capture(type);
          else if (copyAck && data.operation === copyAck.operation) {
            if (type === 'copied') copyAck.resolve();
            else if (type === 'copy-failed') copyAck.reject(new Error('Unable to copy the selected context. Try again.'));
          }
        };
        const requestPermission: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, sender, reply) => {
          if (!message || message.type !== PICKER_SAVE_PERMISSION || message.token !== token) return;
          if (!ready || abort.signal.aborted || sender.id !== browser.runtime.id || sender.tab?.id !== tabId ||
            sender.frameId !== 0 || sender.url !== url || session?.documentId && sender.documentId !== session.documentId) return;
          if (!canSave || snapshot.policy.FileExportAllowed === false) { reply({ granted: false }); return; }
          if (downloadsGranted) { reply({ granted: true }); return; }
          // Firefox preserves the content-script click gesture for runtime.onMessage.
          try {
            const requested = import.meta.env.BROWSER === 'firefox' ? browser.permissions.request({ permissions: ['downloads'] }) : Promise.resolve(true);
            void requested.then(granted => { downloadsGranted = granted; reply({ granted }); }, () => reply({ granted: false }));
          } catch { reply({ granted: false }); }
          return true;
        };
        const onDisconnect = () => { void browser.runtime.lastError; session?.close(); };
        const onConnect = (port: Port) => {
          if (port.name !== `${PICKER_PORT}${token}`) return;
          if (session?.port || port.sender?.id !== browser.runtime.id || port.sender.tab?.id !== tabId ||
            port.sender.frameId !== 0 || port.sender.url !== url ||
            session?.documentId && port.sender.documentId !== session.documentId) { port.disconnect(); return; }
          session!.port = port;
          session!.documentId ??= port.sender.documentId;
          port.onMessage.addListener(onMessage); port.onDisconnect.addListener(onDisconnect);
        };
        const unwatch = watchPolicy(() => session?.close());
        const updated = (id: number, info: { status?: string; url?: string }) => {
          if (id === tabId && (info.status === 'loading' || info.url !== undefined && info.url !== url)) session?.close();
        };
        const removed = (id: number) => { if (id === tabId) session?.close(); };
        session = { tabId, url, token, abort, close() {
          if (abort.signal.aborted) return;
          abort.abort(); clearTimeout(timer); unwatch();
          rejectReady(new Error('Element selection ended. Open the extension and try again.'));
          browser.runtime.onConnect.removeListener(onConnect);
          browser.runtime.onMessage.removeListener(requestPermission);
          browser.tabs.onUpdated.removeListener(updated); browser.tabs.onRemoved.removeListener(removed);
          if (session?.port) {
            session.port.onMessage.removeListener(onMessage); session.port.onDisconnect.removeListener(onDisconnect);
            session.port.disconnect(); session.port = undefined;
          }
          if (sessions.get(tabId) === session) sessions.delete(tabId);
          if (requests.get(tabId) === request) requests.delete(tabId);
          filters = undefined;
        } };
        sessions.set(tabId, session);
        browser.runtime.onConnect.addListener(onConnect);
        browser.runtime.onMessage.addListener(requestPermission);
        browser.tabs.onUpdated.addListener(updated); browser.tabs.onRemoved.addListener(removed);
        timer = setTimeout(() => session?.close(), PICKER_TTL);
        // Short startup deadline; a late injection connects to a closed session and is rejected.
        const startup = setTimeout(() => session?.close(), 8_000);
        try {
          const injected = await run(browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', files: ['/element-picker.js'] }));
          ensure();
          if (injected.length !== 1 || injected[0]?.frameId !== 0) throw new Error('Unable to start selection on this page.');
          session.documentId = injected[0].documentId;
          await run(browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED',
            func: (value: string) => {
              const scope = globalThis as { __pageAsContextStartPicker?: (token: string) => void };
              scope.__pageAsContextStartPicker?.(value);
            }, args: [token],
          }));
          await started; ensure();
        } finally { clearTimeout(startup); }
        technicalEvent({ code: 'picker-start', result: 'success' });
        return { ok: true };
      } catch (error) {
        technicalEvent({ code: 'picker-start', result: 'error', reason: 'failed' });
        session?.close();
        if (requestTab !== undefined && requests.get(requestTab) === requestKey) requests.delete(requestTab);
        return { ok: false, error: { message: error instanceof Error ? error.message : 'Unable to start element selection.' } };
      }
    },
  };
}
