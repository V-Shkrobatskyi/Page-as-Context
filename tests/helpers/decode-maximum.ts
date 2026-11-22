// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import type { SemanticNode } from '@/src/core/model';

/** Independent test-only grammar expansion; imports no encoder or cost helpers. */
export function decodeMaximum(content: string, markdown = false): SemanticNode {
  const start = content.indexOf('Encoding:');
  if (start < 0) throw new Error('Missing Maximum encoding legend');
  let lines = content.slice(start).split('\n').filter(Boolean);
  if (markdown) lines = lines.map(line => line.replace(/^(\s*)- /u, '$1').replace(/\\([\\`*_{}\[\]()<>#+\-.!|])/gu, '$1'));
  const strings = new Map<string, string>(), roles = new Map<string, string>();
  const templates = new Map<string, string[]>(), body: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('Roles: ')) {
      for (const item of line.slice(7).split('; ')) {
        const [alias, role] = item.split('='); roles.set(alias!, role!);
      }
    } else if (/^[A-Z]=/u.test(line)) strings.set(line[0]!, JSON.parse(line.slice(2)));
    else if (/^T\d+:$/u.test(line)) {
      const rows: string[] = [];
      while (lines[i + 1]?.startsWith('  ')) rows.push(lines[++i]!.slice(2));
      templates.set(line.slice(0, -1), rows);
    } else if (!/^(Encoding:|Strings:|Chains:|Trees:|Inline:|Page tree:)/u.test(line)) body.push(line);
  }
  const expanded = body.flatMap(line => {
    const match = /^(\s*)@(T\d+)$/u.exec(line);
    if (!match) return [line];
    const rows = templates.get(match[2]!);
    if (!rows) throw new Error('Undefined subtree');
    return rows.map(row => match[1] + row);
  }).flatMap(expandInline);
  const stack: SemanticNode[] = [];
  const chains: number[] = [];
  let root: SemanticNode | undefined;
  const append = (node: SemanticNode, depth: number) => {
    if (!Number.isInteger(depth) || depth > stack.length) throw new Error('Invalid hierarchy');
    if (depth) stack[depth - 1]!.children.push(node);
    else if (root) throw new Error('Multiple roots');
    else root = node;
    stack.length = depth; stack.push(node);
  };
  for (const line of expanded) {
    const depth = (line.length - line.trimStart().length) / 2;
    while (chains.length && chains[chains.length - 1]! >= depth) chains.pop();
    let rest = line.trimStart();
    const takeString = (): string => {
      const quoted = /^"(?:[^"\\]|\\.)*"/u.exec(rest);
      if (quoted) { rest = rest.slice(quoted[0].length); return JSON.parse(quoted[0]); }
      const ref = /^[A-Z](?=\s|,|\]|$)/u.exec(rest);
      if (!ref || !strings.has(ref[0])) throw new Error(`Invalid string: ${rest}`);
      rest = rest.slice(ref[0].length); return strings.get(ref[0])!;
    };
    if (rest.startsWith('cell+link ')) {
      rest = rest.slice(10);
      const name = takeString();
      if (rest.trim()) throw new Error('Trailing chain data');
      append({ role: 'cell', name, children: [] }, depth + chains.length);
      append({ role: 'link', name, children: [] }, depth + chains.length + 1);
      chains.push(depth); continue;
    }
    let role: string;
    if (rest.startsWith('role=')) { rest = rest.slice(5); role = takeString(); }
    else {
      const match = /^\S+/u.exec(rest);
      if (!match) throw new Error('Missing role');
      role = roles.get(match[0]) ?? match[0]; rest = rest.slice(match[0].length);
    }
    const node: SemanticNode = { role, children: [] };
    rest = rest.trimStart();
    if (rest.startsWith('"') || /^[A-Z](?:\s|$)/u.test(rest)) node.name = takeString();
    while ((rest = rest.replace(/^[\s,\[\]]+/u, '')).length) {
      const attribute = /^([A-Za-z]+)=/u.exec(rest);
      if (!attribute) throw new Error(`Invalid attribute: ${rest}`);
      const key = attribute[1]!; rest = rest.slice(attribute[0].length);
      if (key === 'value' || key === 'href' || key === 'placeholder' || key === 'description' || key === 'errorMessage') node[key] = takeString();
      else {
        const value = /^(true|false|mixed|-?\d+(?:\.\d+)?)/u.exec(rest);
        if (!value) throw new Error('Invalid state');
        rest = rest.slice(value[0].length);
        if (key === 'level') node.level = Number(value[0]);
        else {
          if (!['checked', 'selected', 'expanded', 'disabled', 'required', 'focusable', 'readonly', 'focused'].includes(key)) throw new Error(`Unknown attribute: ${key}`);
          node.states ??= {};
          (node.states as Record<string, unknown>)[key === 'readonly' ? 'readOnly' : key] = value[0] === 'mixed' ? 'mixed' : value[0] === 'true';
        }
      }
    }
    append(node, depth + chains.length);
  }
  if (!root) throw new Error('Missing page tree');
  return root;
}

function expandInline(line: string): string[] {
  const match = /^(\s*)paragraph inline=(.*)$/u.exec(line);
  if (!match) return [line];
  let rest = match[2]!;
  interface InlineNode { role: string; literal?: string; children: InlineNode[] }
  const children = (): InlineNode[] => {
    if (!rest.startsWith('{')) throw new Error('Missing inline group');
    rest = rest.slice(1).trimStart();
    const result: InlineNode[] = [];
    while (!rest.startsWith('}')) {
      const literal = /^(?:"(?:[^"\\]|\\.)*"|[A-Z](?=[;}\s]))/u.exec(rest)?.[0];
      if (literal) {
        rest = rest.slice(literal.length); result.push({ role: 'StaticText', literal, children: [] });
      } else {
        const role = /^[a-z]+/u.exec(rest)?.[0];
        if (!role) throw new Error('Invalid inline role');
        rest = rest.slice(role.length); result.push({ role, children: children() });
      }
      rest = rest.trimStart();
      if (rest.startsWith(';')) rest = rest.slice(1).trimStart();
      else if (!rest.startsWith('}')) throw new Error('Invalid inline separator');
    }
    rest = rest.slice(1); return result;
  };
  const node: InlineNode = { role: 'paragraph', children: children() };
  if (rest.trim()) throw new Error('Trailing inline data');
  const result: string[] = [];
  const visit = (item: InlineNode, depth: number) => {
    result.push('  '.repeat(depth) + item.role + (item.literal === undefined ? '' : ` ${item.literal}`));
    for (const child of item.children) visit(child, depth + 1);
  };
  visit(node, match[1]!.length / 2); return result;
}
