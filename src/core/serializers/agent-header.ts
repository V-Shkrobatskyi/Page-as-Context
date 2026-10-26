// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { ExportPresentation } from '../contracts';
import type { SemanticTree } from '../model';

/** Metadata has already passed mandatory exclusions and redaction. Never alter accessible names. */
export function renderAgentHeader(tree: SemanticTree, lines: string[], options: ExportPresentation, markdown = false): boolean {
  if (options.profile !== 'agent-context') return false;
  const emit = (label: string, value: string) => {
    const text = JSON.stringify(value).replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
    lines.push(markdown ? `**${label}:** ${text.replace(/[\\`*_{}\[\]()<>#+\-.!|]/gu, '\\$&')}` : `${label}: ${text}`);
  };
  if (tree.title !== undefined && tree.root.name !== tree.title) emit('Page', tree.title);
  if (tree.sourceUrl !== undefined && tree.root.href !== tree.sourceUrl) emit('URL', tree.sourceUrl);
  if (tree.selectedElementTag !== undefined) emit('Element', `Selected block <${tree.selectedElementTag}>`);
  const warnings = new Set(options.warnings ?? []);
  const pending = [tree.root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.role.toLowerCase() === 'canvas') { warnings.add('Canvas content is not included.'); break; }
    pending.push(...node.children);
  }
  for (const warning of warnings) emit('Notice', warning);
  if (lines.length) lines.push('');
  return true;
}
