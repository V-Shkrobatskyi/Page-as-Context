// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import type { SemanticNode, SemanticTree } from '../core/model';

export const TARGET_MAX_BYTES = 16 * 1024;
export const TARGET_GROUP_ROLES = ['form', 'dialog', 'alertdialog', 'group', 'region', 'search'];
export interface TargetQuery { role: string; name?: string; placeholder?: string }
export interface TargetReadRequest { target: TargetQuery; group?: { role: string; name: string }; context?: 'target' | 'group' }
export interface TargetReadInfo {
  outcome: 'found' | 'not-found' | 'ambiguous' | 'capture-incomplete' | 'context-unavailable';
  scope: 'target' | 'group' | 'none'; omitted: 'rest-of-page';
  recovery: 'read_page_context'; reason?: string;
  observation: string; candidates?: { role: string; name?: string; placeholder?: string; group?: { role: string; name?: string } }[];
  candidatesOmitted?: boolean;
}
const empty = (): SemanticTree => ({ schemaVersion: 1, root: { role: 'group', children: [] } });
export function unavailableTarget(tree: SemanticTree, reason: string, partial = false) {
  return { tree: empty(), info: {
    outcome: partial ? 'capture-incomplete' : 'context-unavailable', scope: 'none', omitted: 'rest-of-page',
    recovery: 'read_page_context', reason,
    observation: 'Limited observation; omitted errors, later changes and application persistence are not verified.',
  } as TargetReadInfo };
}
const matches = (node: SemanticNode, query: TargetQuery) => node.role === query.role &&
  (query.name !== undefined ? node.name === query.name : !node.name && node.placeholder === query.placeholder && ['textbox', 'searchbox', 'combobox'].includes(node.role));
const summary = (node: SemanticNode) => ({ role: node.role, ...(node.name !== undefined ? { name: node.name } : {}) });

/** Search only the export pipeline's sanitized representation, never adapter IDs or raw DOM. */
export function projectTargetRead(tree: SemanticTree, request: TargetReadRequest, partial = false) {
  const unavailable = (reason: string) => unavailableTarget(tree, reason, partial);
  if (partial) return unavailable('capture-partial');
  const entries: { node: SemanticNode; group?: SemanticNode; ancestors: SemanticNode[] }[] = [];
  const pending = [{ node: tree.root, ancestors: [] as SemanticNode[] }];
  let bytes = 0;
  while (pending.length) {
    const { node, ancestors } = pending.pop()!;
    bytes += new TextEncoder().encode(JSON.stringify({ ...node, children: [] })).length;
    if (entries.length >= 10000 || bytes > 512 * 1024) return unavailable('projection-limit');
    const boundary = ['page', 'document', 'embedded-document'].includes(node.role);
    const parents = boundary ? [] : ancestors;
    const group = [...parents].reverse().find(parent => TARGET_GROUP_ROLES.includes(parent.role));
    entries.push({ node, group, ancestors: parents });
    for (let i = node.children.length - 1; i >= 0; i--) pending.push({ node: node.children[i]!, ancestors: [...parents, node] });
  }
  const base = unavailableTarget(tree, 'no-match').info;
  const ambiguous = (items: typeof entries, reason: string) => ({ tree: empty(), info: {
    ...base, outcome: 'ambiguous' as const, reason,
    candidates: items.slice(0, 5).map(({ node, group }) => ({ ...summary(node),
      ...(!node.name && node.placeholder ? { placeholder: node.placeholder } : {}), ...(group ? { group: summary(group) } : {}) })),
    candidatesOmitted: items.length > 5,
  } });
  let group: SemanticNode | undefined;
  if (request.group) {
    const groups = entries.filter(entry => matches(entry.node, request.group!));
    if (groups.length > 1) return ambiguous(groups, 'group-ambiguous');
    if (!groups.length) return { tree: empty(), info: { ...base, outcome: 'not-found' as const, reason: 'group-not-found' } };
    group = groups[0]!.node;
  }
  const found = entries.filter(entry => matches(entry.node, request.target) && (!group || entry.ancestors.includes(group)));
  if (found.length > 1) return ambiguous(found, 'target-ambiguous');
  if (!found.length) return { tree: empty(), info: { ...base, outcome: 'not-found' as const, reason: 'target-not-found' } };
  const selected = found[0]!, scopeGroup = group ?? selected.group;
  let children: SemanticNode[];
  if (request.context === 'group') {
    if (!group) return unavailable('group-required');
    children = [group];
  } else {
    const regions: SemanticNode[] = [];
    // Document boundaries remain boundaries even inside a group projection.
    const stack = [...(scopeGroup?.children ?? [])];
    while (stack.length) {
      const node = stack.pop()!;
      if (node === selected.node || ['page', 'document', 'embedded-document'].includes(node.role)) continue;
      if (['status', 'alert'].includes(node.role)) regions.push(node); else stack.push(...node.children);
    }
    if (regions.length > 4) return unavailable('related-region-limit');
    // A status ancestor already contains the target. Avoid emitting it twice.
    if (regions.some(region => selected.ancestors.includes(region))) return unavailable('overlapping-related-region');
    children = scopeGroup ? [{ ...summary(scopeGroup), children: [selected.node, ...regions] }] : [selected.node];
  }
  const stack = [...children]; let count = 0;
  while (stack.length) { const node = stack.pop()!; if (++count > 80) return unavailable('scope-node-limit'); stack.push(...node.children); }
  return { tree: { ...tree, root: { role: 'group', name: 'Limited target context', children } },
    info: { ...base, outcome: 'found' as const, scope: request.context === 'group' ? 'group' as const : 'target' as const, reason: undefined } };
}
