// @vitest-environment jsdom
// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ send: vi.fn(), updated: new Set<() => void>(), removed: new Set<() => void>(), messages: new Set<(message: any, sender: any) => void>() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'synthetic-extension', sendMessage: fixture.send, onMessage: { addListener: (fn: any) => fixture.messages.add(fn), removeListener: (fn: any) => fixture.messages.delete(fn) } },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  tabs: {
    onUpdated: { addListener: (fn: () => void) => fixture.updated.add(fn), removeListener: (fn: () => void) => fixture.updated.delete(fn) },
    onRemoved: { addListener: (fn: () => void) => fixture.removed.add(fn), removeListener: (fn: () => void) => fixture.removed.delete(fn) },
  },
} }));
function state(enabled: boolean) {
  return { ok: true, revision: String(enabled), locked: false, testAllowed: true, copyAllowed: true, saveAllowed: true,
    settings: { enabled, mode: 'read-only', inherit: true }, allowedModes: ['read-only', 'read-write'], sessionApprovalAllowed: false,
    locks: {}, allowedFormats: ['semantic-text'], allowedCompression: ['compact'], requiredBuiltinFilters: [], managedRuleCount: 0,
    transport: 'disconnected', browser: 'chrome', instanceId: 'synthetic-instance',
    preferences: { format: 'semantic-text', compression: 'compact', redactSensitiveData: true }, pending: [], clients: [], connections: [],
  };
}
beforeEach(() => {
  fixture.send.mockReset(); fixture.updated.clear(); fixture.removed.clear(); fixture.messages.clear();
  location.hash = '11111111-1111-4111-8111-111111111111';
  document.body.innerHTML = readFileSync('entrypoints/mcp/index.html', 'utf8').split(/<body\b[^>]*>/u)[1]!.split('</body>')[0]!;
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.useRealTimers(); vi.resetModules(); });

it.each(['updated', 'removed'] as const)('finishes initial status loading after a tab %s event invalidates its pending read', async event => {
  let resolveInitial!: (value: unknown) => void;
  fixture.send.mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve; })).mockResolvedValue(state(true));
  await import('@/entrypoints/mcp/main');
  expect(document.getElementById('status')!.textContent).toBe('Loading…');
  for (const listener of fixture[event]) listener();
  resolveInitial(state(false));
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('MCP is enabled.'));
  expect(fixture.send).toHaveBeenCalledTimes(2);
  expect((document.getElementById('enabled') as HTMLInputElement).checked).toBe(true);
  expect(document.getElementById('transport')!.textContent).toBe('Helper: disconnected');
});

it.each([
  ['source-required', 'The selected tab is missing or expired.'],
  ['page-changed', 'The selected page changed.'],
  ['not-connected', 'This client has no active helper connection.'],
  ['permission-required', 'Browser permission is required.'],
  ['unknown-private-error', 'MCP request unavailable.'],
])('shows actionable safe feedback when Connect fails with %s', async (code, expected) => {
  const initial = { ...state(true), clients: [{ id: 'synthetic-client' }] };
  fixture.send.mockImplementation(async request => request.action === 'read' ? initial : { ok: false, code, error: 'Private internal detail' });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelector('#clients button')).not.toBeNull());
  (document.querySelector('#clients button') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain(expected));
  expect(document.getElementById('status')!.textContent).not.toContain('Private internal detail');
  expect(document.getElementById('connections')).toBeNull();
});


it.each(['ready', 'disconnected'])('refreshes a connecting helper automatically until it becomes %s', async transport => {
  vi.useFakeTimers();
  fixture.send.mockResolvedValueOnce({ ...state(true), transport: 'connecting' }).mockResolvedValue({ ...state(true), transport });
  await import('@/entrypoints/mcp/main');
  expect(document.getElementById('transport')!.textContent).toBe('Helper: connecting');
  await vi.advanceTimersByTimeAsync(500);
  expect(document.getElementById('transport')!.textContent).toBe(`Helper: ${transport}`);
  const requests = fixture.send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(fixture.send).toHaveBeenCalledTimes(requests);
});

it.each(['read-only', 'read-write'] as const)('grants the applied %s mode through the labeled Connect button, ignoring unsaved mode changes', async mode => {
  const initial = { ...state(true), settings: { ...state(true).settings, mode }, clients: [{ id: 'approved_client_001' }] };
  fixture.send.mockImplementation(async message => message.action === 'read' ? initial : { ok: true, connectionId: 'new_connection_001' });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelector('#clients button')).not.toBeNull());
  const connect = document.querySelector('#clients button') as HTMLButtonElement;
  expect(connect.textContent).toBe(`Connect selected tab (${mode === 'read-write' ? 'read and write' : 'read only'})`);
  const select = document.getElementById('mode') as HTMLSelectElement;
  select.value = mode === 'read-only' ? 'read-write' : 'read-only';
  select.dispatchEvent(new Event('input', { bubbles: true }));
  connect.click();
  await vi.waitFor(() => expect(fixture.send).toHaveBeenCalledWith({ type: 'mcp-ui-v1', action: 'connect',
    clientId: 'approved_client_001', sourceId: location.hash.slice(1), allowWrite: mode === 'read-write' }));
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('new_connection_001'));
});

it('cancels automatic connection refresh when the settings page closes', async () => {
  vi.useFakeTimers();
  fixture.send.mockResolvedValue({ ...state(true), transport: 'connecting' });
  await import('@/entrypoints/mcp/main');
  expect(document.getElementById('transport')!.textContent).toBe('Helper: connecting');
  window.dispatchEvent(new Event('pagehide'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(fixture.send).toHaveBeenCalledTimes(1);
});

it.each([true, false])('renders connection approval availability from policy: %s', async allowed => {
  const initial = { ...state(true), sessionApprovalAllowed: allowed, settings: { ...state(true).settings, writeApproval: 'session' } };
  fixture.send.mockResolvedValue(initial);
  await import('@/entrypoints/mcp/main');
  const select = document.getElementById('write-approval') as HTMLSelectElement;
  await vi.waitFor(() => expect(document.getElementById('transport')!.textContent).toBe('Helper: disconnected'));
  expect(select.options[1]!.textContent).toBe('Allow for this connection');
  expect(select.options[1]!.disabled).toBe(!allowed);
  expect(select.value).toBe(allowed ? 'session' : 'each-action');
});

it('shows client names, codes and separate selected and connected tab titles as plain text', async () => {
  const initial = { ...state(true), selectedTab: { title: 'Selected <img> tab' },
    pending: [{ id: 'pending_client_001', code: 'ABCD1234', name: 'New <b>client</b>' }],
    clients: [{ id: 'approved_client_001', name: 'ChatGPT — Firefox' }],
    connections: [{ id: 'connection_001', clientId: 'approved_client_001', mode: 'read-only', expires: Date.now() + 10000, tabTitle: 'Connected tab title' }],
  };
  fixture.send.mockResolvedValue(initial);
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.getElementById('pairing')!.textContent).toContain('ABCD1234'));
  expect(document.getElementById('pairing')!.textContent).toContain('New <b>client</b>');
  expect(document.querySelector('#pairing .client-tab')).toBeNull();
  expect(document.getElementById('clients')!.textContent).toContain('ChatGPT — Firefox');
  expect(document.getElementById('clients')!.textContent).toContain('Connected tab: Connected tab title');
  expect(document.querySelector('#pairing b, #pairing img')).toBeNull();
});


it('shows a new pairing request from a background notification without Refresh or losing draft settings', async () => {
  let current: any = state(true);
  fixture.send.mockImplementation(async () => current);
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.getElementById('transport')!.textContent).toBe('Helper: disconnected'));
  const mode = document.getElementById('mode') as HTMLSelectElement;
  mode.value = 'read-write'; mode.dispatchEvent(new Event('input', { bubbles: true }));
  current = { ...state(true), transport: 'ready', pending: [{ id: 'new_pending_client', code: 'ABCD1234', name: 'ChatGPT — Firefox' }] };
  for (const listener of fixture.messages) listener({ type: 'mcp-state-changed-v1' }, { id: 'synthetic-extension' });
  await vi.waitFor(() => expect(document.getElementById('pairing')!.textContent).toContain('ABCD1234'));
  expect(document.getElementById('transport')!.textContent).toBe('Helper: ready');
  expect(mode.value).toBe('read-write');
  expect(document.getElementById('draft-state')!.textContent).toContain('Draft');
  expect(fixture.send.mock.calls.every(([message]) => message.action === 'read')).toBe(true);
  window.dispatchEvent(new Event('pagehide'));
  expect(fixture.messages.size).toBe(0);
});

it('ignores state-change notifications from content scripts and other extensions', async () => {
  fixture.send.mockResolvedValue(state(true));
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.getElementById('transport')!.textContent).toBe('Helper: disconnected'));
  const before = fixture.send.mock.calls.length;
  for (const listener of fixture.messages) {
    listener({ type: 'mcp-state-changed-v1' }, { id: 'other-extension' });
    listener({ type: 'mcp-state-changed-v1' }, { id: 'synthetic-extension', tab: { id: 7 } });
  }
  expect(fixture.send).toHaveBeenCalledTimes(before);
});


it.each(['automatic', 'manual'] as const)('shows the shared Mode selector without a page-actions checkbox in %s', async connection => {
  fixture.send.mockResolvedValue({ ...state(true), settings: { ...state(true).settings, connection, mode: 'read-write' } });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect((document.getElementById('mode') as HTMLSelectElement).value).toBe('read-write'));
  expect(document.getElementById('mode-label')!.hidden).toBe(false);
  expect(document.getElementById('page-actions')).toBeNull();
  const selector = document.getElementById('connection') as HTMLSelectElement;
  selector.value = connection === 'automatic' ? 'manual' : 'automatic'; selector.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.getElementById('mode-label')!.hidden).toBe(false);
  expect((document.getElementById('mode') as HTMLSelectElement).value).toBe('read-write');
});
it('saves only Mode when switching connection type', async () => {
  fixture.send.mockResolvedValue({ ...state(false), settings: { ...state(false).settings, connection: 'automatic' } });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect((document.getElementById('connection') as HTMLSelectElement).value).toBe('automatic'));
  const selector = document.getElementById('mode') as HTMLSelectElement;
  selector.value = 'read-write'; selector.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('preferences')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(fixture.send.mock.calls.some(([message]) => message.action === 'apply')).toBe(true));
  const saved = fixture.send.mock.calls.find(([message]) => message.action === 'apply')![0].settings;
  expect(saved.mode).toBe('read-write'); expect(saved.connection).toBe('automatic'); expect(saved).not.toHaveProperty('allowPageActions');
});

it('shows the inactivity controls only for Automatic and disables the amount for unlimited', async () => {
  fixture.send.mockResolvedValue({ ...state(false), settings: { ...state(false).settings, connection: 'automatic' } });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.getElementById('auto-disconnect-setting')!.hidden).toBe(false));
  const amount = document.getElementById('timeout-amount') as HTMLInputElement;
  const unit = document.getElementById('timeout-unit') as HTMLSelectElement;
  expect(amount.value).toBe('1'); expect(unit.value).toBe('hours'); expect(amount.disabled).toBe(false);
  unit.value = 'unlimited'; unit.dispatchEvent(new Event('input', { bubbles: true }));
  expect(amount.disabled).toBe(true);
  const connection = document.getElementById('connection') as HTMLSelectElement;
  connection.value = 'manual'; connection.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.getElementById('auto-disconnect-setting')!.hidden).toBe(true);
  connection.value = 'automatic'; connection.dispatchEvent(new Event('input', { bubbles: true }));
  unit.value = 'days'; unit.dispatchEvent(new Event('input', { bubbles: true })); amount.value = '2';
  expect(amount.disabled).toBe(false);
  document.getElementById('preferences')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(fixture.send.mock.calls.some(([message]) => message.action === 'apply')).toBe(true));
  expect(fixture.send.mock.calls.find(([message]) => message.action === 'apply')![0].settings.autoDisconnect).toEqual({ amount: 2, unit: 'days' });
});

it.each(['write', 'read', 'policy', 'locked'])('renders per-client Skip prompts controls for %s', async variant => {
  fixture.send.mockResolvedValue({ ...state(true), transport: 'ready', locked: variant === 'locked', sessionApprovalAllowed: variant !== 'policy', sharedTabs: [
    { tabRef: 'shared_tab_001', title: 'Test tab', mode: variant === 'read' ? 'read' : 'write', expires: null, connections: [
      { connectionId: 'connection_001', name: 'Client A', write: variant !== 'read', skipPrompts: true },
      { connectionId: 'connection_002', name: 'Client B', write: variant !== 'read', skipPrompts: false },
    ] },
  ] });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelectorAll('.shared-client-approval input')).toHaveLength(2));
  const inputs = [...document.querySelectorAll<HTMLInputElement>('.shared-client-approval input')];
  expect(inputs.map(input => input.checked)).toEqual([true, false]);
  expect(inputs.map(input => input.disabled)).toEqual([variant !== 'write', variant !== 'write']);
  expect([...document.querySelectorAll('.shared-tabs-table th')].map(cell => cell.textContent)).toEqual(['Tab', 'Access', 'Skip prompts', 'Time left', 'Action']);
  if (variant === 'write') {
    inputs[1]!.click();
    await vi.waitFor(() => expect(fixture.send.mock.calls.some(([message]) => message.action === 'connection-approval')).toBe(true));
    expect(fixture.send.mock.calls.find(([message]) => message.action === 'connection-approval')![0]).toMatchObject({
      tabRef: 'shared_tab_001', connectionId: 'connection_002', skip: true,
    });
  }
});

it('counts down in a separate column locally and displays Unlimited without polling', async () => {
  vi.useFakeTimers();
  fixture.send.mockResolvedValue({ ...state(true), sharedTabs: [
    { tabRef: 'shared_tab_001', title: 'Timed tab', mode: 'read', expires: Date.now() + 62000 },
    { tabRef: 'shared_tab_002', title: 'Unlimited tab', mode: 'write', expires: null },
  ] });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelectorAll('#shared-tabs tr')).toHaveLength(2));
  expect([...document.querySelectorAll('#shared-tabs tr:first-child td')].map(cell => cell.textContent)).toEqual(['Timed tab', 'Read', '—', '2 min', 'Off']);
  expect(document.querySelector('#shared-tabs tr:last-child .shared-tab-remaining')!.textContent).toBe('Unlimited');
  const calls = fixture.send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(3000);
  expect(document.querySelector('#shared-tabs .shared-tab-remaining')!.textContent).toBe('59 sec');
  await vi.advanceTimersByTimeAsync(60000);
  expect(document.querySelector('#shared-tabs .shared-tab-remaining')!.textContent).toBe('0 sec');
  expect(fixture.send).toHaveBeenCalledTimes(calls);
  window.dispatchEvent(new Event('pagehide'));
  expect(vi.getTimerCount()).toBe(0);
});

it('updates the countdown when activity changes the deadline without adding another timer', async () => {
  vi.useFakeTimers();
  let current = { ...state(true), sharedTabs: [{ tabRef: 'shared_tab_001', title: 'Timed tab', mode: 'read', expires: Date.now() + 120000 }] };
  fixture.send.mockImplementation(async () => current);
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelector('#shared-tabs .shared-tab-remaining')!.textContent).toBe('2 min'));
  current = { ...current, sharedTabs: [{ ...current.sharedTabs[0]!, expires: Date.now() + 3600000 }] };
  for (const listener of fixture.messages) listener({ type: 'mcp-state-changed-v1' }, { id: 'synthetic-extension' });
  await vi.waitFor(() => expect(document.querySelector('#shared-tabs .shared-tab-remaining')!.textContent).toBe('60 min'));
  expect(vi.getTimerCount()).toBe(1);
});
