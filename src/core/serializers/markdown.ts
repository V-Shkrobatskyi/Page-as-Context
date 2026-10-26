// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { ExportPresentation } from '../contracts';
import { renderAgentHeader } from './agent-header';
import { renderExportAttribution } from './attribution';
import { createEncodingCounter } from './maximum-cost';
import type { NodeStates, SemanticNode, SemanticTree, SerializedContext } from '..';

const STATE_ORDER: readonly (keyof NodeStates)[] = [
  'checked', 'selected', 'expanded', 'disabled', 'required', 'focusable', 'readOnly', 'focused',
];

/** Serializes an already-transformed semantic tree into stable, escaped Markdown. */
export function serializeMarkdown(tree: SemanticTree, attribution = renderExportAttribution(), options: ExportPresentation = {}): SerializedContext {
  const lines: string[] = [];
  render(tree, lines, undefined, attribution, options);
  const content = `${lines.join('\n')}\n`;
  return { format: 'markdown', content, characterCount: content.length };
}

/** Counts characters and estimates cost together without retaining tree lines. */
export function measureMarkdownEncoding(tree: SemanticTree, attribution = renderExportAttribution(), options: ExportPresentation = {}): { characters: number; cost: number } {
  const counter = createEncodingCounter();
  const characters = render(tree, undefined, counter.add, attribution, options);
  return { characters, cost: counter.total() };
}

/** Measures the exact same output without accumulating tree lines or a full string. */
export function countMarkdownCharacters(tree: SemanticTree, attribution = renderExportAttribution(), options: ExportPresentation = {}): number {
  return render(tree, undefined, undefined, attribution, options);
}

function render(tree: SemanticTree, lines?: string[], measure?: (line: string) => void, attribution = renderExportAttribution(), options: ExportPresentation = {}): number {
  const headers = lines ?? [];
  renderMarkdownHeader(tree, headers, attribution, options);
  for (const line of headers) measure?.(line);
  const headerCount = headers.reduce((count, line) => count + line.length + 1, 0);
  return headerCount + renderNode(tree.root, 0, lines, measure);
}

export function renderMarkdownHeader(tree: SemanticTree, lines: string[], attribution = renderExportAttribution(), options: ExportPresentation = {}): void {
  if (renderAgentHeader(tree, lines, options, true)) return;
  if (tree.sourceUrl === undefined && tree.capturedAt === undefined) {
    if (tree.title !== undefined) lines.push(`# ${escapeText(tree.title)}`, '');
    return;
  }

  lines.push(`**Page:** ${escapeText(tree.title ?? 'Untitled page')}`);
  lines.push(`**URL:** ${code(tree.sourceUrl ?? 'Unavailable')}`);
  if (tree.selectedElementTag !== undefined) lines.push(`**Element:** Selected block ${code(`<${tree.selectedElementTag}>`)}`);
  lines.push(`**Browser:** ${escapeText(tree.browser ?? 'Unavailable')}`);
  lines.push(`**Captured:** ${escapeText(tree.capturedAt ?? 'Unavailable')}`);
  lines.push(attribution, '');
}

function renderNode(node: SemanticNode, depth: number, lines?: string[], measure?: (line: string) => void): number {
  const attributes: string[] = [];
  if (node.actionRef !== undefined) attributes.push(`ref=${code(node.actionRef)}`);
  if (node.value !== undefined) attributes.push(`value=${code(node.value)}`);
  for (const state of STATE_ORDER) {
    const value = node.states?.[state];
    if (value !== undefined) attributes.push(`${state === 'readOnly' ? 'readonly' : state}=${value}`);
  }
  if (node.level !== undefined) attributes.push(`level=${node.level}`);
  if (node.href !== undefined) attributes.push(`href=${code(node.href)}`);

  const label = node.name === undefined ? '' : ` — ${escapeText(node.name)}`;
  const detail = attributes.length === 0 ? '' : ` (${attributes.join(', ')})`;
  const line = `${'  '.repeat(depth)}- **${escapeRole(node.role)}**${label}${detail}`;
  lines?.push(line);
  measure?.(line);
  let characterCount = line.length + 1;
  for (const child of node.children) characterCount += renderNode(child, depth + 1, lines, measure);
  return characterCount;
}

function escapeRole(value: string): string {
  return escapeText(value);
}

function escapeText(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/gu, '\\$&').replace(/\r?\n/gu, ' ');
}

function code(value: string): string {
  const text = value.replace(/\r\n?|\n/gu, ' ');
  if (!text) return '""';
  let longest = 0;
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(longest + 1);
  // CommonMark ignores backslash escapes inside code spans. A longer fence
  // keeps arbitrary content inert; padding avoids merging with edge backticks
  // and preserves significant leading/trailing spaces after normalization.
  const pad = text.startsWith('`') || text.endsWith('`') ||
    text.startsWith(' ') && text.endsWith(' ') && /[^ ]/u.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}
