// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import './style.css';
import { browser } from 'wxt/browser';
const description = document.getElementById('description')!;
const allow = document.getElementById('allow') as HTMLButtonElement;
const deny = document.getElementById('deny') as HTMLButtonElement;
let timer: ReturnType<typeof setTimeout> | undefined;
async function answer(value: boolean) {
  allow.disabled = true; deny.disabled = true;
  try { await browser.runtime.sendMessage({ type: 'mcp-ui-v1', action: 'approval-answer', allow: value }); } catch { /* Closing or revocation denies unsettled requests. */ }
  const tab = await browser.tabs.getCurrent(); if (tab?.id !== undefined) await browser.tabs.remove(tab.id).catch(() => {});
}
allow.addEventListener('click', () => void answer(true)); deny.addEventListener('click', () => void answer(false));
void browser.runtime.sendMessage({ type: 'mcp-ui-v1', action: 'approval-read' }).then(result => {
  if (!result?.ok) throw new Error('expired');
  description.textContent = `${result.action} → ${result.target}`;
  document.getElementById('expiry')!.textContent = `Expires ${new Date(result.expires).toLocaleTimeString()}. Closing this tab denies the action.`;
  allow.disabled = false; timer = setTimeout(() => void answer(false), Math.max(0, result.expires - Date.now()));
}, () => { description.textContent = 'This approval request expired or was revoked. No action is authorized.'; }).catch(() => { description.textContent = 'This approval request expired or was revoked. No action is authorized.'; });
window.addEventListener('pagehide', () => { clearTimeout(timer); allow.disabled = true; });
