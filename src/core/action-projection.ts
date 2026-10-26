// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import type { SemanticTree, SemanticNode } from './model';

/** Never issue an address for a target whose identifying text was removed or redacted. */
export function sanitizeActionReferences(before: SemanticTree, after: SemanticTree): SemanticTree {
  const original = new Map<string, SemanticNode>();
  const stack = [before.root];
  while (stack.length) { const node = stack.pop()!; if (node.actionRef) original.set(node.actionRef, node); stack.push(...node.children); }
  if (!original.size) return after;
  const visit = (node: SemanticNode): SemanticNode => {
    const copy = { ...node, children: node.children.map(visit) };
    const previous = node.actionRef ? original.get(node.actionRef) : undefined;
    if (node.actionRef && (!previous || ['name', 'value', 'href'].some(key => previous[key as 'name'] !== node[key as 'name']))) delete copy.actionRef;
    return copy;
  };
  return { ...after, root: visit(after.root) };
}
