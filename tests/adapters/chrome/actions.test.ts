// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';
import { createChromeActionSnapshot, rememberChromeTarget } from '@/src/adapters/chrome/actions';
import { normalizeChromeAxTree } from '@/src/adapters/chrome/normalize-ax';
import type { ChromeAxNode, ChromeAxValue } from '@/src/adapters/chrome/types';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture(name: ChromeAxValue | undefined, currentName = name, overrides: Partial<ChromeAxNode> = {}, action: 'click' | 'fill' | 'set-checked' | 'select-option' = 'fill') {
  const lease = { owner: crypto.randomUUID(), snapshotId: crypto.randomUUID(), expires: Date.now() + 10000 };
  const snapshot = createChromeActionSnapshot(7, lease);
  const frame = { id: 'iframe', loaderId: 'loader', targetId: 'oopif' };
  let ref = '', optionRef: string | undefined;
  const result = normalizeChromeAxTree({ nodes: [{ nodeId: 'root', role: { value: 'RootWebArea' }, childIds: ['control', ...(action === 'select-option' ? ['option'] : [])] },
    { nodeId: 'control', role: { value: action === 'fill' ? 'textbox' : action === 'set-checked' ? 'checkbox' : 'combobox' }, name, backendDOMNodeId: 42 },
    ...(action === 'select-option' ? [{ nodeId: 'option', role: { value: 'option' }, name, backendDOMNodeId: 43 }] : [])] }, { onNode(raw, node) {
    rememberChromeTarget(lease, raw, node, frame);
    if (node.actionRef) { snapshot.targets.set(node.actionRef, { ref: node.actionRef, role: node.role, name: node.name }); if (raw.nodeId === 'control') ref = node.actionRef; else optionRef = node.actionRef; }
  } });
  expect(result.ok).toBe(true);
  const commands: string[] = [];
  const sendCommand = vi.fn((_target, method, params, done) => {
    commands.push(method);
    const response = method === 'Target.attachToTarget' ? { sessionId: 'child' }
      : method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'iframe', loaderId: 'loader' } } }
      : method === 'Page.createIsolatedWorld' ? { executionContextId: 9 }
      : method === 'Accessibility.getPartialAXTree' ? { nodes: [{ nodeId: 'control', backendDOMNodeId: params.backendNodeId, name: currentName, ...overrides }] }
      : method === 'DOM.resolveNode' ? { object: { objectId: `object-${params.backendNodeId}` } }
      : method === 'Runtime.callFunctionOn' ? { result: { value: action === 'click' ? { x: 25, y: 40 } : { applied: true } } } : {};
    done(response);
  });
  vi.stubGlobal('chrome', { runtime: {}, debugger: { attach: (_t: unknown, _v: unknown, done: () => void) => done(), sendCommand, detach: vi.fn((_t, done) => done()) } });
  return { snapshot, commands, sendCommand, lease, run: () => snapshot.run({ action, snapshotId: lease.snapshotId, elementRef: ref, optionRef, text: 'example', checked: true }, new AbortController().signal, async () => {}) };
}
it.each([[undefined, undefined], [{ value: '' }, { value: '' }], [undefined, { value: '' }], [{ value: '' }, undefined], [{ value: ' ' }, { value: ' ' }], [{ value: 'Name' }, { value: 'Name' }]])('fills an unchanged name: %j → %j', async (name, current) => {
  const f = fixture(name, current);
  try { expect(await f.run()).toEqual({ status: 'applied' }); expect(f.commands).toContain('Runtime.callFunctionOn'); expect(f.commands).toContain('Target.detachFromTarget'); expect(f.commands.at(-1)).toBe('Target.detachFromTarget'); }
  finally { f.snapshot.dispose(); }
});
it.each([{ value: 'renamed' }, { value: 123 }, { value: null }])('rejects changed or invalid names before mutation: %j', async current => {
  const f = fixture({ value: '' }, current as ChromeAxValue);
  try { expect(await f.run()).toEqual({ status: 'rejected', error: 'stale-snapshot' }); expect(f.commands).not.toContain('Runtime.callFunctionOn'); expect(f.commands).toContain('Runtime.releaseObjectGroup'); }
  finally { f.snapshot.dispose(); }
});
it.each([{ ignored: true }, { backendDOMNodeId: 999 }])('rejects changed identity: %j', async override => {
  const f = fixture({ value: '' }, { value: '' }, override);
  try { expect((await f.run()).error).toBe('stale-snapshot'); expect(f.commands).not.toContain('Runtime.callFunctionOn'); } finally { f.snapshot.dispose(); }
});
it.each(['set-checked', 'select-option'] as const)('uses the same normalization for %s and option resolution', async action => {
  const f = fixture({ value: '' }, { value: '' }, {}, action);
  try { expect((await f.run()).status).toBe('applied'); expect(f.commands.filter(value => value === 'DOM.resolveNode')).toHaveLength(action === 'select-option' ? 2 : 1); } finally { f.snapshot.dispose(); }
});
it('rejects disposed snapshots without attaching', async () => {
  const f = fixture({ value: '' }); f.snapshot.dispose();
  expect((await f.run()).error).toBe('stale-snapshot'); expect(f.commands).toEqual([]);
});

it('rejects an expired lease without resolving or mutating a control', async () => {
  const f = fixture({ value: '' });
  vi.spyOn(Date, 'now').mockReturnValue(f.lease.expires + 1);
  try { expect((await f.run()).error).toBe('stale-snapshot'); expect(f.commands).toEqual([]); } finally { f.snapshot.dispose(); }
});
it.each([{ id: 'iframe', loaderId: 'different-loader' }, { id: 'different-frame', loaderId: 'loader' }])('rejects changed frame identity before resolution: %j', async frame => {
  const f = fixture({ value: '' }), original = f.sendCommand.getMockImplementation()!;
  f.sendCommand.mockImplementation((target, method, params, done) => {
    if (method === 'Page.getFrameTree') { f.commands.push(method); done({ frameTree: { frame } }); }
    else original(target, method, params, done);
  });
  try { expect((await f.run()).error).toBe('stale-snapshot'); expect(f.commands).not.toContain('DOM.resolveNode'); expect(f.commands).toContain('Target.detachFromTarget'); } finally { f.snapshot.dispose(); }
});

it('dispatches one pointer pair for a click and prunes addresses omitted from the response', async () => {
  const f = fixture({ value: 'Next' }, undefined, {}, 'click');
  try {
    expect(await f.run()).toEqual({ status: 'applied' });
    expect(f.commands.filter(method => method === 'Input.dispatchMouseEvent')).toHaveLength(2);
    expect(f.sendCommand.mock.calls.filter(([, method]) => method === 'Input.dispatchMouseEvent').map(([, , params]) => params.type)).toEqual(['mousePressed', 'mouseReleased']);
    await f.snapshot.retainOnly!([]);
    expect(await f.run()).toEqual({ status: 'rejected', error: 'stale-snapshot' });
    expect(f.commands.filter(method => method === 'Input.dispatchMouseEvent')).toHaveLength(2);
  } finally { f.snapshot.dispose(); }
});
it.each(['before-dispatch', 'after-dispatch'])('distinguishes click failure %s and releases CDP resources', async when => {
  const f = fixture({ value: 'Next' }, undefined, {}, 'click'), original = f.sendCommand.getMockImplementation()!;
  f.sendCommand.mockImplementation((target, method, params, done) => {
    if (when === 'before-dispatch' && method === 'Runtime.callFunctionOn') { f.commands.push(method); done({ result: { value: { error: 'unsupported-action' } } }); }
    else if (when === 'after-dispatch' && method === 'Input.dispatchMouseEvent') { f.commands.push(method); (globalThis as any).chrome.runtime.lastError = { message: 'transport lost' }; done(undefined); delete (globalThis as any).chrome.runtime.lastError; }
    else original(target, method, params, done);
  });
  try {
    expect((await f.run()).status).toBe(when === 'before-dispatch' ? 'rejected' : 'outcome-unknown');
    expect(f.commands.filter(method => method === 'Input.dispatchMouseEvent')).toHaveLength(when === 'before-dispatch' ? 0 : 1);
    expect(f.commands).toContain('Runtime.releaseObjectGroup'); expect(f.commands).toContain('Target.detachFromTarget');
  } finally { f.snapshot.dispose(); }
});
