// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import type { SemanticNode, SemanticTree } from '../core/model';

export const SCOPE_MAX_BYTES = 16 * 1024;
const BASELINE_MAX_BYTES = 512 * 1024;
const MAX_NODES = 10000;
export interface FillScopeRequest { before?: SemanticTree; elementRef: string; parentTag?: string }
export interface ScopeInfo {
  kind: 'scoped' | 'full'; requested: 'scoped'; fallbackReason?: string;
  omitted: 'rest-of-page' | 'none'; parentSummaryOnly?: true; parentTag?: string;
  relatedRegionRemoved?: true;
  recovery: 'read_page_context'; observation: 'bounded; later changes and application persistence are not verified';
}
export function boundedScopeTree(tree: SemanticTree): SemanticTree | undefined {
  const stack = [tree.root]; let count = 0, size = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++count > MAX_NODES) return;
    size += JSON.stringify({ ...node, children: [] }).length;
    if (size > BASELINE_MAX_BYTES / 4) return;
    stack.push(...node.children);
  }
  return tree;
}
const nodes = (tree: SemanticTree) => {
  const result: SemanticNode[] = [], stack = [tree.root];
  while (stack.length) { const node = stack.pop()!; result.push(node); stack.push(...node.children); }
  return result;
};
const region = (node: SemanticNode) => ['alert', 'status'].includes(node.role);
const regionRoots = (tree: SemanticTree) => {
  const result: SemanticNode[] = [], stack = [tree.root];
  while (stack.length) { const node = stack.pop()!; if (region(node)) result.push(node); else stack.push(...node.children); }
  return result;
};
/** Compare only privacy-filtered semantics. Random refs and adapter IDs are never comparison keys. */
function canonical(node: SemanticNode, target: SemanticNode, skipRegions: boolean): unknown {
  if (skipRegions && region(node)) return undefined;
  const { actionRef: _ref, captureIdentity: _identity, id: _id, children, states, value, ...rest } = node;
  const { focused: _focused, ...stableStates } = states ?? {};
  return { ...rest, ...(node !== target && value !== undefined ? { value } : {}),
    ...(Object.keys(stableStates).length ? { states: stableStates } : {}),
    // The entire target subtree is returned. Chrome textareas may expose new
    // value text as descendants; that is within scope, not an outside change.
    children: node === target ? [] : children.map(child => canonical(child, target, skipRegions)).filter(child => child !== undefined) };
}
export function projectFillScope(after: SemanticTree, request: FillScopeRequest): { tree: SemanticTree; scope: ScopeInfo } {
  const scope: ScopeInfo = { kind: 'full', requested: 'scoped', omitted: 'none', recovery: 'read_page_context',
    observation: 'bounded; later changes and application persistence are not verified' };
  const fallback = (fallbackReason: string) => ({ tree: after, scope: { ...scope, fallbackReason } });
  const before = request.before;
  if (!before || !boundedScopeTree(after)) return fallback('comparison-unavailable-or-limit');
  if (before.sourceUrl !== after.sourceUrl || before.title !== after.title) return fallback('document-changed');
  const previous = nodes(before).filter(node => node.actionRef === request.elementRef);
  if (previous.length !== 1 || !previous[0]!.captureIdentity) return fallback('target-identity-unavailable');
  const old = previous[0]!, matches = nodes(after).filter(node => node.captureIdentity === old.captureIdentity);
  if (matches.length !== 1) return fallback('target-replaced-or-filtered');
  if (!matches[0]!.actionRef) return fallback('target-filtered');
  const target = matches[0]!;
  if (!['textbox', 'searchbox', 'combobox'].includes(target.role)) return fallback('target-semantics-changed');
  if (!request.parentTag || !/^(?:div|span|label|form|fieldset|section|main|article|li|td|p|body|search)$/u.test(request.parentTag)) return fallback('parent-summary-unavailable');
  // Any unclassified change (new fields, popup, navigation, etc.) requires the complete context.
  if (JSON.stringify(canonical(before.root, old, true)) !== JSON.stringify(canonical(after.root, target, true))) return fallback('changes-outside-supported-scope');
  const remaining = new Map<string, number>();
  for (const node of regionRoots(before)) {
    const key = JSON.stringify(canonical(node, old, false)); remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const changed: SemanticNode[] = [];
  for (const node of regionRoots(after)) {
    const key = JSON.stringify(canonical(node, target, false)), count = remaining.get(key) ?? 0;
    if (count) remaining.set(key, count - 1); else changed.push(node);
  }
  const removed = [...remaining.values()].some(count => count > 0);
  // A region can contain the target; avoid duplicating its reference in that case.
  if (changed.some(node => nodes({ ...after, root: node }).includes(target))) return fallback('overlapping-related-region');
  return { tree: { ...after, root: { role: 'group', name: 'Filled field and changed status regions (limited page context)', children: [target, ...changed] } },
    scope: { ...scope, kind: 'scoped', omitted: 'rest-of-page', parentTag: request.parentTag, parentSummaryOnly: true,
      ...(removed ? { relatedRegionRemoved: true } : {}) } };
}

/** Observe a short fixed window, never wait for global page silence or replay a fill. */
export function waitForFillObservation(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('cancelled')); };
    const timer = setTimeout(finish, 150);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
