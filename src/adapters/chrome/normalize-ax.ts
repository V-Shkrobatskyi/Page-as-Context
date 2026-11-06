// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { CaptureResult, NodeStates, SemanticNode, SemanticTree } from '../../core';

import type { ChromeAxNode, ChromeAxProperty, ChromeAxTreeResponse, ChromeAxValue } from './types';
import { normalizeAxName } from './ax-name';

const STATE_PROPERTIES: ReadonlyMap<string, keyof NodeStates> = new Map([
  ['checked', 'checked'],
  ['disabled', 'disabled'],
  ['expanded', 'expanded'],
  ['selected', 'selected'],
  ['required', 'required'],
  ['focusable', 'focusable'],
  ['readonly', 'readOnly'],
  ['focused', 'focused'],
]);

type InvalidTreeReason = 'empty-nodes' | 'missing-id' | 'conflicting-duplicate-id' | 'missing-child' |
  'shared-child' | 'root-count' | 'cycle' | 'missing-role' | 'disconnected';

function stringValue(value: ChromeAxValue | undefined): string | undefined {
  return typeof value?.value === 'string' && value.value.length > 0 ? value.value : undefined;
}

function numberValue(value: ChromeAxValue | undefined): number | undefined {
  return typeof value?.value === 'number' && Number.isFinite(value.value) ? value.value : undefined;
}

function booleanValue(value: ChromeAxValue | undefined): boolean | undefined {
  return typeof value?.value === 'boolean' ? value.value : undefined;
}

function propertiesByName(properties: ChromeAxProperty[] | undefined): Map<string, ChromeAxValue | undefined> {
  return new Map(properties?.map((property) => [property.name, property.value]));
}

function statesFrom(properties: Map<string, ChromeAxValue | undefined>): NodeStates | undefined {
  const states: NodeStates = {};

  for (const [propertyName, stateName] of STATE_PROPERTIES) {
    const value = properties.get(propertyName);
    if (stateName === 'checked' && value?.value === 'mixed') {
      states.checked = 'mixed';
      continue;
    }
    // CDP exposes checked as a tristate token, unlike boolean states.
    if (stateName === 'checked' && (value?.value === 'true' || value?.value === 'false')) {
      states.checked = value.value === 'true';
      continue;
    }

    const boolean = booleanValue(value);
    if (boolean !== undefined) states[stateName] = boolean;
  }

  return Object.keys(states).length > 0 ? states : undefined;
}

function rootNode(nodes: ChromeAxNode[], nodeIds: Set<string>): ChromeAxNode | undefined {
  const referencedIds = new Set(nodes.flatMap((node) => node.childIds ?? []));
  const roots = nodes.filter((node) => !referencedIds.has(node.nodeId));

  if (roots.length !== 1) return undefined;
  const candidate = roots[0];
  return candidate && nodeIds.has(candidate.nodeId) ? candidate : undefined;
}

/**
 * AX node IDs are only unique within one web frame. A full-tree response can
 * include embedded-frame nodes, so normalize the root document separately and
 * omit cross-frame child references rather than joining ambiguous IDs.
 */
function rootFrameNodes(nodes: ChromeAxNode[]): ChromeAxNode[] {
  const rootFrameId = nodes.find((node) =>
    node.frameId !== undefined && stringValue(node.role) === 'RootWebArea',
  )?.frameId;
  if (rootFrameId === undefined) return nodes;

  // Chrome may include frameId only on document-root nodes. Descendants without
  // an explicit frameId belong to the root document unless they are reached
  // through a separately identified embedded-frame root.
  return nodes.filter((node) => node.frameId === undefined || node.frameId === rootFrameId);
}

function filterChildReferences(
  nodes: ChromeAxNode[],
  nodeIds: ReadonlySet<string> | ReadonlyMap<string, ChromeAxNode> = new Set(nodes.map((node) => node.nodeId)),
): ChromeAxNode[] {
  return nodes.map((node) => ({
    ...node,
    childIds: node.childIds?.filter((childId) => nodeIds.has(childId)),
  }));
}

/** Converts a complete Chrome CDP accessibility response into the browser-neutral core model. */
export function normalizeChromeAxTree(response: ChromeAxTreeResponse, options: {
  frameId?: string;
  onNode?: (raw: ChromeAxNode, normalized: SemanticNode) => void;
} = {}): CaptureResult {
  if (options.frameId !== undefined && response.nodes.find((node) =>
    stringValue(node.role) === 'RootWebArea')?.frameId !== options.frameId) {
    return { ok: false, error: { code: 'invalid-tree', message: 'Chrome returned an unexpected document.' } };
  }
  const frameNodes = Array.isArray(response.nodes) ? rootFrameNodes(response.nodes) : [];
  // Preserve the existing child-reference filtering only when a root frame is identified.
  const hasRootFrame = frameNodes.some((node) => node.frameId !== undefined && stringValue(node.role) === 'RootWebArea');
  const invalidTree = (reason: InvalidTreeReason, details: string): CaptureResult => {
    return {
      ok: false,
      error: { code: 'invalid-tree', message: 'Chrome returned an invalid accessibility tree.', details },
    };
  };
  if (!Array.isArray(response.nodes) || response.nodes.length === 0) {
    return invalidTree('empty-nodes', 'The response contains no AX nodes.');
  }

  const uniqueNodes = new Map<string, ChromeAxNode>();
  for (const node of frameNodes) {
    if (typeof node.nodeId !== 'string' || node.nodeId.length === 0) {
      return invalidTree('missing-id', 'AX node IDs must be present.');
    }
    const previous = uniqueNodes.get(node.nodeId);
    if (previous) {
      // Compare the complete CDP records before filtering child references.
      // Only identical repetitions are safe to collapse; conflicts remain errors.
      if (JSON.stringify(previous) !== JSON.stringify(node)) {
        return invalidTree('conflicting-duplicate-id', 'Repeated AX node IDs contain conflicting records.');
      }
      continue;
    }
    uniqueNodes.set(node.nodeId, node);
  }
  const uniqueFrameNodes = uniqueNodes.size === frameNodes.length ? frameNodes : [...uniqueNodes.values()];
  const nodes = hasRootFrame ? filterChildReferences(uniqueFrameNodes, uniqueNodes) : uniqueFrameNodes;
  // Reuse the ID index after duplicate checking instead of keeping a second Map.
  const nodesById = uniqueNodes;
  if (hasRootFrame) {
    for (const node of nodes) nodesById.set(node.nodeId, node);
  }

  const childReferences = new Set<string>();
  for (const node of nodes) {
    for (const childId of node.childIds ?? []) {
      if (!nodesById.has(childId)) {
        return invalidTree('missing-child', `AX node ${node.nodeId} references a missing child.`);
      }
      if (childReferences.has(childId)) {
        return invalidTree('shared-child', `AX node ${childId} has more than one parent.`);
      }
      childReferences.add(childId);
    }
  }

  const root = rootNode(nodes, new Set(nodesById.keys()));
  if (!root) return invalidTree('root-count', 'The response must have exactly one root AX node.');

  const visiting = new Set<string>();
  const visited = new Set<string>();
  let traversalFailure: 'cycle' | 'missing-role' | undefined;

  const normalizeNode = (node: ChromeAxNode): SemanticNode | undefined => {
    if (visiting.has(node.nodeId)) {
      traversalFailure = 'cycle';
      return undefined;
    }
    visiting.add(node.nodeId);

    const role = stringValue(node.role);
    if (!role) {
      traversalFailure = 'missing-role';
      return undefined;
    }

    const properties = propertiesByName(node.properties);
    const children: SemanticNode[] = [];
    for (const childId of node.childIds ?? []) {
      const child = nodesById.get(childId)!;
      const normalizedChild = normalizeNode(child);
      if (!normalizedChild) return undefined;
      children.push(normalizedChild);
    }

    visiting.delete(node.nodeId);
    visited.add(node.nodeId);

    const normalized: SemanticNode = {
      role: role === 'RootWebArea' ? 'page' : role,
      children,
    };
    if (properties.get('editable')?.value) normalized.editable = true;
    const name = normalizeAxName(node.name);
    const numericValue = numberValue(node.value);
    const value = stringValue(node.value) ?? (numericValue === undefined ? undefined : String(numericValue));
    const level = numberValue(properties.get('level'));
    const href = stringValue(properties.get('url'));
    const states = statesFrom(properties);
    if (name !== undefined) normalized.name = name;
    if (value !== undefined) normalized.value = value;
    if (level !== undefined) normalized.level = level;
    if (href !== undefined) normalized.href = href;
    if (states !== undefined) normalized.states = states;
    options.onNode?.(node, normalized);
    return normalized;
  };

  const normalizedRoot = normalizeNode(root);
  if (!normalizedRoot || visited.size !== nodes.length) {
    return invalidTree(traversalFailure ?? 'disconnected',
      'The AX node graph is cyclic, disconnected, or has a node without a role.');
  }

  const tree: SemanticTree = { schemaVersion: 1, root: normalizedRoot };
  return { ok: true, tree };
}
