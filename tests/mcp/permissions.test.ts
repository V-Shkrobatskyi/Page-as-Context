// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { permissions: { request: fixture.request } } }));
import { requestMcpPermissions, mcpBrowserPermissions } from '@/src/mcp/permissions';
afterEach(() => { vi.unstubAllEnvs(); fixture.request.mockReset(); });
it.each([false, true])('requests Chrome MCP consent without additional tabs or host permissions (write=%s)', async write => {
  vi.stubEnv('BROWSER', 'chrome'); fixture.request.mockResolvedValue(false);
  expect(await requestMcpPermissions(write)).toBe(false);
  expect(mcpBrowserPermissions()).toEqual(['nativeMessaging']);
  expect(fixture.request).toHaveBeenCalledWith({ permissions: ['nativeMessaging'] });
});
it.each([false, true])('preserves Firefox transmission consent without Chrome tabs permission (write=%s)', async write => {
  vi.stubEnv('BROWSER', 'firefox'); fixture.request.mockResolvedValue(true);
  expect(await requestMcpPermissions(write)).toBe(true);
  expect(fixture.request).toHaveBeenCalledWith({ permissions: ['nativeMessaging'], data_collection:
    ['websiteContent', 'browsingActivity', 'personalCommunications', ...(write ? ['websiteActivity'] : [])] });
});
it.each(['chrome', 'firefox'])('requests only loopback access for HTTP-only %s without nativeMessaging', async target => {
  vi.stubEnv('BROWSER', target); fixture.request.mockResolvedValue(true);
  expect(await requestMcpPermissions(true, { nativeEnabled: false, hfs: { enabled: true, endpoint: 'http://127.0.0.1:39861' } })).toBe(true);
  expect(fixture.request).toHaveBeenCalledWith({ permissions: [], origins: ['http://127.0.0.1/*'], ...(target === 'firefox' ? { data_collection: ['websiteContent', 'browsingActivity', 'personalCommunications', 'websiteActivity'] } : {}) });
});
