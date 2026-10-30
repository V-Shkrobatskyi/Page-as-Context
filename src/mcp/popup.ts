// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { browser, type Browser } from 'wxt/browser';
import { requestMcpPermissions } from './permissions';
import { MCP_STATE_CHANGED } from './ui-events';

export function installMcpPopup() {
  // All permission changes are authorized by the background controller.
  const mcpConnect = document.querySelector<HTMLButtonElement>('#mcp-connect');
  const aiControl = document.querySelector<HTMLElement>('#ai-control')!;
  const previous = document.querySelector<HTMLButtonElement>('#ai-prev')!;
  const next = document.querySelector<HTMLButtonElement>('#ai-next')!;
  const aiDetails = document.querySelector<HTMLElement>('#ai-details')!;
  const aiStatus = document.querySelector<HTMLElement>('#ai-status')!;
  if (!mcpConnect || !aiControl || !previous || !next || !aiDetails || !aiStatus) return;
  let aiSourceId: string | undefined;
  let aiDisposed = false, aiBusy = false;
  async function aiRequest(action: string, fields: Record<string, unknown> = {}) {
    const result = await browser.runtime.sendMessage({ type: 'mcp-ui-v1', action, ...fields });
    if (!result?.ok) throw new Error(result?.code === 'not-connected' ? 'The bridge is connecting. Try again when it is connected.' : result?.code === 'permission-required' ? 'Browser permission is required.' : 'AI access is unavailable. Check the page, connection and organization policy.');
    return result;
  }
  async function loadAi() {
    try {
      const state = await aiRequest('popup-read'); if (aiDisposed || aiBusy) return;
      aiSourceId = state.sourceId;
      const automaticAccess = state.enabled && state.automatic;
      mcpConnect!.hidden = automaticAccess;
      aiControl.hidden = !automaticAccess;
      mcpConnect!.title = state.enabled ? 'Connect this tab to MCP' : 'Open MCP settings';
      mcpConnect!.setAttribute('aria-label', mcpConnect!.title);
      const modes = state.writeAllowed ? ['off', 'read', 'write'] : ['off', 'read'];
      const index = Math.max(0, modes.indexOf(state.mode));
      for (const [button, target] of [[previous, index - 1], [next, index + 1]] as const) {
        const mode = modes[(target + modes.length) % modes.length]!;
        button.dataset.ai = mode;
        button.disabled = !state.enabled || !state.validTab || state.paused;
        button.title = `AI ${mode === 'write' ? 'Write (read and actions)' : mode === 'read' ? 'Read' : 'Off'}`
          + (state.writeAllowed ? '' : '. Write is unavailable. Select Mode: Read and write in MCP settings; organization policy may restrict it.');
      }
      document.querySelector('#ai-menu')!.textContent = `AI ${state.mode === 'write' ? 'Write' : state.mode === 'read' ? 'Read' : 'Off'}`;
      const brand = document.querySelector<HTMLImageElement>('.brand-mark');
      if (brand) {
        brand.src = state.mode === 'read' || state.mode === 'write' ? `/icon/ai-${state.mode}-32.png` : '/icon/32.png';
        brand.title = `AI ${state.mode === 'write' ? 'Write' : state.mode === 'read' ? 'Read' : 'Off'}`;
      }
      const pending = state.enabled && state.automatic ? state.pending : [];
      aiControl.classList.toggle('has-pairing', pending.length > 0);
      aiControl.setAttribute('aria-label', pending.length ? `AI access to this tab; ${pending.length} pairing requests` : 'AI access to this tab');
      aiStatus.textContent = !state.enabled ? 'Enable MCP in Settings to connect an AI app.' : state.paused ? 'AI access is paused. Resume it in MCP settings.' : '';
      aiStatus.hidden = !aiStatus.textContent;
      aiDetails.hidden = !automaticAccess || aiStatus.hidden;
    } catch { if (!aiDisposed) { aiStatus.textContent = 'AI connection unavailable. Open Settings to review permissions.'; aiStatus.hidden = false; aiDetails.hidden = false; } }
  }
  async function runAi(action: () => Promise<void>) {
    if (aiBusy) return; aiBusy = true;
    for (const button of document.querySelectorAll<HTMLButtonElement>('#ai-control button, #ai-details button')) button.disabled = true;
    let failure = '';
    try { await action(); } catch (error) { failure = error instanceof Error ? error.message : 'AI access unavailable.'; }
    finally { aiBusy = false; for (const button of document.querySelectorAll<HTMLButtonElement>('#ai-control button, #ai-details button')) button.disabled = false; await loadAi(); if (failure) { aiDetails.hidden = false; aiStatus.textContent = failure; aiStatus.hidden = false; } }
  }
  for (const button of [previous, next]) button.addEventListener('click', () => void runAi(async () => {
    const mode = button.dataset.ai, sourceId = aiSourceId;
    if (!mode) return;
    if (mode !== 'off' && !await requestMcpPermissions(mode === 'write')) throw new Error('Browser permission was not granted.');
    await aiRequest('share', { mode, sourceId });
  }));
  const aiChanged = (message: unknown, sender: Browser.runtime.MessageSender) => {
    if (sender.id === browser.runtime.id && !sender.tab && message && typeof message === 'object' && (message as { type?: string }).type === MCP_STATE_CHANGED) void loadAi();
  };
  browser.runtime.onMessage.addListener(aiChanged);
  window.addEventListener('pagehide', () => { aiDisposed = true; browser.runtime.onMessage.removeListener(aiChanged); });
  void loadAi();

}
