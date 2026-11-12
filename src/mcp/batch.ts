// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import type { SemanticNode, SemanticTree } from '../core/model';
import type { ActionCommand, ActionSnapshot, IssuedTarget } from '../adapters/actions/contract';
import { ACTION_ROLES } from '../adapters/actions/contract';
import type { BatchAction, BatchCommand, Receipt, StepReceipt } from './operations';
import { waitForFillObservation } from './fill-scoped';

export interface BatchCapture<T> { snapshot: ActionSnapshot; tree?: SemanticTree; payload: T }
export interface BatchPort<T> {
  signal: AbortSignal;
  validate(): Promise<void>;
  approve(action: BatchAction, target: IssuedTarget): Promise<string>;
  capture(): Promise<BatchCapture<T>>;
  invalidate(): void;
  applied(): void;
}
const nodes = (tree: SemanticTree) => {
  const result: SemanticNode[] = [], stack = [tree.root];
  while (stack.length) { const node = stack.pop()!; result.push(node); stack.push(...node.children); }
  return result;
};
const stable = (node: SemanticNode): unknown => {
  const { actionRef: _ref, captureIdentity: _identity, id: _id, children, states, ...rest } = node;
  const { focused: _focused, ...other } = states ?? {};
  return { ...rest, states: other, children: children.map(stable) };
};
/** Only known effects of one supported action may differ; all unrelated semantics fail closed. */
export function batchChangeAllowed(before: SemanticTree, after: SemanticTree, identity: string, action: BatchAction): boolean {
  if (before.sourceUrl !== after.sourceUrl || before.title !== after.title) return false;
  const a = nodes(before).filter(node => node.captureIdentity === identity), b = nodes(after).filter(node => node.captureIdentity === identity);
  if (a.length !== 1 || b.length !== 1 || !b[0]!.actionRef) return false;
  const canonical = (node: SemanticNode, target: SemanticNode, inTarget = false): unknown => {
    // Validation messages are returned in the final full snapshot, but never used as identities.
    if (['status', 'alert'].includes(node.role) && !nodes({ schemaVersion: 1, root: node }).some(item => item.actionRef || item.editable || ACTION_ROLES.has(item.role))) return undefined;
    const { actionRef: _ref, captureIdentity: _identity, id: _id, children, states, value, ...rest } = node;
    const { focused: _focused, ...other } = states ?? {};
    const own = node === target;
    if (own && action.action === 'set-checked') delete other.checked;
    if ((own || inTarget) && action.action === 'select-option' && node.role === 'option') delete other.selected;
    return { ...rest, identity: node.actionRef ? node.captureIdentity : undefined, ...(own && action.action !== 'set-checked' ? {} : { value }), states: other,
      children: own && action.action === 'fill' ? [] : children.map(child => canonical(child, target, inTarget || own)).filter(child => child !== undefined) };
  };
  return JSON.stringify(canonical(before.root, a[0]!)) === JSON.stringify(canonical(after.root, b[0]!));
}
const expectedRole = (action: BatchAction, node: SemanticNode) => action.action === 'fill' ? ['textbox', 'searchbox'].includes(node.role)
  : action.action === 'select-option' ? ['combobox', 'listbox'].includes(node.role) : node.role === 'checkbox';

/** Receipts contain no submitted values. Trees live only for this invocation, never in the ledger. */
export async function executeBatch<T>(command: BatchCommand, initial: ActionSnapshot, port: BatchPort<T>): Promise<Receipt & { snapshot?: T }> {
  const actions: StepReceipt[] = command.actions.map((_, index) => ({ index, status: 'not-started' }));
  let stopReason: string | undefined, latest: BatchCapture<T> | undefined;
  let snapshotUnavailable: string | undefined;
  const result = (): Receipt & { snapshot?: T } => {
    const applied = actions.filter(step => step.status === 'applied').length;
    const status = actions.some(step => step.status === 'outcome-unknown') ? 'outcome-unknown' : applied === actions.length ? 'applied' : applied ? 'partial' : 'rejected';
    return { operationId: command.operationId, status, actions, ...(stopReason ? { stopReason } : {}),
      ...(latest ? { snapshotId: latest.snapshot.snapshotId, snapshot: latest.payload } : { snapshotUnavailable: snapshotUnavailable ?? 'batch-snapshot-unavailable' }) };
  };
  const original = command.actions.map(item => initial.targets.get(item.elementRef));
  if (initial.snapshotId !== command.snapshotId || initial.expires <= Date.now() || original.some(target => !target?.captureIdentity) ||
    new Set(original.map(target => target?.captureIdentity)).size !== original.length) {
    actions[0] = { index: 0, status: 'rejected', error: 'stale-snapshot' }; stopReason = 'stale-snapshot'; return result();
  }
  const optionOriginal = command.actions.map(item => item.action === 'select-option' ? initial.targets.get(item.optionRef) : undefined);
  if (command.actions.some((item, index) => item.action === 'select-option' && !optionOriginal[index]?.captureIdentity)) {
    actions[0] = { index: 0, status: 'rejected', error: 'stale-snapshot' }; stopReason = 'stale-snapshot'; return result();
  }
  try {
    await port.validate(); latest = await port.capture();
    if (!latest.tree) { stopReason = 'capture-partial-or-limit'; return result(); }
    const baseline = nodes(latest.tree);
    const planned = original.map(target => baseline.filter(node => node.captureIdentity === target!.captureIdentity));
    // All issued targets must still exist and have unchanged identifying text before any write.
    for (let index = 0; index < planned.length; index++) {
      const match = planned[index]!, old = original[index]!, item = command.actions[index]!;
      const node = match[0];
      if (match.length !== 1 || !node?.actionRef || !latest.snapshot.targets.has(node.actionRef) || node.role !== old.role || (node.name || undefined) !== old.name || (node.placeholder || undefined) !== old.placeholder ||
        !expectedRole(item, node) || node.states?.disabled || node.states?.readOnly ||
        item.action === 'select-option' && !nodes({ ...latest.tree, root: node }).some(option => option.role === 'option' && option.actionRef &&
          latest!.snapshot.targets.has(option.actionRef) && option.captureIdentity === optionOriginal[index]?.captureIdentity && option.name === optionOriginal[index]?.name)) {
        actions[index] = { index, status: 'rejected', error: 'target-changed-or-unsupported' }; stopReason = 'preflight-failed'; return result();
      }
    }
    for (let index = 0; index < command.actions.length; index++) {
      const item = command.actions[index]!, old = original[index]!, current = latest;
      const matches = nodes(current.tree!).filter(node => node.captureIdentity === old.captureIdentity);
      const node = matches[0];
      if (matches.length !== 1 || !node?.actionRef || !current.snapshot.targets.has(node.actionRef) || JSON.stringify(stable(node)) !== JSON.stringify(stable(planned[index]![0]!))) {
        actions[index] = { index, status: 'rejected', error: 'target-changed-or-filtered' }; stopReason = 'target-changed-or-filtered'; break;
      }
      await port.validate();
      const approval = await port.approve(item, current.snapshot.targets.get(node.actionRef)!);
      if (approval !== 'allowed') {
        actions[index] = { index, status: 'rejected', error: approval }; stopReason = approval;
        // A human decision may take time; never return the pre-prompt snapshot as current.
        port.invalidate(); latest = undefined; await port.validate(); latest = await port.capture(); break;
      }
      await port.validate();
      // Approval can take time: capture again and compare the entire form before dispatch.
      const fresh = await port.capture(); latest = fresh;
      if (!fresh.tree || !batchChangeAllowed(current.tree!, fresh.tree, old.captureIdentity!, item)) { stopReason = 'page-changed-before-action'; break; }
      const freshMatches = nodes(fresh.tree).filter(value => value.captureIdentity === old.captureIdentity);
      const target = freshMatches[0];
      if (freshMatches.length !== 1 || !target?.actionRef || JSON.stringify(stable(target)) !== JSON.stringify(stable(node))) { stopReason = 'target-changed-before-action'; break; }
      let optionRef: string | undefined;
      if (item.action === 'select-option') {
        const options = nodes({ ...fresh.tree, root: target }).filter(value => value.captureIdentity === optionOriginal[index]?.captureIdentity && value.actionRef && fresh.snapshot.targets.has(value.actionRef));
        if (options.length !== 1) { stopReason = 'option-changed-or-filtered'; break; } optionRef = options[0]!.actionRef;
      }
      const action: ActionCommand = { ...item, snapshotId: fresh.snapshot.snapshotId, elementRef: target.actionRef, ...(optionRef ? { optionRef } : {}) };
      await port.validate();
      try {
        const outcome = await fresh.snapshot.run(action, port.signal, port.validate);
        actions[index] = { index, status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}) };
      } catch { actions[index] = { index, status: 'outcome-unknown', error: 'outcome-unknown' }; }
      finally { port.invalidate(); latest = undefined; }
      if (actions[index]!.status !== 'applied') {
        stopReason = actions[index]!.error ?? actions[index]!.status;
        await port.validate(); latest = await port.capture(); break;
      }
      port.applied();
      await waitForFillObservation(port.signal); await port.validate();
      latest = await port.capture();
      if (!latest.tree || !batchChangeAllowed(fresh.tree, latest.tree, old.captureIdentity!, item)) { stopReason = 'changes-outside-supported-scope'; break; }
    }
    // Never return context acquired under permissions that changed during execution.
    await port.validate();
  } catch {
    stopReason = port.signal.aborted ? 'cancelled' : 'access-or-capture-unavailable';
    snapshotUnavailable = stopReason; latest = undefined; port.invalidate();
  }
  return result();
}
