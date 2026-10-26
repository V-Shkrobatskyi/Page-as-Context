// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { ExportPresentation } from '../contracts';
import { renderExportAttribution } from './attribution';
import type { NodeStates, SemanticNode, SemanticTree, SerializedContext } from '..';
import { measureMarkdownEncoding, renderMarkdownHeader, serializeMarkdown } from './markdown';
import { measureSemanticTextEncoding, renderSemanticTextHeader, serializeSemanticText } from './semantic-text';
import { createEncodingCounter, estimateEncodingCost, ROLE_ALIASES } from './maximum-cost';

type Format = 'semantic-text' | 'markdown';
const STATES: readonly (keyof NodeStates)[] = [
  'checked', 'selected', 'expanded', 'disabled', 'required', 'focusable', 'readOnly', 'focused',
];
const LEGEND = 'Encoding: quoted text is literal; attributes are key=value; indentation shows hierarchy.';
const STRINGS = 'Strings: unquoted A-Z in name/value/href slots refer to the definitions below; quoted text is literal.';
const CHAINS = 'Chains: cell+link NAME means cell NAME containing link NAME; indented children belong to the link.';
const TREES = 'Trees: @Tn inserts a fresh copy of the defined subtree; definition indentation is relative to its root.';
const INLINE = 'Inline: role{children} preserves ordered nodes; each quoted string or string reference is one StaticText; semicolons separate siblings.';
const SAFE_ROLE = /^\p{L}[\p{L}\p{N}_-]*$/u;
const MAX_NODES = 100_000;
const MAX_DEPTH = 256;
const MAX_UNIQUE_STRINGS = 4096;
const MAX_INLINE_NODES = 128;
const MAX_INLINE_CHARACTERS = 4096;
const EMPTY_DICTIONARY: Dictionary = { strings: new Map(), roles: new Map() };
const ALIAS_ROLES = new Set(ROLE_ALIASES.flatMap(([role, alias]) => [role, alias]));

interface Options { chains: boolean; inline: boolean; trees: boolean }
interface Template { reference: string; root: SemanticNode }
interface Dictionary { strings: Map<string, string>; roles: Map<string, string> }
interface Analysis {
  paragraphs: Set<SemanticNode>;
  chains: Set<SemanticNode>;
  signatures: Map<SemanticNode, number>;
  candidates: Array<{ id: number; root: SemanticNode; gain: number; cost: number }>;
}
interface Measure { characters: number; cost: number }

/** Encodes only the already-redacted Compact export projection, preserving every occurrence. */
export function serializeMaximum(tree: SemanticTree, format: Format, attribution = renderExportAttribution(), presentation: ExportPresentation = {}): SerializedContext {
  const fallback = () => format === 'semantic-text' ? serializeSemanticText(tree, attribution, presentation) : serializeMarkdown(tree, attribution, presentation);
  const pending = [tree.root];
  while (pending.length) { const node = pending.pop()!; if (node.actionRef) return fallback(); pending.push(...node.children); }
  const analysis = analyze(tree.root);
  if (!analysis) return fallback();
  const baseline = format === 'semantic-text' ? measureSemanticTextEncoding(tree, attribution, presentation) : measureMarkdownEncoding(tree, attribution, presentation);
  let best: { options: Options; dictionary: Dictionary; measure: Measure; templates: Map<number, Template> } | undefined;
  // Eight bounded alternatives account for structural overlap and shared legends globally.
  for (let variant = 0; variant < 8; variant++) {
    const options = { chains: Boolean(variant & 1), inline: Boolean(variant & 2), trees: Boolean(variant & 4) };
    if (options.chains && analysis.chains.size === 0) continue;
    if (options.inline && analysis.paragraphs.size === 0) continue;
    if (options.trees && analysis.candidates.length === 0) continue;
    const templates = options.trees ? selectTemplates(tree.root, analysis) : new Map<number, Template>();
    if (options.trees && templates.size === 0) continue;
    const dictionary = selectDictionary(tree.root, analysis, options, templates, format);
    const measure = render(tree, analysis, options, dictionary, templates, format, attribution, presentation);
    // This whole-payload margin is an uncertainty guard, not a token guarantee.
    if (baseline.characters - measure.characters < Math.max(64, baseline.characters * .02)
      || baseline.cost - measure.cost < Math.max(24, baseline.cost * .04)) continue;
    if (!best || measure.cost < best.measure.cost) best = { options, dictionary, measure, templates };
  }
  if (!best) return fallback();
  const lines: string[] = [];
  render(tree, analysis, best.options, best.dictionary, best.templates, format, attribution, presentation, lines);
  const content = `${lines.join('\n')}\n`;
  return { format, content, characterCount: content.length };
}

/** Post-order classification is iterative; no recursive subtree serialization or hashing. */
function analyze(root: SemanticNode): Analysis | undefined {
  const ordered: SemanticNode[] = [];
  const stack = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (ordered.length + stack.length + node.children.length >= MAX_NODES || depth > MAX_DEPTH) return undefined;
    ordered.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i]!, depth: depth + 1 });
  }
  const inline = new Map<SemanticNode, number>();
  const paragraphs = new Set<SemanticNode>();
  const ownCosts = new Map<string, number>();
  const signatures = new Map<SemanticNode, number>();
  const interned = new Map<string, number>();
  const groups = new Map<number, { root: SemanticNode; count: number; cost: number; characters: number }>();
  const sizes = new Map<SemanticNode, Measure>();
  let nextId = 0;
  const chains = new Set<SemanticNode>();
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = ordered[i]!;
    const own = fields(node, EMPTY_DICTIONARY);
    let ownCost = ownCosts.get(own);
    if (ownCost === undefined) {
      ownCost = estimateEncodingCost(`${own}\n`);
      if (ownCosts.size < 4096) ownCosts.set(own, ownCost);
    }
    const size = { characters: own.length + 1, cost: ownCost };
    for (const child of node.children) {
      const childSize = sizes.get(child)!;
      size.characters += childSize.characters;
      size.cost += childSize.cost;
    }
    sizes.set(node, size);
    // Exact interned keys avoid hash collisions; IDs are only temporary signature numbers.
    const key = JSON.stringify([own, node.children.map(child => signatures.get(child))]);
    let id = interned.get(key);
    if (id === undefined) {
      id = nextId++;
      if (interned.size < 4096 && size.characters <= 4096) interned.set(key, id);
    }
    signatures.set(node, id);
    if (interned.has(key) && node.children.length && size.characters <= 4096) {
      const group = groups.get(id);
      if (group) group.count++;
      else groups.set(id, { root: node, count: 1, ...size });
    }
    if (plain(node) && node.role === 'StaticText' && node.name !== undefined && node.children.length === 0) {
      inline.set(node, 1);
    } else if (plain(node) && node.name === undefined && ['code', 'strong'].includes(node.role)
      && node.children.every(child => inline.has(child))) {
      const count = 1 + node.children.reduce((total, child) => total + inline.get(child)!, 0);
      if (count <= MAX_INLINE_NODES) inline.set(node, count);
    }
    if (node.role === 'paragraph' && node.name === undefined && plain(node) && node.children.length >= 3
      && node.children.every(child => inline.has(child))
      && node.children.reduce((count, child) => count + inline.get(child)!, 1) <= MAX_INLINE_NODES
      && paragraphText(node, EMPTY_DICTIONARY).length <= MAX_INLINE_CHARACTERS) paragraphs.add(node);
    const child = node.children[0];
    if (plain(node) && node.role === 'cell' && node.name !== undefined && node.children.length === 1
      && child?.role === 'link' && plain(child) && child.name === node.name) chains.add(node);
  }
  const candidates = [...groups].filter(([, group]) => group.count >= 2 && group.cost >= 20)
    .map(([id, group]) => ({ id, root: group.root, cost: group.cost, gain: (group.count - 1) * group.cost - group.count * 3 - 4 }))
    .filter(candidate => candidate.gain > 8).sort((a, b) => b.gain - a.gain).slice(0, 8);
  return { paragraphs, chains, signatures, candidates };
}

// IDs are adapter bookkeeping, not exported fields. Explicit exported attributes forbid shorthand.
function plain(node: SemanticNode): boolean {
  return node.value === undefined && node.href === undefined && node.level === undefined
    && STATES.every(key => node.states?.[key] === undefined);
}

function quote(value: string): string {
  return JSON.stringify(value).replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
}
function escape(value: string, format: Format): string {
  return format === 'markdown' ? value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/gu, '\\$&') : value;
}
function literal(value: string, dictionary: Dictionary): string {
  return dictionary.strings.get(value) ?? quote(value);
}

function inlineText(node: SemanticNode, dictionary: Dictionary): string {
  if (node.role === 'StaticText') return literal(node.name!, dictionary);
  return `${node.role}{${node.children.map(child => inlineText(child, dictionary)).join('; ')}}`;
}

function paragraphText(node: SemanticNode, dictionary: Dictionary): string {
  return `paragraph inline={${node.children.map(child => inlineText(child, dictionary)).join('; ')}}`;
}

function useInline(node: SemanticNode, analysis: Analysis, options: Options): boolean {
  return options.inline && analysis.paragraphs.has(node);
}

/** Visits only emitted slots, so swallowed chain labels are never counted twice. */
function slots(root: SemanticNode, analysis: Analysis, options: Options,
  onRole: (role: string) => void, onString: (value: string) => void, templates = new Map<number, Template>()): void {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (templates.has(analysis.signatures.get(node)!)) continue;
    if (useInline(node, analysis, options)) {
      const fragments = [...node.children];
      while (fragments.length) {
        const child = fragments.pop()!;
        if (child.role === 'StaticText') onString(child.name!);
        else fragments.push(...child.children);
      }
      continue;
    }
    const chained = options.chains && analysis.chains.has(node);
    if (!chained) onRole(node.role);
    for (const value of [node.name, node.value, node.href]) if (value !== undefined) onString(value);
    const children = chained ? node.children[0]!.children : node.children;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
}

function emittedSlots(root: SemanticNode, analysis: Analysis, options: Options,
  templates: Map<number, Template>, onRole: (role: string) => void, onString: (value: string) => void): void {
  slots(root, analysis, options, onRole, onString, templates);
  for (const template of templates.values()) slots(template.root, analysis, options, onRole, onString);
}

/** Definitions are flat: they never reference other definitions, so cycles are impossible. */
function selectTemplates(root: SemanticNode, analysis: Analysis): Map<number, Template> {
  const templates = new Map<number, Template>();
  for (const candidate of analysis.candidates) templates.set(candidate.id, {
    reference: `T${templates.size + 1}`, root: candidate.root,
  });
  // Parent references consume child occurrences. Recount until the bounded set stabilizes.
  for (let pass = 0; pass < 8; pass++) {
    const counts = new Map<number, number>();
    const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      const id = analysis.signatures.get(node)!;
      if (templates.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
      else stack.push(...node.children);
    }
    let changed = false;
    for (const [id] of templates) {
      const count = counts.get(id) ?? 0;
      const cost = analysis.candidates.find(candidate => candidate.id === id)!.cost;
      if (count < 2 || (count - 1) * cost - count * 3 - 4 <= Math.max(8, cost * .2)) {
        templates.delete(id); changed = true;
      }
    }
    if (!changed) break;
  }
  return templates;
}

function selectDictionary(root: SemanticNode, analysis: Analysis, options: Options, templates: Map<number, Template>, format: Format): Dictionary {
  const dictionary: Dictionary = { strings: new Map(), roles: new Map() };
  const counts = new Map<string, number>();
  const roles = new Map<string, number>();
  emittedSlots(root, analysis, options, templates, role => {
    if (ALIAS_ROLES.has(role)) roles.set(role, (roles.get(role) ?? 0) + 1);
  }, value => {
    if (counts.has(value)) counts.set(value, counts.get(value)! + 1);
    else if (counts.size < MAX_UNIQUE_STRINGS && value.length <= MAX_INLINE_CHARACTERS) counts.set(value, 1);
  });
  let roleGain = 0;
  for (const [role, alias] of ROLE_ALIASES) {
    const count = roles.get(role) ?? 0;
    if (count < 3 || roles.has(alias)) continue;
    const entryCost = estimateEncodingCost(escape(`${alias}=${role}; `, format));
    const gain = count - entryCost;
    if (gain <= 3) continue;
    dictionary.roles.set(role, alias);
    roleGain += gain;
  }
  if (roleGain < estimateEncodingCost('Roles: \n') + 4) dictionary.roles.clear();

  const candidates: Array<{ value: string; gain: number; cost: number; count: number }> = [];
  for (const [value, count] of counts) {
    // Unsupported scripts remain literal until independently calibrated.
    if (count < 2 || value === '[REDACTED]' || !/^[\x20-\x7e\r\n\t•]*$/u.test(value)
      || /([^A-Za-z0-9\s•])\1{2}/u.test(value)) continue;
    const encoded = escape(quote(value), format);
    const cost = estimateEncodingCost(encoded);
    if (cost < 4) continue;
    const definitionCost = cost + 3;
    const gain = count * (cost - 1) - definitionCost;
    const margin = Math.max(3, cost * .2);
    if (gain <= margin || count * (encoded.length - 1) <= encoded.length + 3) continue;
    candidates.push({ value, gain, cost, count });
  }
  candidates.sort((a, b) => b.gain - a.gain);
  let stringGain = 0;
  for (const candidate of candidates.slice(0, 26)) {
    dictionary.strings.set(candidate.value, String.fromCharCode(65 + dictionary.strings.size));
    stringGain += candidate.gain - Math.max(3, candidate.cost * .2);
  }
  if (stringGain <= estimateEncodingCost(escape(`${STRINGS}\n`, format)) + 4) dictionary.strings.clear();
  return dictionary;
}

function fields(node: SemanticNode, dictionary: Dictionary): string {
  const role = dictionary.roles.get(node.role) ?? node.role;
  const output = [SAFE_ROLE.test(role) ? role : `role=${quote(role)}`];
  if (node.name !== undefined) output.push(literal(node.name, dictionary));
  if (node.value !== undefined) output.push(`value=${literal(node.value, dictionary)}`);
  for (const key of STATES) if (node.states?.[key] !== undefined) {
    output.push(`${key === 'readOnly' ? 'readonly' : key}=${node.states[key]}`);
  }
  if (node.level !== undefined) output.push(`level=${node.level}`);
  if (node.href !== undefined) output.push(`href=${literal(node.href, dictionary)}`);
  return output.join(' ');
}

function render(tree: SemanticTree, analysis: Analysis, options: Options, dictionary: Dictionary,
  templates: Map<number, Template>, format: Format, attribution: string, presentation: ExportPresentation, lines?: string[]): Measure {
  const measure = { characters: 0, cost: 0 };
  const counter = createEncodingCounter();
  const emit = (line: string): void => {
    lines?.push(line);
    measure.characters += line.length + 1;
    counter.add(line);
  };
  const header: string[] = [];
  if (format === 'semantic-text') renderSemanticTextHeader(tree, header, attribution, presentation);
  else renderMarkdownHeader(tree, header, attribution, presentation);
  for (const line of header) emit(line);
  emit(LEGEND);
  if (dictionary.roles.size) emit(escape(`Roles: ${[...dictionary.roles].map(([role, alias]) => `${alias}=${role}`).join('; ')}`, format));
  if (dictionary.strings.size) {
    emit(escape(STRINGS, format));
    for (const [value, reference] of dictionary.strings) emit(escape(`${reference}=${quote(value)}`, format));
  }
  // Emit a feature legend only when a node actually uses that feature.
  const chainUsed = options.chains && analysis.chains.size > 0;
  const inlineUsed = options.inline && analysis.paragraphs.size > 0;
  if (chainUsed) emit(escape(CHAINS, format));
  if (inlineUsed) emit(escape(INLINE, format));
  if (templates.size) emit(escape(TREES, format));
  if (format === 'markdown') emit('');
  const emitTree = (root: SemanticNode, rootDepth: number, references: boolean): void => {
    const treeLines = [{ node: root, depth: rootDepth }];
    while (treeLines.length) {
      const { node, depth } = treeLines.pop()!;
      const prefix = `${'  '.repeat(depth)}${format === 'markdown' ? '- ' : ''}`;
      const template = references ? templates.get(analysis.signatures.get(node)!) : undefined;
      if (template) { emit(prefix + escape(`@${template.reference}`, format)); continue; }
      if (useInline(node, analysis, options)) {
        emit(prefix + escape(paragraphText(node, dictionary), format));
        continue;
      }
      const chained = options.chains && analysis.chains.has(node);
      const line = chained ? `cell+link ${literal(node.name!, dictionary)}` : fields(node, dictionary);
      emit(prefix + escape(line, format));
      const children = chained ? node.children[0]!.children : node.children;
      for (let i = children.length - 1; i >= 0; i--) treeLines.push({ node: children[i]!, depth: depth + 1 });
    }
  };
  for (const template of templates.values()) {
    emit(`${template.reference}:`);
    if (format === 'markdown') emit('');
    emitTree(template.root, 1, false);
    if (format === 'markdown') emit('');
  }
  if (templates.size) {
    emit('Page tree:');
    if (format === 'markdown') emit('');
  }
  emitTree(tree.root, 0, true);
  measure.cost = counter.total();
  return measure;
}
