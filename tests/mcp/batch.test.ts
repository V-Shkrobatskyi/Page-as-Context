// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { batchArguments, OperationLedger, type BatchAction, type BatchCommand } from '@/src/mcp/operations';
import { executeBatch, batchChangeAllowed, type BatchCapture, type BatchPort } from '@/src/mcp/batch';
import { validateToolArguments, toolCatalog, toolResult } from '../../helper/src/catalog.mjs';
import { prepareExport } from '@/src/core/export';
import { createDomActionRegistry } from '@/src/adapters/firefox/actions';
import type { SemanticTree, SemanticNode } from '@/src/core/model';
import type { ActionSnapshot, ActionOutcome } from '@/src/adapters/actions/contract';
const id = () => crypto.randomUUID();
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); });
function fixture(count = 3, mixed = false) {
  const dom = new JSDOM(`<main>${Array.from({ length: count }, (_, index) => `<label>Field ${index}<input></label>`).join('')}${mixed ? '<label>Choice<select><option>First</option><option>Second</option></select></label><label>Enabled<input type="checkbox"></label>' : ''}<p role="status">Ready</p></main>`, { url: 'https://fixture.test/', pretendToBeVisual: true });
  const doc = dom.window.document, remember = createDomActionRegistry(doc), owner = id(), abort = new AbortController();
  const inputs = [...doc.querySelectorAll<HTMLInputElement>('input:not([type=checkbox])')];
  let active: BatchCapture<string> | undefined, afterApply = () => {}, beforeCapture = () => {};
  let failure: ActionOutcome | undefined, includeFormValues = true, failCapture = false, access = true, partial = false;
  const port: BatchPort<string> = {
    signal: abort.signal, validate: vi.fn(async () => { if (!access || abort.signal.aborted) throw new Error('no-access'); }),
    approve: vi.fn(async () => 'allowed'), applied: vi.fn(),
    invalidate: vi.fn(() => active?.snapshot.dispose()),
    capture: vi.fn(async () => {
      if (failCapture) throw new Error('capture-failed'); beforeCapture(); active?.snapshot.dispose();
      const lease = { owner, snapshotId: id(), expires: Date.now() + 60000 };
      const build = (element: HTMLInputElement | HTMLSelectElement | HTMLOptionElement): SemanticNode => {
        const role = element.localName === 'option' ? 'option' : element.localName === 'select' ? 'combobox' : (element as HTMLInputElement).type === 'checkbox' ? 'checkbox' : 'textbox';
        const node: SemanticNode = { role, name: role === 'option' ? element.textContent! : element.closest('label')!.firstChild!.textContent!,
          ...(role === 'option' ? {} : { value: element.value }), states: { disabled: element.disabled,
            ...(role === 'checkbox' ? { checked: (element as HTMLInputElement).checked } : {}),
            ...(role === 'option' ? { selected: (element as HTMLOptionElement).selected } : {}),
            ...(role === 'textbox' ? { readOnly: (element as HTMLInputElement).readOnly } : {}) }, children: element.localName === 'select' ? [...(element as HTMLSelectElement).options].map(build) : [] };
        remember(lease, element, node); return node;
      };
      const tree: SemanticTree = { schemaVersion: 1, sourceUrl: doc.location.href, root: { role: 'page', children: [
        ...[...doc.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')].map(build),
        { role: 'status', name: doc.querySelector('[role=status]')!.textContent!, children: [] },
      ] } };
      let safe!: SemanticTree;
      const output = prepareExport(tree, 'compact', 'semantic-text', true, undefined, { includeFormValues, includeTitle: true, pageUrl: 'omit', linkUrls: 'omit' }, { profile: 'agent-context' }, value => { safe = value; });
      const snapshot: ActionSnapshot = { ...lease, tabId: 1, targets: new Map(output.actionTargets?.map(target => [target.ref, target])),
        dispose: vi.fn(() => { snapshot.targets.clear(); (dom.window as any).__pageAsContextActions({ mode: 'release', lease }); }),
        run: vi.fn(async (command, signal, authorize) => {
          await authorize(); if (signal.aborted) throw new Error('aborted');
          const node = output.actionTargets!.find(target => target.ref === command.elementRef)!;
          expect(node).toBeDefined();
          // Registry identities are the same ones issued by this synthetic capture.
          const index = tree.root.children.findIndex(item => item.actionRef === command.elementRef);
          const element = [...doc.querySelectorAll<HTMLElement>('input,select')][index]!;
          doc.elementFromPoint = () => element;
          if (failure?.status === 'rejected') return failure;
          const outcome = (dom.window as any).__pageAsContextActions({ mode: 'apply', lease, command, deadline: Date.now() + 5000 });
          afterApply(); return failure ?? outcome;
        }),
      };
      active = { snapshot, tree: partial ? undefined : safe, payload: output.serialized.content }; return active;
    }),
  };
  for (const element of doc.querySelectorAll<HTMLElement>('input,select,option')) {
    element.scrollIntoView = () => {}; element.getBoundingClientRect = () => ({ left: 10, top: 10, width: 100, height: 30 } as DOMRect);
  }
  cleanups.push(() => { active?.snapshot.dispose(); dom.window.close(); });
  const request = async () => {
    const initial = (await port.capture()).snapshot;
    const targets = [...initial.targets.values()];
    const actions: BatchAction[] = inputs.map((_, index) => ({ action: 'fill', elementRef: targets.find(target => target.name === `Field ${index}`)!.ref, text: index === 1 ? '' : `Synthetic 🌻 ${index}` }));
    if (mixed) {
      actions.push({ action: 'select-option', elementRef: targets.find(target => target.role === 'combobox')!.ref, optionRef: targets.find(target => target.name === 'Second')!.ref });
      actions.push({ action: 'set-checked', elementRef: targets.find(target => target.role === 'checkbox')!.ref, checked: true });
    }
    const command: BatchCommand = { action: 'batch', connectionId: id(), snapshotId: initial.snapshotId, operationId: id(), actions };
    return { initial, command };
  };
  return { doc, inputs, port, abort, request, afterApply(fn: () => void) { afterApply = fn; }, beforeCapture(fn: () => void) { beforeCapture = fn; },
    failure(outcome: ActionOutcome) { failure = outcome; }, hideValues() { includeFormValues = false; }, revoke() { access = false; }, partial() { partial = true; }, failCapture() { failCapture = true; } };
}

describe('write_elements input contract', () => {
  it('does not hide structural live-region changes or outside node replacements as validation text', () => {
    const before: SemanticTree = { schemaVersion: 1, root: { role: 'page', children: [
      { role: 'textbox', name: 'First', value: '', captureIdentity: 'first', actionRef: id(), children: [] },
      { role: 'textbox', name: 'Second', value: '', captureIdentity: 'second', actionRef: id(), children: [] },
      { role: 'status', name: 'Ready', children: [] },
    ] } };
    const action: BatchAction = { action: 'fill', elementRef: before.root.children[0]!.actionRef!, text: 'new' };
    const after = structuredClone(before); after.root.children[0]!.value = 'new'; after.root.children[2]!.name = 'Updated';
    expect(batchChangeAllowed(before, after, 'first', action)).toBe(true);
    after.root.children[1]!.captureIdentity = 'replacement'; expect(batchChangeAllowed(before, after, 'first', action)).toBe(false);
    after.root.children[1]!.captureIdentity = 'second';
    after.root.children[2]!.children.push({ role: 'textbox', name: 'New dependent field', children: [] });
    expect(batchChangeAllowed(before, after, 'first', action)).toBe(false);
  });
  const args = () => ({ connectionId: id(), snapshotId: id(), operationId: id(), actions: [{ action: 'fill', elementRef: id(), text: 'value' }] });
  it('uses the explicit list size, without count, modes, scripts or implicit actions', () => {
    expect(batchArguments(args()).action).toBe('batch');
    expect(toolCatalog().find(tool => tool.name === 'write_elements')!.inputSchema.required).toEqual(['connectionId', 'snapshotId', 'operationId', 'actions']);
  });
  it.each(['empty', 'eleven', 'click', 'duplicate', 'count', 'nested-connection', 'response-mode', 'too-much-text', 'request-bytes', 'wrong-checked'] as const)('rejects %s at the common catalog boundary', kind => {
    const value: any = args();
    if (kind === 'empty') value.actions = [];
    if (kind === 'eleven') value.actions = Array.from({ length: 11 }, () => ({ action: 'fill', elementRef: id(), text: '' }));
    if (kind === 'click') value.actions = [{ action: 'click', elementRef: id() }];
    if (kind === 'duplicate') value.actions.push({ ...value.actions[0] });
    if (kind === 'count') value.count = 1;
    if (kind === 'nested-connection') value.actions[0].connectionId = id();
    if (kind === 'response-mode') value.actions[0].responseMode = 'full';
    if (kind === 'too-much-text') value.actions = Array.from({ length: 3 }, () => ({ action: 'fill', elementRef: id(), text: 'x'.repeat(10000) }));
    if (kind === 'request-bytes') value.actions = Array.from({ length: 10 }, () => ({ action: 'fill', elementRef: id(), text: '\u0000'.repeat(2000) }));
    if (kind === 'wrong-checked') value.actions = [{ action: 'set-checked', elementRef: id(), checked: 'true' }];
    expect(() => validateToolArguments('write_elements', value)).toThrow('invalid-request'); expect(() => batchArguments(value)).toThrow('invalid-request');
  });
});

describe('sequential engine with the real isolated DOM registry and native setters', () => {
  it.each([1, 5, 10])('fills %s fields, returns full context and releases prior registries', async count => {
    const f = fixture(count), { initial, command } = await f.request();
    const result = await executeBatch(command, initial, f.port);
    expect(result.status).toBe('applied'); expect(result.actions?.map(step => step.status)).toEqual(Array(count).fill('applied'));
    expect(f.inputs.map(input => input.value)).toEqual(command.actions.map(item => item.action === 'fill' ? item.text : ''));
    expect(result.snapshot).toContain(`Field ${count - 1}`); expect(initial.targets.size).toBe(0);
    expect(JSON.stringify(result.actions)).not.toContain('Synthetic');
  });
  it('executes mixed native fill, select and desired checkbox actions', async () => {
    const f = fixture(1, true), { initial, command } = await f.request();
    const result = await executeBatch(command, initial, f.port);
    expect(result.status).toBe('applied');
    expect(f.doc.querySelector('select')!.selectedIndex).toBe(1); expect(f.doc.querySelector<HTMLInputElement>('[type=checkbox]')!.checked).toBe(true);
  });
  it('matches an unnamed native field when export omits its empty accessible name', async () => {
    const f = fixture(1); f.inputs[0]!.closest('label')!.firstChild!.textContent = '';
    const initial = (await f.port.capture()).snapshot, elementRef = [...initial.targets.keys()][0]!;
    const result = await executeBatch({ action: 'batch', connectionId: id(), snapshotId: initial.snapshotId, operationId: id(), actions: [
      { action: 'fill', elementRef, text: 'Synthetic unnamed value' },
    ] }, initial, f.port);
    expect(result.status).toBe('applied'); expect(f.inputs[0]!.value).toBe('Synthetic unnamed value');
  });
  it.each(['replacement', 'dependent-value', 'disabled', 'readonly', 'rename', 'new-field', 'partial', 'revoke', 'capture-failure'] as const)('stops safely after the first write on %s', async kind => {
    const f = fixture(), { initial, command } = await f.request();
    f.afterApply(() => {
      if (kind === 'replacement') f.inputs[1]!.replaceWith(f.inputs[1]!.cloneNode());
      if (kind === 'dependent-value') f.inputs[1]!.value = 'derived';
      if (kind === 'disabled') f.inputs[1]!.disabled = true;
      if (kind === 'readonly') f.inputs[1]!.readOnly = true;
      if (kind === 'rename') f.inputs[1]!.closest('label')!.firstChild!.textContent = 'Changed';
      if (kind === 'new-field') { const label = f.doc.createElement('label'); label.textContent = 'New'; label.append(f.doc.createElement('input')); f.doc.querySelector('main')!.append(label); }
      if (kind === 'partial') f.partial(); if (kind === 'revoke') f.revoke(); if (kind === 'capture-failure') f.failCapture();
    });
    const result = await executeBatch(command, initial, f.port);
    expect(result.status).toBe('partial'); expect(result.actions![0]!.status).toBe('applied');
    expect(result.actions!.slice(1).every(step => step.status !== 'applied')).toBe(true); expect(f.port.applied).toHaveBeenCalledTimes(1);
    if (kind === 'revoke' || kind === 'capture-failure') expect(result).not.toHaveProperty('snapshot');
  });
  it('rechecks the full form after a human approval delay', async () => {
    const f = fixture(), { initial, command } = await f.request();
    vi.mocked(f.port.approve).mockImplementationOnce(async () => { f.inputs[2]!.value = 'changed while waiting'; return 'allowed'; });
    const result = await executeBatch(command, initial, f.port);
    expect(result.status).toBe('rejected'); expect(f.inputs[0]!.value).toBe(''); expect(f.port.applied).not.toHaveBeenCalled();
  });
  it('refreshes read context after a denial without dispatching any write', async () => {
    const f = fixture(), { initial, command } = await f.request();
    vi.mocked(f.port.approve).mockImplementationOnce(async () => { f.inputs[2]!.value = 'Changed during prompt'; return 'approval-denied'; });
    const result = await executeBatch(command, initial, f.port);
    expect(result.status).toBe('rejected'); expect(result.snapshot).toContain('Changed during prompt'); expect(f.port.applied).not.toHaveBeenCalled();
  });
  it('preserves unknown receipts and coalesces concurrent retries without retaining page content', async () => {
    const f = fixture(), { initial, command } = await f.request(); f.failure({ status: 'outcome-unknown', error: 'outcome-unknown' });
    const ledger = new OperationLedger(), perform = vi.fn(() => executeBatch(command, initial, f.port));
    const [one, retry] = await Promise.all([ledger.execute('grant', command, perform), ledger.execute('grant', command, perform)]);
    expect(one.status).toBe('outcome-unknown'); expect(retry.actions).toEqual(one.actions); expect(retry).not.toHaveProperty('snapshot');
    expect(perform).toHaveBeenCalledTimes(1); expect(f.inputs[1]!.value).toBe('');
    const reordered = { ...command, actions: command.actions.map(item => Object.fromEntries(Object.entries(item).reverse())) as BatchAction[] };
    expect((await ledger.execute('grant', reordered, perform)).status).toBe('outcome-unknown');
    await expect(ledger.execute('grant', { ...command, actions: command.actions.slice(1) }, perform)).rejects.toThrow('operation-id-reused');
  });
  it('stops on cancellation without undoing a known applied write or returning protected context', async () => {
    const f = fixture(), { initial, command } = await f.request(); f.afterApply(() => f.abort.abort());
    const result = await executeBatch(command, initial, f.port);
    expect(result).toMatchObject({ status: 'partial', actions: [{ index: 0, status: 'applied' }, { index: 1, status: 'not-started' }, { index: 2, status: 'not-started' }] });
    expect(result).not.toHaveProperty('snapshot');
  });
  it.each(['identity', 'privacy', 'partial', 'denied', 'unsupported', 'placeholder'] as const)('does not write when preflight fails: %s', async kind => {
    const f = fixture(), { initial, command } = await f.request();
    if (kind === 'identity') f.inputs[1]!.replaceWith(f.inputs[1]!.cloneNode());
    if (kind === 'placeholder') initial.targets.get(command.actions[0]!.elementRef)!.placeholder = 'Old hint';
    if (kind === 'privacy') f.hideValues(); if (kind === 'partial') f.partial();
    if (kind === 'denied') vi.mocked(f.port.approve).mockResolvedValue('approval-denied');
    if (kind === 'unsupported') command.actions[1] = { action: 'set-checked', elementRef: command.actions[1]!.elementRef, checked: true };
    const result = await executeBatch(command, initial, f.port);
    expect(result.status).toBe('rejected'); expect(f.port.applied).not.toHaveBeenCalled(); expect(f.inputs.every(input => !input.value)).toBe(true);
    expect(toolResult(result).isError).toBe(true);
  });
});
