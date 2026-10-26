// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { OperationLedger, actionArguments } from '@/src/mcp/operations';
import { prepareExport } from '@/src/core/export';
import { COMPRESSION_LEVELS } from '@/src/core/contracts';
import { createDomActionRegistry, dispatchDomAction } from '@/src/adapters/firefox/actions';
import type { SemanticNode, SemanticTree } from '@/src/core/model';
import type { ActionLease } from '@/src/adapters/actions/contract';

afterEach(() => vi.restoreAllMocks());
const id = () => crypto.randomUUID();
describe('action contract and receipt ledger', () => {
  it('rejects selectors, overrides and malformed operation arguments', () => {
    const args = { connectionId: id(), snapshotId: id(), elementRef: id(), operationId: id() };
    expect(actionArguments('click_element', args).action).toBe('click');
    for (const value of [{ ...args, selector: '#button' }, { ...args, mode: 'read-write' }, { ...args, operationId: 1 }]) expect(() => actionArguments('click_element', value)).toThrow();
    expect(() => actionArguments('fill_element', { ...args, text: 'x'.repeat(10001) })).toThrow();
    expect(() => actionArguments('set_checked', { ...args, checked: 'true' })).toThrow();
  });
  it('coalesces concurrent retries, caches status without page payload and rejects ID reuse', async () => {
    const ledger = new OperationLedger(), grant = id();
    const args = { action: 'fill' as const, snapshotId: id(), elementRef: id(), operationId: id(), text: 'synthetic secret' };
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const run = vi.fn(async () => { await gate; return { operationId: args.operationId, status: 'applied' as const, snapshotId: id(), snapshot: { context: 'private page payload' } }; });
    const first = ledger.execute(grant, args, run);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const second = ledger.execute(grant, args, run); finish();
    expect((await first).status).toBe('applied');
    expect(await second).not.toHaveProperty('snapshot'); expect(run).toHaveBeenCalledTimes(1);
    expect(await ledger.execute(grant, args, run)).not.toHaveProperty('snapshot');
    await expect(ledger.execute(grant, { ...args, text: 'different' }, run)).rejects.toThrow('operation-id-reused');
  });
  it('turns an unexpected execution failure into an unknown receipt and never reruns it', async () => {
    const ledger = new OperationLedger(), args = { action: 'click' as const, snapshotId: id(), elementRef: id(), operationId: id() }, run = vi.fn(async () => { throw new Error('raw exception'); });
    expect((await ledger.execute('grant', args, run)).status).toBe('outcome-unknown');
    expect((await ledger.execute('grant', args, run)).status).toBe('outcome-unknown'); expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('action-safe privacy projection', () => {
  it('preserves distinct repeated controls and exact character counts in both formats and every level', () => {
    const refs = [id(), id(), id()];
    const tree: SemanticTree = { schemaVersion: 1, root: { role: 'page', children: refs.map(actionRef => ({ role: 'button', name: 'Same control', actionRef, children: [] })) } };
    for (const level of COMPRESSION_LEVELS) for (const format of ['semantic-text', 'markdown'] as const) {
      const result = prepareExport(tree, level, format, true, undefined, undefined, { profile: 'agent-context' });
      expect(result.actionTargets?.map(target => target.ref).sort()).toEqual([...refs].sort());
      for (const ref of refs) expect(result.serialized.content.split(ref)).toHaveLength(2);
      expect(result.characterCount).toBe(result.serialized.content.length);
    }
  });
  it('removes refs for hidden or redacted target text and options removed by data controls', () => {
    const ref = id(), option = id();
    const tree: SemanticTree = { schemaVersion: 1, root: { role: 'page', children: [{ role: 'textbox', name: 'Token', value: 'SYNTHETIC-PRIVATE-TOKEN', actionRef: ref, children: [] },
      { role: 'combobox', name: 'Choice', children: [{ role: 'option', actionRef: option, name: 'Hidden choice', children: [] }] }] } };
    const result = prepareExport(tree, 'compact', 'semantic-text', true, undefined, { includeTitle: true, includeFormValues: false, pageUrl: 'omit', linkUrls: 'omit' }, { profile: 'agent-context' });
    expect(result.serialized.content).not.toContain(option); expect(result.serialized.content).not.toContain(ref); expect(result.serialized.content).not.toContain('PRIVATE');
    const redacted = prepareExport(tree, 'compact', 'semantic-text', true, undefined, undefined, { profile: 'agent-context' });
    expect(redacted.serialized.content).not.toContain(ref);
  });
});

describe('isolated DOM action identity and bounded operations', () => {
  function fixture() {
    const dom = new JSDOM('<main><button>Same</button><button>Same</button><label>Name<input id="name"></label><label>Password<input type="password"></label><input type="checkbox"><select><option>First</option><option>Second</option></select></main>', { url: 'https://example.test/', pretendToBeVisual: true });
    const doc = dom.window.document;
    for (const element of doc.querySelectorAll<HTMLElement>('*')) {
      element.scrollIntoView = () => {};
      element.getBoundingClientRect = () => ({ x: 10, y: 10, left: 10, top: 10, right: 80, bottom: 40, width: 70, height: 30, toJSON() {} });
    }
    const lease: ActionLease = { owner: id(), snapshotId: id(), expires: Date.now() + 10000 };
    const remember = createDomActionRegistry(doc), refs = new Map<Element, string>();
    for (const element of doc.querySelectorAll('button,input,select,option')) {
      const node: SemanticNode = { role: element.localName === 'button' ? 'button' : element.localName === 'option' ? 'option' : element.localName === 'select' ? 'combobox' : (element as HTMLInputElement).type === 'checkbox' ? 'checkbox' : 'textbox', name: element.textContent || element.getAttribute('type') || element.id, children: [] };
      remember(lease, element, node); if (node.actionRef) refs.set(element, node.actionRef);
    }
    const send = (element: Element, action: 'click' | 'fill' | 'select-option' | 'set-checked', extras: object = {}) => {
      doc.elementFromPoint = () => element;
      return (dom.window as any).__pageAsContextActions({ mode: 'apply', lease, deadline: Date.now()+5000, command: { action, snapshotId: lease.snapshotId, elementRef: refs.get(element), ...extras } });
    };
    const close = () => { (dom.window as any).__pageAsContextActions({ mode: 'release', lease }); dom.window.close(); };
    return { dom, doc, lease, refs, send, close };
  }
  it('distinguishes same labels, refuses replaced nodes and releases every handle', () => {
    const f = fixture(); try {
      const buttons = [...f.doc.querySelectorAll('button')]; expect(f.refs.get(buttons[0]!)).not.toBe(f.refs.get(buttons[1]!));
      const clicked = vi.fn(); buttons[1]!.addEventListener('click', clicked);
      expect(f.send(buttons[1]!, 'click').status).toBe('applied'); expect(clicked).toHaveBeenCalledTimes(1);
      buttons[1]!.replaceWith(buttons[1]!.cloneNode(true)); expect(f.send(buttons[1]!, 'click').found).toBe(false);
      expect(f.refs.has(f.doc.querySelector('[type=password]')!)).toBe(false);
    } finally { f.close(); }
  });
  it('fills native text, sets desired checkbox without a blind toggle, selects an exact option and rejects overlays', () => {
    const f = fixture(); try {
      const input = f.doc.getElementById('name') as HTMLInputElement;
      expect(f.send(input, 'fill', { text: 'replacement' }).status).toBe('applied'); expect(input.value).toBe('replacement');
      const checkbox = f.doc.querySelector('[type=checkbox]') as HTMLInputElement, changed = vi.fn(); checkbox.addEventListener('change', changed);
      expect(f.send(checkbox, 'set-checked', { checked: true }).status).toBe('applied');
      expect(f.send(checkbox, 'set-checked', { checked: true }).status).toBe('applied'); expect(changed).toHaveBeenCalledTimes(1);
      const select = f.doc.querySelector('select')!;
      expect(f.send(select, 'select-option', { optionRef: f.refs.get(select.options[1]!) }).status).toBe('applied'); expect(select.selectedIndex).toBe(1);
      const button = f.doc.querySelector('button')!; f.doc.elementFromPoint = () => input;
      expect((f.dom.window as any).__pageAsContextActions({ mode: 'apply', lease: f.lease, deadline: Date.now()+5000, command: { action: 'click', snapshotId: f.lease.snapshotId, elementRef: f.refs.get(button) } }).status).toBe('rejected');
      const fake = { ...f.lease, owner: id() }; expect((f.dom.window as any).__pageAsContextActions({ mode: 'locate', lease: fake, command: { elementRef: f.refs.get(button) } }).found).toBe(false);
    } finally { f.close(); }
  });
});
