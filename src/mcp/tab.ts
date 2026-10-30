// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { browser } from 'wxt/browser';

export class McpTabMetadataUnavailable extends Error {
  constructor() { super('tab-metadata-unavailable'); }
}

/** Call only for a user-selected source or an already shared tab. */
export async function getMcpTab(tabId: number) {
  const tab = await browser.tabs.get(tabId);
  if (import.meta.env.BROWSER === 'firefox' || tab.url || tab.incognito || tab.discarded) return tab;
  // Cross-site navigation ends Chrome activeTab metadata access. The existing
  // debugger permission can resolve this tab without extra host/tabs permission.
  let metadata: { url: string; title: string };
  try {
    const { chromeTabMetadata } = await import('../adapters/chrome/tab-metadata');
    metadata = await chromeTabMetadata(tabId);
  } catch { throw new McpTabMetadataUnavailable(); }
  const current = await browser.tabs.get(tabId);
  if (current.incognito || current.discarded) return current;
  if (current.url && current.url !== metadata.url) throw new McpTabMetadataUnavailable();
  return { ...current, url: metadata.url, title: current.title ?? metadata.title };
}
