// @vitest-environment jsdom
// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

it.each([false, true])('loads and saves the write action limit while respecting settings lock=%s', async locked => {
  fixture.send.mockImplementation(async message => message.action === 'apply' ? { ok: true } : { ...state(true), locked,
    settings: { ...state(true).settings, mode: 'read-write', maxActions: 4 } });
  await import('@/entrypoints/mcp/main');
  const input = document.getElementById('max-actions') as HTMLInputElement;
  await vi.waitFor(() => expect(input.value).toBe('4')); expect(input.disabled).toBe(locked);
  if (!locked) {
    input.value = '2'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('preferences')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fixture.send.mock.calls.some(([message]) => message.action === 'apply' && message.settings.maxActions === 2)).toBe(true));
  }
});

const fixture = vi.hoisted(() => ({ write: vi.fn(), save: vi.fn(), show: vi.fn(), search: vi.fn(), platform: vi.fn(), permissions: vi.fn(), send: vi.fn(), updated: new Set<() => void>(), removed: new Set<() => void>(), messages: new Set<(message: any, sender: any) => void>() }));
vi.mock('@/src/save-context', () => ({ downloadBlob: fixture.save }));
vi.mock('wxt/browser', () => ({ browser: {
  downloads: { show: fixture.show, search: fixture.search },
  runtime: { getPlatformInfo: fixture.platform, id: 'synthetic-extension', sendMessage: fixture.send, onMessage: { addListener: (fn: any) => fixture.messages.add(fn), removeListener: (fn: any) => fixture.messages.delete(fn) } },
  permissions: { request: fixture.permissions },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  tabs: {
    onUpdated: { addListener: (fn: () => void) => fixture.updated.add(fn), removeListener: (fn: () => void) => fixture.updated.delete(fn) },
    onRemoved: { addListener: (fn: () => void) => fixture.removed.add(fn), removeListener: (fn: () => void) => fixture.removed.delete(fn) },
  },
} }));
function state(enabled: boolean) {
  return { ok: true, revision: String(enabled), locked: false, testAllowed: true, copyAllowed: true, saveAllowed: true,
    settings: { enabled, mode: 'read-only', inherit: true, hfs: { enabled: true, endpoint: 'http://127.0.0.1:39861' } }, allowedModes: ['read-only', 'read-write'], sessionApprovalAllowed: false,
    locks: {}, allowedFormats: ['semantic-text'], allowedCompression: ['compact'], requiredBuiltinFilters: [], managedRuleCount: 0,
    transport: 'disconnected', browser: 'chrome', instanceId: 'synthetic-instance',
    preferences: { format: 'semantic-text', compression: 'compact', redactSensitiveData: true }, pending: [], clients: [], connections: [],
  };
}
beforeEach(() => {
  fixture.write.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: fixture.write } });
  fixture.platform.mockReset().mockResolvedValue({ os: 'mac' });
  fixture.save.mockReset().mockResolvedValue(42); fixture.show.mockReset().mockResolvedValue(undefined); fixture.search.mockReset().mockResolvedValue([{ id: 42, exists: true }]);
  fixture.permissions.mockReset().mockResolvedValue(true); fixture.send.mockReset(); fixture.updated.clear(); fixture.removed.clear(); fixture.messages.clear();
  location.hash = '11111111-1111-4111-8111-111111111111';
  document.body.innerHTML = readFileSync('entrypoints/mcp/index.html', 'utf8').split(/<body\b[^>]*>/u)[1]!.split('</body>')[0]!;
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.useRealTimers(); vi.resetModules(); vi.unstubAllEnvs(); });

it('counts down the HFS lease wait without resetting on refresh or polling the server', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T16:00:00Z'));
  const deadline = Date.now() + 45000;
  let current = { ...state(true), transport: 'ready', settings: { ...state(true).settings, connection: 'automatic' }, transports: { native: 'ready', hfs: 'provider-already-connected' }, hfsLeaseRetryAt: deadline };
  fixture.send.mockImplementation(async () => {
    if (Date.now() >= deadline) current = { ...current, transports: { native: 'ready', hfs: Date.now() < deadline + 1500 ? 'connecting' : 'ready' }, hfsLeaseRetryAt: 0 };
    return current;
  });
  await import('@/entrypoints/mcp/main');
  await vi.advanceTimersByTimeAsync(0);
  expect(document.getElementById('hfs-status')!.textContent).toContain('Retry in 45 sec.');
  const requests = fixture.send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(document.getElementById('hfs-status')!.textContent).toContain('Retry in 44 sec.');
  expect(fixture.send.mock.calls).toHaveLength(requests);
  document.getElementById('refresh')!.click(); await vi.advanceTimersByTimeAsync(0);
  expect(document.getElementById('hfs-status')!.textContent).toContain('Retry in 44 sec.');
  await vi.advanceTimersByTimeAsync(44000);
  expect(document.getElementById('hfs-status')!.textContent).toBe('HFS: connecting');
  await vi.advanceTimersByTimeAsync(2000);
  expect(document.getElementById('hfs-status')!.textContent).toBe('HFS: ready');
  expect(vi.getTimerCount()).toBe(0);
});
it('updates the retry error countdown while keeping settings usable and clears it on Stop', async () => {
  vi.useFakeTimers();
  let waiting = false, stopped = false, deadline = 0;
  fixture.send.mockImplementation(async message => {
    if (message.action === 'hfs-retry') { waiting = true; deadline = Date.now() + 45000; return { ok: false, code: 'provider-already-connected' }; }
    if (message.action === 'hfs-stop') { waiting = false; stopped = true; return { ok: true }; }
    return { ...state(true), transports: { native: 'ready', hfs: waiting ? 'provider-already-connected' : stopped ? 'paused' : 'disconnected' }, hfsLeaseRetryAt: waiting ? deadline : null };
  });
  await import('@/entrypoints/mcp/main'); await vi.advanceTimersByTimeAsync(0);
  document.getElementById('hfs-retry')!.click(); await vi.advanceTimersByTimeAsync(0);
  expect(document.getElementById('status')!.textContent).toContain('Retry in 45 sec.');
  expect((document.getElementById('apply') as HTMLButtonElement).disabled).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(document.getElementById('status')!.textContent).toContain('Retry in 44 sec.');
  document.getElementById('hfs-stop')!.click(); await vi.advanceTimersByTimeAsync(0);
  expect(document.getElementById('hfs-status')!.textContent).toBe('HFS: paused');
  expect(document.getElementById('status')!.textContent).not.toContain('Retry in');
  expect(vi.getTimerCount()).toBe(0);
});

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
    clients: [{ id: 'approved_client_001', name: 'ChatGPT — Firefox', addedAt: 1793720000000 }],
    connections: [{ id: 'connection_001', clientId: 'approved_client_001', mode: 'read-only', expires: Date.now() + 10000, tabTitle: 'Connected tab title' }],
  };
  fixture.send.mockResolvedValue(initial);
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.getElementById('pairing')!.textContent).toContain('ABCD1234'));
  expect(document.getElementById('pairing')!.textContent).toContain('New <b>client</b>');
  expect(document.querySelector('#pairing .client-tab')).toBeNull();
  expect(document.getElementById('clients')!.textContent).toContain('ChatGPT — Firefox');
  expect(document.querySelector('#clients .client-id')!.textContent).toContain(' · Added: ');
  expect(document.querySelector('#clients .client-id time')!.getAttribute('datetime')).toBe('2026-11-03T15:33:20.000Z');
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

it('keeps HTTP credentials out of page text and preview when exporting configuration', async () => {
  fixture.send.mockImplementation(async message => message.action === 'hfs-generate' ? { ok: true, filename: 'config.yaml', content: 'providerSecret: private-test-secret' } : state(false));
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect((document.getElementById('hfs-generate') as HTMLButtonElement).disabled).toBe(false));
  (document.getElementById('hfs-generate') as HTMLButtonElement).click();
  await vi.waitFor(() => expect((document.getElementById('hfs-show-config') as HTMLButtonElement).disabled).toBe(false));
  expect(fixture.save).toHaveBeenCalledWith(expect.any(Blob), 'config.yaml');
  (document.getElementById('hfs-show-config') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fixture.show).toHaveBeenCalledWith(42));
  fixture.search.mockResolvedValue([{ id: 42, exists: false }]);
  (document.getElementById('hfs-show-config') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('may have been moved'));
  expect(document.body.textContent).not.toContain('private-test-secret');
  expect((document.getElementById('output') as HTMLTextAreaElement).value).toBe('');
  expect(fixture.send).toHaveBeenCalledWith(expect.objectContaining({ action: 'hfs-generate', endpoint: 'http://127.0.0.1:39861' }));
});
it('keeps HTTP revoke and Stop available under a settings lock', async () => {
  fixture.send.mockResolvedValue({ ...state(true), locked: true, httpClients: [{ id: 'http_client_00000001', name: 'HTTP Test', approved: true }] });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelector('#http-clients button')).not.toBeNull());
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('#http-clients button')];
  expect(buttons.find(button => button.textContent === 'Revoke')!.disabled).toBe(false);
  expect(buttons.find(button => button.textContent === 'Export config')!.disabled).toBe(true);
  expect(buttons.filter(button => button.textContent?.startsWith('Copy')).every(button => button.disabled)).toBe(true);
  expect((document.getElementById('hfs-stop') as HTMLButtonElement).disabled).toBe(false);
});
it('applies HTTP-only settings with loopback consent and without nativeMessaging', async () => {
  fixture.send.mockImplementation(async message => message.action === 'read' ? state(false) : { ok: true });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect((document.getElementById('enabled') as HTMLInputElement).disabled).toBe(false));
  (document.getElementById('native-enabled') as HTMLInputElement).checked = false;
  (document.getElementById('hfs-enabled') as HTMLInputElement).checked = true;
  (document.getElementById('enabled') as HTMLInputElement).checked = true;
  document.getElementById('hfs-enabled')!.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.getElementById('draft-state-hfs')!.textContent).toContain('Draft');
  (document.getElementById('apply-hfs') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fixture.permissions).toHaveBeenCalledWith(expect.objectContaining({ permissions: [], origins: ['http://127.0.0.1/*'] })));
  await vi.waitFor(() => expect(fixture.send.mock.calls.some(([message]) => message.action === 'apply' && message.settings.nativeEnabled === false && message.settings.hfs.enabled)).toBe(true));
});

it('does not enable reveal when the save dialog is cancelled and allows retry', async () => {
  const { DownloadCancelledError } = await import('@/src/download-errors');
  fixture.save.mockRejectedValue(new DownloadCancelledError());
  fixture.send.mockImplementation(async message => message.action === 'hfs-generate' ? { ok: true, filename: 'config.yaml', content: 'private-test-secret' } : state(false));
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect((document.getElementById('hfs-generate') as HTMLButtonElement).disabled).toBe(false));
  (document.getElementById('hfs-generate') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('save cancelled'));
  expect((document.getElementById('hfs-show-config') as HTMLButtonElement).disabled).toBe(true);
  expect((document.getElementById('hfs-generate') as HTMLButtonElement).disabled).toBe(false);
  expect(document.body.textContent).not.toContain('private-test-secret');
});

it('offers explicit authorization for an older HTTP client without a pairing code button', async () => {
  fixture.send.mockResolvedValue({ ...state(true), httpClients: [{ id: 'http_client_00000001', name: 'Older client', approved: false }] });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelector('#http-clients')!.textContent).toContain('Authorize & export'));
  expect(document.querySelector('#http-clients')!.textContent).not.toContain('Show pairing code');
  expect([...document.querySelectorAll<HTMLButtonElement>('#http-clients button')].filter(button => button.textContent?.startsWith('Copy')).every(button => button.disabled)).toBe(true);
});

it.each(['url', 'authorization'] as const)('copies HTTP %s only on click without rendering its value', async field => {
  const value = field === 'url' ? 'http://127.0.0.1:39861/pac/v1/mcp/instance_00000001/http_client_00000001' : 'Bearer private-client-secret';
  fixture.send.mockImplementation(async message => message.action === 'hfs-client-value' ? { ok: true, value } :
    { ...state(true), httpClients: [{ id: 'http_client_00000001', name: 'HTTP Test', approved: true }] });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelectorAll('#http-clients button')).toHaveLength(4));
  expect(fixture.send.mock.calls.some(([message]) => message.action === 'hfs-client-value')).toBe(false);
  expect(fixture.write).not.toHaveBeenCalled();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('#http-clients button')];
  expect(buttons.map(button => button.textContent)).toEqual(['Copy URL', 'Copy Authorization', 'Export config', 'Revoke']);
  buttons[field === 'url' ? 0 : 1]!.click();
  await vi.waitFor(() => expect(fixture.write).toHaveBeenCalledExactlyOnceWith(value));
  expect(fixture.send).toHaveBeenCalledWith({ type: 'mcp-ui-v1', action: 'hfs-client-value', clientId: 'http_client_00000001', field });
  expect(document.getElementById('status')!.textContent).toBe('Copied');
  expect(document.body.textContent).not.toContain(value);
  expect((document.getElementById('output') as HTMLTextAreaElement).value).toBe('');
});

it('keeps credential clipboard errors private and leaves settings usable', async () => {
  fixture.send.mockImplementation(async message => message.action === 'hfs-client-value' ? { ok: true, value: 'Bearer private-client-secret' } :
    { ...state(true), httpClients: [{ id: 'http_client_00000001', name: 'HTTP Test', approved: true }] });
  fixture.write.mockRejectedValue(new Error('private-client-secret'));
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelectorAll('#http-clients button')).toHaveLength(4));
  ([...document.querySelectorAll<HTMLButtonElement>('#http-clients button')].find(button => button.textContent === 'Copy Authorization'))!.click();
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('Could not copy'));
  expect(document.body.textContent).not.toContain('private-client-secret');
  expect((document.getElementById('hfs-add-client') as HTMLButtonElement).disabled).toBe(false);
});

it('disables HTTP copy when clipboard export is blocked by policy', async () => {
  fixture.send.mockResolvedValue({ ...state(true), httpClipboardAllowed: false, httpClients: [{ id: 'http_client_00000001', name: 'HTTP Test', approved: true }] });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelectorAll('#http-clients button')).toHaveLength(4));
  expect([...document.querySelectorAll<HTMLButtonElement>('#http-clients button')].filter(button => button.textContent?.startsWith('Copy')).every(button => button.disabled)).toBe(true);
});

it.each([['mac', 'Start HFS.command'], ['win', 'Start HFS.cmd'], ['linux', 'start-hfs.sh']])('downloads only YAML and the launcher for %s', async (os, filename) => {
  fixture.platform.mockResolvedValue({ os });
  fixture.send.mockImplementation(async message => message.action === 'hfs-generate' ? { ok: true, content: 'private-provider-secret' } : state(true));
  await import('@/entrypoints/mcp/main');
  const download = document.getElementById('hfs-generate') as HTMLButtonElement;
  await vi.waitFor(() => expect(download.disabled).toBe(false)); download.click();
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('HFS setup files saved'));
  expect(fixture.save.mock.calls.map(call => call[1])).toEqual(['config.yaml', filename]);
  expect((fixture.save.mock.calls[1]![0] as Blob).type).toBe('application/octet-stream');
  expect(fixture.send.mock.calls.some(([message]) => message.action === 'hfs-add-client')).toBe(false);
  download.click();
  await vi.waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(4));
});

it('retries only a cancelled launcher and never adds a client while downloading', async () => {
  const { DownloadCancelledError } = await import('@/src/download-errors');
  fixture.save.mockResolvedValueOnce(42).mockRejectedValueOnce(new DownloadCancelledError()).mockResolvedValue(43);
  fixture.send.mockImplementation(async message => message.action === 'hfs-generate' ? { ok: true, content: 'private-provider-secret' } : state(true));
  await import('@/entrypoints/mcp/main');
  const download = document.getElementById('hfs-generate') as HTMLButtonElement;
  await vi.waitFor(() => expect(download.disabled).toBe(false)); download.click();
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('only the launcher'));
  expect(download.disabled).toBe(false); download.click();
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('HFS setup files saved'));
  expect(fixture.save.mock.calls.map(call => call[1])).toEqual(['config.yaml', 'Start HFS.command', 'Start HFS.command']);
  expect(fixture.send.mock.calls.every(([message]) => ['read', 'hfs-generate'].includes(message.action))).toBe(true);
});

it('restarts the YAML download if the provider configuration changes after cancellation', async () => {
  const { DownloadCancelledError } = await import('@/src/download-errors');
  let content = 'first-provider-config';
  fixture.save.mockResolvedValueOnce(42).mockRejectedValueOnce(new DownloadCancelledError()).mockResolvedValue(43);
  fixture.send.mockImplementation(async message => message.action === 'hfs-generate' ? { ok: true, content } : state(true));
  await import('@/entrypoints/mcp/main');
  const download = document.getElementById('hfs-generate') as HTMLButtonElement;
  await vi.waitFor(() => expect(download.disabled).toBe(false)); download.click();
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('only the launcher'));
  content = 'replacement-provider-config'; download.click();
  await vi.waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(4));
  expect(fixture.save.mock.calls.map(call => call[1])).toEqual(['config.yaml', 'Start HFS.command', 'config.yaml', 'Start HFS.command']);
});

it('disables setup downloads until Local HTTP is enabled, then enables on opt-in', async () => {
  fixture.send.mockResolvedValue({ ...state(true), settings: { ...state(true).settings, hfs: { enabled: false, endpoint: 'http://127.0.0.1:39861' } } });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect((document.getElementById('hfs-enabled') as HTMLInputElement).disabled).toBe(false));
  const download = document.getElementById('hfs-generate') as HTMLButtonElement;
  expect(download.disabled).toBe(true);
  const checkbox = document.getElementById('hfs-enabled') as HTMLInputElement;
  checkbox.checked = true; checkbox.dispatchEvent(new Event('input', { bubbles: true }));
  expect(download.disabled).toBe(false);
});

it.each(['chrome', 'firefox'])('creates a client on %s without downloads, platform queries or download permission prompts', async browser => {
  vi.stubEnv('BROWSER', browser);
  let created = false;
  fixture.send.mockImplementation(async message => {
    if (message.action === 'hfs-add-client') { created = true; return { ok: true, clientId: 'new_client_00000001' }; }
    return { ...state(true), httpClients: created ? [{ id: 'new_client_00000001', name: 'My AI app', approved: true }] : [] };
  });
  await import('@/entrypoints/mcp/main');
  const add = document.getElementById('hfs-add-client') as HTMLButtonElement;
  await vi.waitFor(() => expect(add.disabled).toBe(false));
  expect(add.textContent).toBe('Add client'); add.click();
  await vi.waitFor(() => expect(document.querySelector('#http-clients')!.textContent).toContain('new_client_00000001'));
  expect(fixture.send).toHaveBeenCalledWith({ type: 'mcp-ui-v1', action: 'hfs-add-client', name: 'My AI app', endpoint: 'http://127.0.0.1:39861' });
  expect(fixture.save).not.toHaveBeenCalled(); expect(fixture.permissions).not.toHaveBeenCalled(); expect(fixture.platform).not.toHaveBeenCalled();
  expect(document.querySelector('#http-clients')!.textContent).toContain('Copy Authorization');
});

it('prevents double-click client creation and reenables the button after an error', async () => {
  let finish!: (result: unknown) => void;
  fixture.send.mockImplementation(message => message.action === 'hfs-add-client' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(state(true)));
  await import('@/entrypoints/mcp/main');
  const add = document.getElementById('hfs-add-client') as HTMLButtonElement;
  await vi.waitFor(() => expect(add.disabled).toBe(false)); add.click(); add.click();
  expect(add.disabled).toBe(true);
  expect(fixture.send.mock.calls.filter(([message]) => message.action === 'hfs-add-client')).toHaveLength(1);
  finish({ ok: false, code: 'invalid-request' });
  await vi.waitFor(() => expect(add.disabled).toBe(false));
  expect(fixture.save).not.toHaveBeenCalled();
});

it.each([false, true])('exports JSON only on request and preserves authorization on cancellation: %s', async cancel => {
  const { DownloadCancelledError } = await import('@/src/download-errors');
  if (cancel) fixture.save.mockRejectedValueOnce(new DownloadCancelledError());
  fixture.send.mockImplementation(async message => message.action === 'hfs-export-client'
    ? { ok: true, filename: 'page-as-context-hfs-client.json', content: '{"secret":"private-client-secret"}' }
    : { ...state(true), httpClients: [{ id: 'new_client_00000001', name: 'App', approved: true }] });
  await import('@/entrypoints/mcp/main');
  await vi.waitFor(() => expect(document.querySelectorAll('#http-clients button')).toHaveLength(4));
  expect(fixture.save).not.toHaveBeenCalled();
  [...document.querySelectorAll<HTMLButtonElement>('#http-clients button')].find(button => button.textContent === 'Export config')!.click();
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain(cancel ? 'client remains authorized' : 'configuration exported'));
  expect(fixture.save).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'page-as-context-hfs-client.json');
  expect((fixture.save.mock.calls[0]![0] as Blob).type).toBe('application/json;charset=utf-8');
  expect(fixture.send.mock.calls.some(([message]) => ['revoke', 'hfs-add-client'].includes(message.action))).toBe(false);
  expect(document.body.textContent).not.toContain('private-client-secret');
  expect([...document.querySelectorAll<HTMLButtonElement>('#http-clients button')].find(button => button.textContent === 'Copy Authorization')!.disabled).toBe(false);
});

it('rejects unsupported launcher platforms before generating a configuration', async () => {
  fixture.platform.mockResolvedValue({ os: 'android' }); fixture.send.mockResolvedValue(state(true));
  await import('@/entrypoints/mcp/main');
  const download = document.getElementById('hfs-generate') as HTMLButtonElement;
  await vi.waitFor(() => expect(download.disabled).toBe(false)); download.click();
  await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toContain('macOS, Windows and Linux'));
  expect(fixture.send.mock.calls.some(([message]) => message.action === 'hfs-generate')).toBe(false);
  expect(fixture.save).not.toHaveBeenCalled();
});
