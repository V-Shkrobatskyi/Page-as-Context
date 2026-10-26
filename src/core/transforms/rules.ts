// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { SemanticNode } from '../model';

const EMPTY_LEAF_STRUCTURAL_ROLES = new Set(['group', 'log', 'sectionheader']);
const FLATTENABLE_PRESENTATION_WRAPPER_ROLES = new Set(['generic', 'none']);

export function normalizedLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  const normalized = label.trim().replace(/\s+/gu, ' ').toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

export function labelIsCovered(label: string | undefined, ancestorLabels: readonly string[]): boolean {
  const normalized = normalizedLabel(label);
  return normalized !== undefined && ancestorLabels.some((ancestor) => ancestor === normalized);
}

export function hasSemanticAttributes(node: SemanticNode): boolean {
  if (node.actionRef) return true;
  return (
    node.name !== undefined ||
    node.value !== undefined ||
    node.level !== undefined ||
    node.href !== undefined ||
    node.states !== undefined
  );
}

export function canFlattenPresentationWrapper(node: SemanticNode): boolean {
  return FLATTENABLE_PRESENTATION_WRAPPER_ROLES.has(node.role) && !hasSemanticAttributes(node);
}

export function canFlattenDetailedWrapper(node: SemanticNode): boolean {
  return canFlattenPresentationWrapper(node);
}

export function canRemoveEmptyStructuralLeaf(node: SemanticNode): boolean {
  return (
    EMPTY_LEAF_STRUCTURAL_ROLES.has(node.role) &&
    node.children.length === 0 &&
    !hasSemanticAttributes(node)
  );
}

/** Matches a complete local label sequence or exact, case-sensitive textbox value. */
export function localDuplicateTextNodes(node: SemanticNode): ReadonlySet<SemanticNode> {
  const duplicates = new Set<SemanticNode>();
  if (node.role !== 'button' && node.role !== 'link' && node.role !== 'textbox') return duplicates;

  const collect = (children: readonly SemanticNode[]): SemanticNode[] | undefined => {
    const texts: SemanticNode[] = [];
    for (const child of children) {
      if (child.role === 'InlineTextBox') continue;
      if (isPlainStaticText(child)) {
        texts.push(child);
      } else if (canFlattenPresentationWrapper(child)) {
        const nested = collect(child.children);
        if (nested === undefined) return undefined;
        texts.push(...nested);
      } else {
        // Controls, named wrappers and structural containers are boundaries.
        return undefined;
      }
    }
    return texts;
  };

  if (node.role === 'textbox') {
    const value = normalizedText(node.value);
    if (value === undefined || value === '[REDACTED]') return duplicates;
    const visit = (children: readonly SemanticNode[]): void => {
      for (const child of children) {
        if (isPlainStaticText(child) && normalizedText(child.name) === value) duplicates.add(child);
        else if (canFlattenPresentationWrapper(child)) visit(child.children);
      }
    };
    visit(node.children);
  } else {
    const texts = collect(node.children);
    if (texts !== undefined && texts.length > 1 &&
        texts.every((text) => normalizedLabel(text.name) !== undefined) &&
        normalizedLabel(texts.map((text) => text.name).join(' ')) === normalizedLabel(node.name)) {
      for (const text of texts) duplicates.add(text);
    }
  }
  return duplicates;
}

function normalizedText(text: string | undefined): string | undefined {
  const normalized = text?.trim().replace(/\s+/gu, ' ');
  return normalized ? normalized : undefined;
}

function isPlainStaticText(node: SemanticNode): boolean {
  return node.role === 'StaticText' && node.value === undefined && node.href === undefined &&
    node.level === undefined && node.states === undefined &&
    node.children.every((child) => child.role === 'InlineTextBox' && child.children.length === 0);
}
