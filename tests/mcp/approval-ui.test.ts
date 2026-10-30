// @vitest-environment jsdom
// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ send: vi.fn(), remove: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { sendMessage: fixture.send },
  tabs: { getCurrent: async () => ({ id: 9 }), remove: fixture.remove },
} }));
beforeEach(() => {
  fixture.send.mockReset(); fixture.remove.mockReset(); fixture.remove.mockResolvedValue(undefined);
  document.body.innerHTML = readFileSync('entrypoints/mcp-approval/index.html', 'utf8').split(/<body\b[^>]*>/u)[1]!.split('</body>')[0]!;
});
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.resetModules(); });

it.each([true, false])('shows connection approval only when the background permits it: %s', async allowed => {
  fixture.send.mockResolvedValue({ ok: true, action: 'click', target: 'Test button', expires: Date.now() + 45000, sessionApprovalAllowed: allowed });
  await import('@/entrypoints/mcp-approval/main');
  await vi.waitFor(() => expect((document.getElementById('allow') as HTMLButtonElement).disabled).toBe(false));
  const button = document.getElementById('allow-connection') as HTMLButtonElement;
  expect(button.hidden).toBe(!allowed); expect(button.disabled).toBe(!allowed);
  expect(document.getElementById('connection-note')!.hidden).toBe(!allowed);
});

it.each(['allow', 'allow-connection', 'deny'])('sends the correct scope for %s without duplicate answers', async id => {
  fixture.send.mockResolvedValue({ ok: true, action: 'click', target: 'Test button', expires: Date.now() + 45000, sessionApprovalAllowed: true });
  await import('@/entrypoints/mcp-approval/main');
  const button = document.getElementById(id) as HTMLButtonElement;
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  button.click(); button.click();
  await vi.waitFor(() => expect(fixture.remove).toHaveBeenCalledWith(9));
  expect(fixture.send.mock.calls.filter(([request]) => request.action === 'approval-answer')).toEqual([[{
    type: 'mcp-ui-v1', action: 'approval-answer', allow: id !== 'deny', ...(id === 'allow-connection' ? { scope: 'connection' } : {}),
  }]]);
});
