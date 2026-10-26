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
