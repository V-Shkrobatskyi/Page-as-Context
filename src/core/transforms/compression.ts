// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { CompressionLevel, SemanticNode, SemanticTree } from '..';
import {
  canFlattenDetailedWrapper,
  canFlattenPresentationWrapper,
  canRemoveEmptyStructuralLeaf,
  localDuplicateTextNodes,
  normalizedLabel,
} from './rules';

/**
 * Returns an independent tree for the requested compression profile.
 *
 * Without is an unpruned normalized clone. Detailed flattens attribute-free
 * generic/none wrappers, preserving all text and states.
 * Compact removes explicitly tested structural and duplicate noise; maximum currently shares
 * Compact's conservative structural policy. Maximum encoding is applied after redaction.
 */
export function compressSemanticTree(
  tree: SemanticTree,
  level: CompressionLevel,
): SemanticTree {
  if (level === 'without') {
    const result: SemanticTree = {
      schemaVersion: tree.schemaVersion,
      root: cloneNode(tree.root),
    };
    copyDocumentMetadata(tree, result);
    return result;
  }

  if (level === 'detailed') {
    const result: SemanticTree = {
      schemaVersion: tree.schemaVersion,
      root: detailedRoot(tree.root),
    };
    copyDocumentMetadata(tree, result);
    return result;
  }

  const result: SemanticTree = {
    schemaVersion: tree.schemaVersion,
    root: compactRoot(tree.root),
  };
  copyDocumentMetadata(tree, result);
  return result;
}

function detailedRoot(root: SemanticNode): SemanticNode {
  const children: SemanticNode[] = [];
  for (const child of root.children) appendDetailedNode(child, children);
  return cloneNode(root, children);
}

function appendDetailedNode(node: SemanticNode, destination: SemanticNode[]): void {
  const children: SemanticNode[] = [];
  for (const child of node.children) appendDetailedNode(child, children);
  const detailed = cloneNode(node, children);
  if (canFlattenDetailedWrapper(detailed)) {
    for (const child of children) destination.push(child);
  } else {
    destination.push(detailed);
  }
}

function copyDocumentMetadata(source: SemanticTree, target: SemanticTree): void {
  if (source.title !== undefined) target.title = source.title;
  if (source.sourceUrl !== undefined) target.sourceUrl = source.sourceUrl;
  if (source.selectedElementTag !== undefined) target.selectedElementTag = source.selectedElementTag;
  if (source.capturedAt !== undefined) target.capturedAt = source.capturedAt;
  if (source.browser !== undefined) target.browser = source.browser;
}

function compactRoot(root: SemanticNode): SemanticNode {
  // SemanticTree must retain one root even if its role would otherwise be
  // removable. Its descendants still receive the normal Compact traversal.
  const rootLabel = normalizedLabel(root.name);
  const ancestorLabels = new Map<string, number>();
  if (rootLabel !== undefined) ancestorLabels.set(rootLabel, 1);
  const children = root.children.flatMap((child) => compactNode(child, ancestorLabels));
  return removeUniqueNamedLinkHrefs(cloneNode(root, children, { compact: true }));
}

function compactNode(node: SemanticNode, ancestorLabels: Map<string, number>): SemanticNode[] {
  if (node.role === 'page' || node.role === 'embedded-document') ancestorLabels = new Map();
  if (node.role === 'InlineTextBox') return [];

  const ownLabel = normalizedLabel(node.name);
  if ((node.role === 'StaticText' || node.role === 'image') &&
      (ownLabel === undefined || ancestorLabels.has(ownLabel))) return [];
  if (ownLabel !== undefined) ancestorLabels.set(ownLabel, (ancestorLabels.get(ownLabel) ?? 0) + 1);
  const children: SemanticNode[] = node.children.flatMap((child) =>
    compactNode(child, ancestorLabels),
  );
  if (ownLabel !== undefined) {
    const count = ancestorLabels.get(ownLabel)! - 1;
    if (count === 0) ancestorLabels.delete(ownLabel);
    else ancestorLabels.set(ownLabel, count);
  }
  const compacted = cloneNode(node, children, { compact: true });
  // Match the whole remaining sequence before deleting any of its fragments.
  // Doing this after ordinary cleanup also keeps the transform idempotent.
  const duplicates = localDuplicateTextNodes(compacted);
  if (duplicates.size > 0) compacted.children = removeCoveredTextNodes(children, duplicates);

  if (canFlattenPresentationWrapper(compacted)) return children;
  if (canRemoveEmptyStructuralLeaf(compacted)) return [];
  return [compacted];
}

function removeCoveredTextNodes(
  children: readonly SemanticNode[],
  duplicates: ReadonlySet<SemanticNode>,
): SemanticNode[] {
  return children.flatMap((child) => {
    if (duplicates.has(child)) return [];
    if (!canFlattenPresentationWrapper(child)) return [child];
    return removeCoveredTextNodes(child.children, duplicates);
  });
}

function cloneNode(
  node: SemanticNode,
  children?: SemanticNode[],
  options: { compact?: boolean } = {},
): SemanticNode {
  const clone: SemanticNode = {
    role: node.role,
    children: children ?? node.children.map((child) => cloneNode(child)),
  };

  if (node.id !== undefined) clone.id = node.id;
  if (node.actionRef !== undefined) clone.actionRef = node.actionRef;
  if (node.name !== undefined) clone.name = node.name;
  if (node.value !== undefined) clone.value = node.value;
  if (node.level !== undefined) clone.level = node.level;
  if (node.href !== undefined) clone.href = node.href;
  if (node.states !== undefined) {
    const states = options.compact ? compactStates(node.states) : { ...node.states };
    if (Object.keys(states).length > 0) clone.states = states;
  }

  return clone;
}

function compactStates(states: NonNullable<SemanticNode['states']>): NonNullable<SemanticNode['states']> {
  const compact = { ...states };
  delete compact.focusable;
  if (compact.required === false) delete compact.required;
  if (compact.readOnly === false) delete compact.readOnly;
  return compact;
}

const LINK_SCOPE_ROLES = new Set([
  'page', 'embedded-document', 'main', 'navigation', 'list', 'menu', 'menubar', 'tablist', 'toolbar', 'dialog', 'form', 'table', 'row',
]);

/**
 * A named link is self-describing within its closest semantic container. Keep
 * href only when it is needed to distinguish an unnamed or duplicate link.
 */
function removeUniqueNamedLinkHrefs(node: SemanticNode): SemanticNode {
  return filterLinkHrefs(node, undefined);
}

function filterLinkHrefs(
  node: SemanticNode,
  inheritedLinkCounts: ReadonlyMap<string, number> | undefined,
): SemanticNode {
  const linkCounts = LINK_SCOPE_ROLES.has(node.role)
    ? linkNameCounts(node)
    : inheritedLinkCounts;
  // This traversal owns the compact clone; no source nodes or states are shared.
  for (const child of node.children) filterLinkHrefs(child, linkCounts);

  if (node.role === 'link' && node.name !== undefined && linkCounts?.get(normalizedLabel(node.name) ?? '') === 1) {
    delete node.href;
  }
  return node;
}

function linkNameCounts(container: SemanticNode): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: SemanticNode): void => {
    for (const child of node.children) {
      if (child.role === 'link') {
        const name = normalizedLabel(child.name);
        if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      if (!LINK_SCOPE_ROLES.has(child.role)) visit(child);
    }
  };
  visit(container);
  return counts;
}
