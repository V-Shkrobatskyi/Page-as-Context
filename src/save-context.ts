// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { DownloadCancelledError, isDownloadCancellation } from './download-errors';
import { technicalEvent } from './diagnostics/client';
import { PolicyError } from './policy/model';
import { checkPolicy, type PolicyContext } from './policy/runtime';
import { browser } from 'wxt/browser';
import type { SupportedExportFormat } from './core';
import { contextBlob, contextDownloadOptions } from './download-context';

/** Keep the file URL alive until the browser finishes or cancels the download. */
export async function saveContextFile(content: string, format: SupportedExportFormat, signal?: AbortSignal, context?: PolicyContext): Promise<void> {
  await checkPolicy('save', context);
  if (context && context.format !== format) throw new PolicyError('Export format does not match the prepared context. Prepare the context again.');
  await downloadBlob(contextBlob(content, format), contextDownloadOptions('', format).filename, signal, context?.operationId);
}

/** Own the blob and listeners until a download completes, fails or is cancelled. */
export async function downloadBlob(blob: Blob, filename: string, signal?: AbortSignal, operation?: string): Promise<number> {
  if (signal?.aborted) throw new DownloadCancelledError();
  const url = URL.createObjectURL(blob);
  let changed: Parameters<typeof browser.downloads.onChanged.addListener>[0] | undefined;
  let erased: Parameters<typeof browser.downloads.onErased.addListener>[0] | undefined;
  let cancel!: (error: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { cancel = reject; });
  void cancelled.catch(() => {});
  const onCancel = () => cancel(new DownloadCancelledError());
  signal?.addEventListener('abort', onCancel, { once: true });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onCancel, { once: true });
  try {
    const id = await Promise.race([browser.downloads.download({ url, filename, saveAs: true }), cancelled]);
    await Promise.race([new Promise<void>((resolve, reject) => {
      const check = (state?: string, error?: string) => {
        if (error === 'USER_CANCELED') reject(new DownloadCancelledError());
        else if (state === 'interrupted' || error) reject(new Error('download-interrupted'));
        else if (state === 'complete') resolve();
      };
      changed = delta => { if (delta.id === id) check(delta.state?.current, delta.error?.current); };
      erased = erasedId => { if (erasedId === id) reject(new Error('download-erased')); };
      browser.downloads.onChanged.addListener(changed);
      browser.downloads.onErased.addListener(erased);
      // A small local download may finish before the listener is attached.
      void browser.downloads.search({ id }).then(items => {
        if (!items[0]) reject(new Error('download-unavailable'));
        else check(items[0].state, items[0].error);
      }, reject);
    }), cancelled]);
    technicalEvent({ code: 'download-complete', result: 'success', operation });
    return id;
  } catch (error) {
    const wasCancelled = isDownloadCancellation(error);
    technicalEvent({ code: 'download-complete', result: 'error', reason: wasCancelled ? 'cancelled' : 'failed', operation });
    throw wasCancelled ? new DownloadCancelledError() : error;
  } finally {
    if (changed) browser.downloads.onChanged.removeListener(changed);
    if (erased) browser.downloads.onErased.removeListener(erased);
    signal?.removeEventListener('abort', onCancel);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onCancel);
    URL.revokeObjectURL(url);
  }
}
