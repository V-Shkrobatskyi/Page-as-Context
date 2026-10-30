// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only

/** Return metadata only for the requested tab, without attaching a debugger. */
export async function chromeTabMetadata(tabId: number): Promise<{ url: string; title: string }> {
  const matches = (await chrome.debugger.getTargets()).filter(target => target.type === 'page' && target.tabId === tabId);
  if (matches.length !== 1 || !matches[0]!.url) throw new Error('tab-metadata-unavailable');
  return { url: matches[0]!.url, title: matches[0]!.title };
}
