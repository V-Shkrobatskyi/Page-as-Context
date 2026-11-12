// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { setImmediate } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { OperationLedger } from '@/src/mcp/operations';
import { createDomActionRegistry } from '@/src/adapters/firefox/actions';
import { createChromeActionSnapshot, rememberChromeTarget } from '@/src/adapters/chrome/actions';

async function collected(refs: WeakRef<object>[]) {
  for (let attempt = 0; attempt < 20; attempt++) { await setImmediate(); global.gc!(); if (refs.every(ref => ref.deref() === undefined)) return true; }
  return false;
}
it('action registries do not retain removed DOM controls or captured semantic nodes', async () => {
  const refs: WeakRef<object>[] = [], dom = new JSDOM('<main></main>', { url: 'https://example.test/' });
  const lease = { owner: crypto.randomUUID(), snapshotId: crypto.randomUUID(), expires: Date.now() + 60000 };
  const remember = createDomActionRegistry(dom.window.document), chrome = createChromeActionSnapshot(7, lease);
  try {
    const capture = () => {
      const element = dom.window.document.createElement('button'); element.textContent = 'Synthetic'; dom.window.document.body.append(element);
      const node = { role: 'button', name: 'Synthetic', children: [] };
      refs.push(new WeakRef(element), new WeakRef(node));
      remember(lease, element, node); element.remove();
      rememberChromeTarget(lease, { nodeId: 'synthetic', backendDOMNodeId: 42 }, node, { id: 'frame', loaderId: 'document' });
    };
    capture();
    expect(await collected(refs)).toBe(true);
  } finally { chrome.dispose(); (dom.window as any).__pageAsContextActions({ mode: 'release', lease }); dom.window.close(); }
});
it('operation receipts never retain full post-action snapshots or input argument objects', async () => {
  const ledger = new OperationLedger(), refs: WeakRef<object>[] = [];
  const action = async () => {
    const args = { action: 'fill' as const, elementRef: crypto.randomUUID(), snapshotId: crypto.randomUUID(), operationId: crypto.randomUUID(), text: 'synthetic input' };
    const snapshot = { context: 'synthetic private page data' }; refs.push(new WeakRef(args), new WeakRef(snapshot));
    await ledger.execute('grant', args, async () => ({ status: 'applied' as const, operationId: args.operationId, snapshot }));
  };
  await action(); expect(await collected(refs)).toBe(true); ledger.clear();
});

it('batch receipt caching releases nested input actions and full page context', async () => {
  const ledger = new OperationLedger(), refs: WeakRef<object>[] = [];
  const invoke = async () => {
    const actions = [{ action: 'fill' as const, elementRef: crypto.randomUUID(), text: 'synthetic batch input' }];
    const args = { action: 'batch' as const, operationId: crypto.randomUUID(), connectionId: crypto.randomUUID(), snapshotId: crypto.randomUUID(), actions };
    const snapshot = { context: { page: 'synthetic page payload' } };
    refs.push(new WeakRef(args), new WeakRef(actions), new WeakRef(actions[0]!), new WeakRef(snapshot), new WeakRef(snapshot.context));
    await ledger.execute('grant', args, async () => ({ operationId: args.operationId, status: 'partial' as const, actions: [
      { index: 0, status: 'applied' as const }, { index: 1, status: 'not-started' as const },
    ], snapshot }));
  };
  await invoke(); expect(await collected(refs)).toBe(true); ledger.clear();
});

it('targeted projection releases operation-local trees after found, ambiguity, partial and bounds failure', async () => {
  const { projectTargetRead } = await import('@/src/mcp/targeted-read');
  const refs: WeakRef<object>[] = [];
  const read = (mode: string) => {
    const field = { role: 'textbox', name: 'Public field', children: [] };
    const tree = { schemaVersion: 1 as const, root: { role: 'page', children: [field, ...(mode === 'ambiguous' ? [{ ...field }] : []),
      ...(mode === 'large' ? [{ role: 'paragraph', name: 'x'.repeat(600000), children: [] }] : [])] } };
    const result = projectTargetRead(tree, { target: { role: 'textbox', name: 'Public field' } }, mode === 'partial');
    refs.push(new WeakRef(tree), new WeakRef(field), new WeakRef(result.tree), new WeakRef(result.info));
  };
  for (const mode of ['found', 'ambiguous', 'partial', 'large']) read(mode);
  expect(await collected(refs)).toBe(true);
});
