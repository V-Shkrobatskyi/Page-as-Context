// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import type { SemanticNode, SemanticTree } from './model';

export const PAGE_URL_MODES = ['full', 'without-query', 'origin', 'omit'] as const;
export const LINK_URL_MODES = ['full', 'without-query', 'omit'] as const;
export interface DataControls {
  includeTitle: boolean;
  pageUrl: typeof PAGE_URL_MODES[number];
  linkUrls: typeof LINK_URL_MODES[number];
  includeFormValues: boolean;
}
export const DEFAULT_DATA_CONTROLS: Readonly<DataControls> = { includeTitle: true, pageUrl: 'full', linkUrls: 'full', includeFormValues: true };
export function validateDataControls(raw: unknown): DataControls {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid data controls.');
  const v = raw as DataControls;
  if (Object.keys(raw).some(k => !Object.hasOwn(DEFAULT_DATA_CONTROLS, k)) || typeof v.includeTitle !== 'boolean' || typeof v.includeFormValues !== 'boolean' || !PAGE_URL_MODES.includes(v.pageUrl) || !LINK_URL_MODES.includes(v.linkUrls)) throw new Error('Invalid data controls.');
  return { includeTitle: v.includeTitle, pageUrl: v.pageUrl, linkUrls: v.linkUrls, includeFormValues: v.includeFormValues };
}
export const FORM_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'slider', 'checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);
function urlValue(value: string | undefined, mode: DataControls['pageUrl']): string | undefined {
  if (value === undefined || mode === 'full') return value;
  if (mode === 'omit') return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) return undefined;
    if (mode === 'origin') return url.origin === 'null' ? undefined : url.origin;
    url.search = ''; url.hash = ''; url.username = ''; url.password = '';
    return url.href;
  } catch { return undefined; }
}
/** Mandatory exclusions precede compression, optional redaction and all dictionaries. */
export function applyDataControls(tree: SemanticTree, c: DataControls = DEFAULT_DATA_CONTROLS): SemanticTree {
  if (JSON.stringify(c) === JSON.stringify(DEFAULT_DATA_CONTROLS)) return tree;
  const visit = (node: SemanticNode): SemanticNode => {
    const field = FORM_ROLES.has(node.role) || node.editable === true;
    const result: SemanticNode = { ...node, children: !c.includeFormValues && field ? [] : node.children.map(visit) };
    if (!c.includeFormValues) {
      if (field) { if (node.name !== undefined && node.name === node.value) delete result.name; if (node.placeholder === node.value) delete result.placeholder; delete result.value; }
      if (node.states) { result.states = { ...node.states }; delete result.states.checked; delete result.states.selected; }
    }
    if (node.role === 'page') {
      if (!c.includeTitle) delete result.name;
      result.href = urlValue(node.href, c.pageUrl);
    } else result.href = urlValue(node.href, c.linkUrls);
    return result;
  };
  return { ...tree, title: c.includeTitle ? tree.title : undefined, sourceUrl: urlValue(tree.sourceUrl, c.pageUrl), root: visit(tree.root) };
}
