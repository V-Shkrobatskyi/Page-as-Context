// @vitest-environment jsdom
// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ send: vi.fn(), permission: vi.fn(), listeners: new Set<any>() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'test', sendMessage: fixture.send, onMessage: { addListener: (fn: any) => fixture.listeners.add(fn), removeListener: (fn: any) => fixture.listeners.delete(fn) } },
  permissions: { request: fixture.permission },
} }));
import { installMcpPopup } from '@/src/mcp/popup';
const state = () => ({ ok: true, automatic: true, enabled: true, paused: false, mode: 'read', writeAllowed: true, validTab: true, sourceId: 'synthetic_source_001',
  transport: 'ready', shares: [{ mode: 'read' }], clients: [{ id: 'synthetic_client_001', name: 'Test AI' }], pending: [] });
beforeEach(() => {
  vi.stubEnv('BROWSER', 'chrome'); fixture.send.mockReset(); fixture.permission.mockReset().mockResolvedValue(true); fixture.listeners.clear();
  const source = readFileSync('entrypoints/popup/main.ts', 'utf8');
  const control = source.match(/<button id="mcp-connect"[^\n]+/u)![0];
  const menu = source.match(/<div id="ai-control"[^\n]+/u)![0];
  const details = source.match(/<section id="ai-details"[^\n]+/u)![0];
  const brand = source.match(/<img class="brand-mark"[^\n]+/u)![0];
  document.body.innerHTML = brand + control + menu + details;
  fixture.send.mockImplementation(async message => message.action === 'popup-read' ? state() : { ok: true });
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllEnvs(); });
it('shows the current mode between previous and next access arrows', async () => {
  installMcpPopup();
  await vi.waitFor(() => expect(document.querySelector('#ai-menu')!.textContent).toBe('AI Read'));
  expect((document.querySelector('#ai-details') as HTMLElement).hidden).toBe(true);
  expect((document.querySelector('#ai-prev') as HTMLButtonElement).dataset.ai).toBe('off');
  expect((document.querySelector('#ai-next') as HTMLButtonElement).dataset.ai).toBe('write');
});
it('binds Write to the source selected before the permission prompt and keeps access on denial', async () => {
  installMcpPopup(); await vi.waitFor(() => expect((document.querySelector('#ai-next') as HTMLButtonElement).disabled).toBe(false));
  fixture.permission.mockResolvedValue(false);
  (document.querySelector('[data-ai="write"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector('#ai-status')!.textContent).toContain('not granted'));
  expect(fixture.send.mock.calls.some(([message]) => message.action === 'share')).toBe(false);
  fixture.permission.mockResolvedValue(true);
  (document.querySelector('[data-ai="write"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fixture.send).toHaveBeenCalledWith({ type: 'mcp-ui-v1', action: 'share', mode: 'write', sourceId: 'synthetic_source_001' }));
});
it('keeps the menu limited to access choices even with pending pairing requests', async () => {
  fixture.send.mockImplementation(async message => message.action === 'popup-read' ? { ...state(), pending: [{ id: 'new_client_001', code: '12345678', name: 'New AI' }] } : { ok: true });
  installMcpPopup();
  await vi.waitFor(() => expect(document.querySelector('#ai-menu')!.textContent).toBe('AI Read'));
  expect((document.querySelector('#ai-details') as HTMLElement).hidden).toBe(true);
  expect(document.querySelectorAll('#ai-control button')).toHaveLength(2);
  expect(document.querySelectorAll('#ai-details button')).toHaveLength(0);
  expect((document.querySelector('#ai-status') as HTMLElement).hidden).toBe(true);
  expect(fixture.send.mock.calls.every(([message]) => message.action === 'popup-read')).toBe(true);
});

it('skips Write and explains the shared Mode setting when it is unavailable', async () => {
  fixture.send.mockImplementation(async message => message.action === 'popup-read' ? { ...state(), writeAllowed: false } : { ok: true });
  installMcpPopup();
  await vi.waitFor(() => expect((document.querySelector('#ai-next') as HTMLButtonElement).dataset.ai).toBe('off'));
  expect(document.querySelector('[data-ai="write"]')).toBeNull();
  expect((document.querySelector('#ai-next') as HTMLButtonElement).disabled).toBe(false);
  expect((document.querySelector('#ai-next') as HTMLButtonElement).title).toContain('Mode: Read and write');
});

it('shows only a pending indicator in Automatic, leaving approval on the MCP page', async () => {
  fixture.send.mockImplementation(async () => ({ ...state(), pending: [{ id: 'new_client_001', code: '12345678', name: '<b>New AI</b>' }] }));
  installMcpPopup();
  await vi.waitFor(() => expect(document.querySelector('#ai-control')!.classList.contains('has-pairing')).toBe(true));
  expect(document.querySelector('#ai-pairing')).toBeNull();
  expect(document.body.textContent).not.toContain('12345678');
  expect(fixture.send.mock.calls.every(([message]) => message.action === 'popup-read')).toBe(true);
});
it('keeps Manual pairing on the settings page', async () => {
  fixture.send.mockImplementation(async () => ({ ...state(), automatic: false, pending: [{ id: 'new_client_001', code: '12345678' }] }));
  installMcpPopup();
  await vi.waitFor(() => expect((document.querySelector('#ai-control') as HTMLElement).hidden).toBe(true));
  expect(document.querySelector('#ai-control')!.classList.contains('has-pairing')).toBe(false);
  expect(document.querySelector('#ai-pairing')).toBeNull();
});

it('cycles in both directions and reflects only confirmed changes', async () => {
  let current = { ...state(), mode: 'off' };
  fixture.send.mockImplementation(async message => {
    if (message.action === 'share') current = { ...current, mode: message.mode };
    return message.action === 'popup-read' ? current : { ok: true };
  });
  installMcpPopup();
  const previous = document.querySelector('#ai-prev') as HTMLButtonElement;
  const next = document.querySelector('#ai-next') as HTMLButtonElement;
  await vi.waitFor(() => expect(next.disabled).toBe(false));
  expect(document.querySelector('.brand-mark')!.getAttribute('src')).toBe('/icon/32.png');
  expect(previous.disabled).toBe(false);
  for (const mode of ['Read', 'Write', 'Off']) {
    next.click();
    await vi.waitFor(() => expect(document.querySelector('#ai-menu')!.textContent).toBe(`AI ${mode}`));
    expect(document.querySelector('.brand-mark')!.getAttribute('src')).toBe(mode === 'Off' ? '/icon/32.png' : `/icon/ai-${mode.toLowerCase()}-32.png`);
    await vi.waitFor(() => expect(previous.disabled).toBe(false));
  }
  expect(next.disabled).toBe(false);
  for (const mode of ['Write', 'Read', 'Off']) {
    previous.click();
    await vi.waitFor(() => expect(document.querySelector('#ai-menu')!.textContent).toBe(`AI ${mode}`));
    expect(document.querySelector('.brand-mark')!.getAttribute('src')).toBe(mode === 'Off' ? '/icon/32.png' : `/icon/ai-${mode.toLowerCase()}-32.png`);
    await vi.waitFor(() => expect(next.disabled).toBe(false));
  }
  expect(previous.disabled).toBe(false);
  expect(fixture.send.mock.calls.filter(([message]) => message.action === 'share').map(([message]) => message.mode)).toEqual(['read', 'write', 'off', 'write', 'read', 'off']);
});

it.each([true, false])('shows the original Connect MCP icon button when MCP is disabled (Automatic: %s)', async automatic => {
  fixture.send.mockImplementation(async () => ({ ...state(), enabled: false, automatic, mode: 'off' }));
  installMcpPopup();
  await vi.waitFor(() => expect((document.querySelector('#mcp-connect') as HTMLButtonElement).hidden).toBe(false));
  await vi.waitFor(() => expect((document.querySelector('#ai-control') as HTMLElement).hidden).toBe(true));
  expect((document.querySelector('#ai-details') as HTMLElement).hidden).toBe(true);
  expect(document.querySelector('#mcp-connect svg')).not.toBeNull();
  expect(document.querySelector('#mcp-connect')!.textContent).toBe('Connect MCP');
  expect((document.querySelector('#mcp-connect') as HTMLButtonElement).title).toBe('Open MCP settings');
});
