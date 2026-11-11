// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import type { SemanticTree, SemanticNode } from './model';

/** Never issue an address for a target whose identifying text was removed or redacted. */
export function sanitizeActionReferences(before: SemanticTree, after: SemanticTree, maskedValueRefs: ReadonlySet<string> = new Set()): SemanticTree {
  const original = new Map<string, SemanticNode>();
  const stack = [before.root];
  while (stack.length) { const node = stack.pop()!; if (node.actionRef) original.set(node.actionRef, node); stack.push(...node.children); }
  if (!original.size) return after;
  const visit = (node: SemanticNode): SemanticNode => {
    const copy = { ...node, children: node.children.map(visit) };
    const previous = node.actionRef ? original.get(node.actionRef) : undefined;
    // Only the redactor can authorize this narrow value-only exception. A
    // stable label/hint and internal node identity remain mandatory. Full hides,
    // changed identifying text, data exclusions and non-text controls fail closed.
    const maskedTextValue = !!previous && !!node.actionRef && maskedValueRefs.has(node.actionRef) &&
      ['textbox', 'searchbox'].includes(node.role) && previous.role === node.role &&
      !!previous.captureIdentity && previous.captureIdentity === node.captureIdentity &&
      !!(node.name || node.placeholder) && node.value !== undefined && !node.value.includes('[REDACTED]');
    if (node.actionRef && (!previous || ['name', 'placeholder', 'href'].some(key => previous[key as 'name'] !== node[key as 'name']) ||
      previous.value !== node.value && !maskedTextValue)) delete copy.actionRef;
    return copy;
  };
  return { ...after, root: visit(after.root) };
}
