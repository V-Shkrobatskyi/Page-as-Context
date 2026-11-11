// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChromeAxTree } from '@/src/adapters/chrome/normalize-ax';
import { captureDomPage } from '@/src/adapters/dom/capture';
import { isDomCaptureOutcome } from '@/src/adapters/dom/validate';
import { prepareExport } from '@/src/core/export';
import { sanitizeActionReferences } from '@/src/core/action-projection';
import { defaultRedactionSettings } from '@/src/core/privacy';
import { DEFAULT_DATA_CONTROLS } from '@/src/core/data-controls';
import { projectFillScope } from '@/src/mcp/fill-scoped';
import { domOperation } from '@/src/adapters/actions/dom-operation';
import type { SemanticNode, SemanticTree } from '@/src/core/model';
const all = (node: SemanticNode): SemanticNode[] => [node, ...node.children.flatMap(all)];
const tree = (value: string, name = 'First Name', placeholder?: string): SemanticTree => ({ schemaVersion: 1,
  root: { role: 'page', children: [{ role: 'textbox', ...(name ? { name } : {}), ...(placeholder ? { placeholder } : {}),
    value, actionRef: crypto.randomUUID(), captureIdentity: 'stable-private-node', children: [] }] } });
function output(input: SemanticTree, settings = defaultRedactionSettings(), data = DEFAULT_DATA_CONTROLS) {
  let filtered!: SemanticTree;
  const result = prepareExport(input, 'compact', 'semantic-text', true, settings, data, { profile: 'agent-context' }, t => { filtered = t; });
  return { ...result, filtered };
}
describe('form observation fixes', () => {
  it('distinguishes known-empty Chrome AX values from absent values', () => {
    for (const present of [true, false]) {
      const result = normalizeChromeAxTree({ nodes: [
        { nodeId: 'root', role: { value: 'RootWebArea' }, childIds: ['field'] },
        { nodeId: 'field', role: { value: 'textbox' }, name: { value: '' }, ...(present ? { value: { type: 'string', value: '' } } : {}) },
      ] });
      expect(result.ok).toBe(true); if (!result.ok) throw new Error('capture failed');
      const field = result.tree.root.children[0]!;
      expect(field.value).toBe(present ? '' : undefined); expect(field.name).toBeUndefined();
      expect(output(result.tree).serialized.content.includes('value=""')).toBe(present);
    }
  });
  it('keeps masked ordinary text targets writable, scoped and clearable without exposing raw values', () => {
    for (const [label, hint] of [['First Name', undefined], ['Current Address', undefined], ['', 'First Name']] as const) {
      const before = output(tree('', label, hint)), afterTree = tree('SyntheticExample', label, hint), after = output(afterTree);
      const target = afterTree.root.children[0]!;
      expect(after.actionTargets?.map(t => t.ref)).toEqual([target.actionRef]);
      expect(after.serialized.content).not.toContain('SyntheticExample');
      expect(after.serialized.content).not.toContain('stable-private-node');
      const scope = projectFillScope(after.filtered, { before: before.filtered, elementRef: before.actionTargets![0]!.ref, parentTag: 'div' });
      expect(scope.scope.kind).toBe('scoped');
      const clearTree = tree('', label, hint), cleared = output(clearTree);
      expect(cleared.actionTargets?.[0]?.ref).toBe(clearTree.root.children[0]!.actionRef);
      expect(cleared.serialized.content).toContain('value=""');
    }
  });
  it('never infers permission from a mask-looking string without redactor provenance', () => {
    const original = tree('Secret input'), changed = structuredClone(original);
    changed.root.children[0]!.value = 'Sec*********';
    expect(sanitizeActionReferences(original, changed).root.children[0]!.actionRef).toBeUndefined();
  });
  it('still removes refs for full hides, secret patterns, changed labels, non-text controls and excluded values', () => {
    const hide = defaultRedactionSettings(); hide.disabledBuiltins = hide.disabledBuiltins.filter(id => id !== 'personal-fields');
    expect(output(tree('SyntheticExample'), hide).actionTargets).toBeUndefined();
    expect(output(tree('4111111111111111')).actionTargets).toBeUndefined();
    expect(output(tree('SyntheticExample'), undefined, { ...DEFAULT_DATA_CONTROLS, includeFormValues: false }).actionTargets).toBeUndefined();
    const missingIdentity = tree('SyntheticExample'); delete missingIdentity.root.children[0]!.captureIdentity;
    expect(output(missingIdentity).actionTargets).toBeUndefined();
    const combo = tree('SyntheticExample'); combo.root.children[0]!.role = 'combobox';
    expect(output(combo).actionTargets).toBeUndefined();
    const changed = tree('SyntheticExample', 'First Name secret=abcdefghijk');
    expect(output(changed).actionTargets).toBeUndefined();
  });
  it('reports filtered targets separately from replacements', () => {
    const before = tree(''), hidden = output(tree('4111111111111111'));
    expect(projectFillScope(hidden.filtered, { before, elementRef: before.root.children[0]!.actionRef!, parentTag: 'div' }).scope.fallbackReason).toBe('target-filtered');
    hidden.filtered.root.children[0]!.captureIdentity = 'another-node';
    expect(projectFillScope(hidden.filtered, { before, elementRef: before.root.children[0]!.actionRef!, parentTag: 'div' }).scope.fallbackReason).toBe('target-replaced-or-filtered');
  });
  it('exposes unnamed DOM placeholders separately, filters them and validates changed hints', () => {
    const dom = new JSDOM('<label for="wrong">Name</label><input placeholder="First Name"><input placeholder="Last Name"><input type="password" placeholder="private hint">', { url: 'https://example.test/' });
    try {
      const result = captureDomPage(dom.window.document); expect(result.ok).toBe(true); expect(isDomCaptureOutcome(result)).toBe(true);
      if (!result.ok) throw new Error('capture failed');
      const fields = all(result.tree.root).filter(n => n.role === 'textbox');
      expect(fields.slice(0, 2).map(n => n.name)).toEqual([undefined, undefined]);
      expect(fields.slice(0, 2).map(n => n.placeholder)).toEqual(['First Name', 'Last Name']);
      expect(fields[2]!.placeholder).toBeUndefined();
      for (const compression of ['without', 'detailed', 'compact', 'maximum'] as const) for (const format of ['semantic-text', 'markdown'] as const) {
        const resultExport = prepareExport(result.tree, compression, format, true);
        expect(resultExport.serialized.content).toContain('First Name'); expect(resultExport.serialized.content).toContain('Last Name');
        expect(resultExport.characterCount).toBe(resultExport.serialized.content.length);
      }
      const field = dom.window.document.querySelector('input')!;
      const first = domOperation.call(field, { action: 'signature', sensitivePattern: 'password' }).signature;
      field.placeholder = 'Changed';
      expect(domOperation.call(field, { action: 'signature', sensitivePattern: 'password' }).signature).not.toBe(first);
      const privateHint = tree('', '', 'person@example.test');
      expect(output(privateHint).serialized.content).not.toContain('person@example.test');
    } finally { dom.window.close(); }
  });
});
