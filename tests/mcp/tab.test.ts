// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ get: vi.fn(), targets: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { tabs: { get: fixture.get } } }));
import { getMcpTab, McpTabMetadataUnavailable } from '@/src/mcp/tab';
beforeEach(() => {
  vi.stubEnv('BROWSER', 'chrome'); vi.stubGlobal('chrome', { debugger: { getTargets: fixture.targets } });
  fixture.get.mockReset().mockResolvedValue({ id: 7, windowId: 1, active: true });
  fixture.targets.mockReset().mockResolvedValue([
    { type: 'page', tabId: 99, url: 'https://private.test/', title: 'Unshared private page' },
    { type: 'page', tabId: 7, url: 'https://example.test/new', title: 'Shared page' },
  ]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('resolves only the requested tab using existing debugger access without attaching', async () => {
  expect(await getMcpTab(7)).toEqual({ id: 7, windowId: 1, active: true, url: 'https://example.test/new', title: 'Shared page' });
  expect(fixture.targets).toHaveBeenCalledOnce();
});
it('does not use debugger metadata when normal tab metadata is available', async () => {
  fixture.get.mockResolvedValue({ id: 7, url: 'https://example.test/', title: 'Current page' });
  expect((await getMcpTab(7)).title).toBe('Current page'); expect(fixture.targets).not.toHaveBeenCalled();
});
it.each(['firefox', 'incognito', 'discarded'])('does not resolve Chrome targets for %s', async reason => {
  if (reason === 'firefox') vi.stubEnv('BROWSER', 'firefox');
  else fixture.get.mockResolvedValue({ id: 7, [reason]: true });
  expect((await getMcpTab(7)).url).toBeUndefined(); expect(fixture.targets).not.toHaveBeenCalled();
});
it.each(['missing', 'duplicate', 'error', 'changed'])('fails closed for %s target metadata', async reason => {
  if (reason === 'missing') fixture.targets.mockResolvedValue([{ type: 'page', tabId: 99, url: 'https://private.test/', title: 'Private' }]);
  if (reason === 'duplicate') fixture.targets.mockResolvedValue(Array(2).fill({ type: 'page', tabId: 7, url: 'https://example.test/', title: 'Ambiguous' }));
  if (reason === 'error') fixture.targets.mockRejectedValue(new Error('Internal details'));
  if (reason === 'changed') fixture.get.mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce({ id: 7, url: 'https://other.test/' });
  await expect(getMcpTab(7)).rejects.toBeInstanceOf(McpTabMetadataUnavailable);
});
