// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { isOwnFilterDemo } from '../../filter-demo-protocol';
import type { CaptureOutcome } from '../types';
import { isCaptureWarnings } from '../../capture-warnings';
import { DOM_CAPTURE_LIMITS } from './limits';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]): boolean => Object.keys(value).every((key) => keys.includes(key));

/** Validate the isolated-world boundary before recursive core transformations. */
export function isDomCaptureOutcome(value: unknown, embedded = false, expectedDemoUrl?: string): value is CaptureOutcome {
  if (!isRecord(value)) return false;
  if (value.ok === false) return isRecord(value.error) &&
    ['capture-failed', 'capture-limit', 'unsupported-page', 'policy-blocked'].includes(String(value.error.code)) && typeof value.error.message === 'string';
  if (value.ok !== true || !isRecord(value.tree)) return false;
  if (value.warnings !== undefined && !isCaptureWarnings(value.warnings)) return false;
  const tree = value.tree;
  if (!onlyKeys(value, ['ok', 'tree', 'warnings']) || !onlyKeys(tree, ['schemaVersion', 'title', 'sourceUrl', 'root'])) return false;
  if (tree.schemaVersion !== 1 || !isRecord(tree.root) || tree.root.role !== 'page') return false;
  let characters = 0;
  const validText = (item: unknown): boolean => {
    if (item === undefined) return true;
    if (typeof item !== 'string') return false;
    characters += item.length;
    return characters <= DOM_CAPTURE_LIMITS.maxCharacters;
  };
  if (!validText(tree.title) || !validText(tree.sourceUrl) || tree.capturedAt !== undefined) return false;
  if (!embedded || tree.sourceUrl !== undefined) {
    if (typeof tree.sourceUrl !== 'string') return false;
    if (expectedDemoUrl !== undefined && tree.sourceUrl !== expectedDemoUrl) return false;
    try {
      const url = new URL(tree.sourceUrl);
      const demo = expectedDemoUrl !== undefined && tree.sourceUrl === expectedDemoUrl && isOwnFilterDemo(tree.sourceUrl, expectedDemoUrl.split('#')[0]!);
      if (!['http:', 'https:', 'file:'].includes(url.protocol) && !demo) return false;
    } catch { return false; }
  }
  const stack = [{ node: tree.root, depth: 0 }];
  const seen = new Set<object>();
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (seen.has(node) || seen.size >= DOM_CAPTURE_LIMITS.maxNodes || depth > DOM_CAPTURE_LIMITS.maxDepth + 1) return false;
    seen.add(node);
    if (!onlyKeys(node, ['role', 'name', 'value', 'href', 'id', 'level', 'states', 'children', 'editable', 'actionRef'])) return false;
    if (node.actionRef !== undefined && (typeof node.actionRef !== 'string' || !/^[a-f0-9-]{36}$/u.test(node.actionRef))) return false;
    if (node.editable !== undefined && typeof node.editable !== 'boolean') return false;
    if (typeof node.role !== 'string' || !node.role || !validText(node.role) ||
      !validText(node.name) || !validText(node.value) || !validText(node.href) || !validText(node.id) ||
      !Array.isArray(node.children)) return false;
    if (node.level !== undefined && (typeof node.level !== 'number' || !Number.isInteger(node.level) || node.level <= 0)) return false;
    if (node.states !== undefined) {
      if (!isRecord(node.states)) return false;
      for (const [key, state] of Object.entries(node.states)) {
        if (!['checked', 'disabled', 'expanded', 'selected', 'required', 'focusable', 'readOnly', 'focused'].includes(key)) return false;
        if (typeof state !== 'boolean' && !(key === 'checked' && state === 'mixed')) return false;
      }
    }
    if (seen.size + stack.length + node.children.length > DOM_CAPTURE_LIMITS.maxNodes) return false;
    for (const child of node.children) {
      if (!isRecord(child)) return false;
      stack.push({ node: child, depth: depth + 1 });
    }
  }
  return true;
}
