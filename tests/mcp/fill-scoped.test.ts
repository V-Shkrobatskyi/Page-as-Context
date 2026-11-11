// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import type { SemanticTree, SemanticNode } from '@/src/core/model';
import { boundedScopeTree, projectFillScope, waitForFillObservation } from '@/src/mcp/fill-scoped';
import { prepareExport } from '@/src/core/export';
import { actionArguments } from '@/src/mcp/operations';
import { toolCatalog, validateToolArguments, toolResult } from '../../helper/src/catalog.mjs';
const id = () => crypto.randomUUID();
function fixture(value = 'old'): SemanticTree {
  return { schemaVersion: 1, sourceUrl: 'https://example.test/', root: { role: 'page', children: [
    { role: 'group', children: [{ role: 'textbox', name: 'Same name', value, actionRef: id(), captureIdentity: 'stable-document-node', children: [] }] },
    { role: 'textbox', name: 'Same name', value: 'other', actionRef: id(), captureIdentity: 'other-node', children: [] },
    { role: 'status', name: 'Ready', children: [] },
    ...Array.from({ length: 70 }, (_, n) => ({ role: 'paragraph', name: 'Unrelated page text ' + n, children: [] })),
  ] } };
}
const field = (tree: SemanticTree) => tree.root.children[0]!.children[0]!;
const request = (tree: SemanticTree) => ({ before: tree, elementRef: field(tree).actionRef!, parentTag: 'label' });
describe('fill scoped contract', () => {
  it('accepts optional scoped only for fill on shared native and HTTP catalogs', () => {
    const args = { connectionId: id(), snapshotId: id(), elementRef: id(), operationId: id(), text: '', responseMode: 'scoped' };
    expect(actionArguments('fill_element', args).responseMode).toBe('scoped');
    expect(validateToolArguments('fill_element', args)).toEqual(args);
    const { responseMode: _, ...legacy } = args;
    expect(validateToolArguments('fill_element', legacy)).toEqual(legacy);
    expect(actionArguments('fill_element', legacy).responseMode).toBe('scoped');
    expect(actionArguments('fill_element', { ...legacy, responseMode: 'full' }).responseMode).toBe('full');
    expect(toolCatalog().find(tool => tool.name === 'fill_element')!.inputSchema.properties.responseMode).toMatchObject({ default: 'scoped' });
    for (const responseMode of [null, '', 'partial', false]) {
      expect(() => actionArguments('fill_element', { ...args, responseMode })).toThrow();
      expect(() => validateToolArguments('fill_element', { ...args, responseMode })).toThrow();
    }
    const { text: _text, ...click } = args;
    expect(() => actionArguments('click_element', click)).toThrow();
    expect(() => validateToolArguments('click_element', click)).toThrow();
    expect(toolCatalog().find(tool => tool.name === 'fill_element')!.inputSchema.required).not.toContain('responseMode');
  });
  it('matches document identities, returns one field and changed validation, issues no other refs', () => {
    const before = fixture(), after = fixture('Ukraine 🌻\nnew value');
    after.root.children[2]!.name = 'Validation failed';
    const result = projectFillScope(after, request(before));
    expect(result.scope).toMatchObject({ kind: 'scoped', omitted: 'rest-of-page', parentTag: 'label', parentSummaryOnly: true });
    const output = prepareExport(result.tree, 'compact', 'semantic-text', true, undefined, undefined, { profile: 'agent-context' });
    expect(output.actionTargets?.map(target => target.ref)).toEqual([field(after).actionRef]);
    expect(output.serialized.content).toContain('Validation failed');
    expect(output.serialized.content).not.toContain('Unrelated page text');
    expect(output.serialized.content).not.toContain('stable-document-node');
    const full = prepareExport(after, 'compact', 'semantic-text', true, undefined, undefined, { profile: 'agent-context' });
    expect(JSON.stringify(toolResult({ context: output.serialized.content, scope: result.scope })).length).toBeLessThan(JSON.stringify(toolResult({ context: full.serialized.content })).length);
  });
  it.each(['replacement', 'other-field', 'new-popup', 'navigation', 'missing-identity', 'duplicate-identity', 'no-parent'] as const)('falls back without guessing: %s', reason => {
    const before = fixture(), after = fixture('new'), req = request(before);
    if (reason === 'replacement') field(after).captureIdentity = 'replacement';
    if (reason === 'other-field') after.root.children[1]!.value = 'changed';
    if (reason === 'new-popup') after.root.children.push({ role: 'listbox', name: 'Suggestions', children: [] });
    if (reason === 'navigation') after.sourceUrl += 'next';
    if (reason === 'missing-identity') delete field(after).actionRef;
    if (reason === 'duplicate-identity') after.root.children.push({ ...field(after) });
    if (reason === 'no-parent') req.parentTag = '';
    expect(projectFillScope(after, req).scope).toMatchObject({ kind: 'full', omitted: 'none', fallbackReason: expect.any(String) });
  });
  it('includes removal and unchanged values without claiming application persistence', () => {
    const before = fixture(), after = fixture(); after.root.children.splice(2, 1);
    const result = projectFillScope(after, request(before));
    expect(result.scope).toMatchObject({ kind: 'scoped', relatedRegionRemoved: true });
    expect(result.scope.observation).toContain('not verified');
  });
  it('bounds baseline memory and does not emit redacted target references', () => {
    const tree = fixture(); tree.root.children.push({ role: 'paragraph', name: 'x'.repeat(150000), children: [] });
    expect(boundedScopeTree(tree)).toBeUndefined();
    const before = fixture(), after = fixture('new');
    const safe = (tree: SemanticTree) => { let result!: SemanticTree; prepareExport(tree, 'compact', 'semantic-text', true, undefined,
      { includeFormValues: false, includeTitle: true, pageUrl: 'omit', linkUrls: 'omit' }, { profile: 'agent-context' }, projected => { result = projected; }); return result; };
    const filtered = projectFillScope(safe(after), { ...request(before), before: safe(before) });
    expect(filtered.scope.kind).toBe('full');
  });
  it('waits a bounded window and cancels without writing', async () => {
    vi.useFakeTimers();
    try {
      const signal = new AbortController(); const pending = waitForFillObservation(signal.signal);
      await vi.advanceTimersByTimeAsync(150); await pending;
      const cancel = waitForFillObservation(signal.signal); const rejected = expect(cancel).rejects.toThrow('cancelled'); signal.abort(); await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});


it('emits nested status regions once and detects removal among duplicate messages', () => {
  const before = fixture(), after = fixture('new');
  const nested: SemanticNode = { role: 'status', name: 'Outer', children: [{ role: 'status', name: 'Inner', children: [] }] };
  after.root.children.push(nested);
  const result = projectFillScope(after, request(before));
  expect(result.scope.kind).toBe('scoped'); expect(result.tree.root.children.filter(node => node === nested)).toHaveLength(1);
  const duplicate = structuredClone(before.root.children[2]!); before.root.children.push(duplicate);
  const removed = projectFillScope(fixture('new'), request(before));
  expect(removed.scope).toMatchObject({ kind: 'scoped', relatedRegionRemoved: true });
});


it('keeps changed textarea value descendants within the returned target scope', () => {
  const before = fixture(''), after = fixture('First line\nSecond line 🌻');
  field(after).children = [{ role: 'generic', children: [{ role: 'StaticText', name: 'First line', children: [] }, { role: 'StaticText', name: 'Second line 🌻', children: [] }] }];
  const result = projectFillScope(after, request(before));
  expect(result.scope.kind).toBe('scoped'); expect(result.tree.root.children[0]).toBe(field(after));
});
