// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { projectTargetRead } from '@/src/mcp/targeted-read';
import type { SemanticNode, SemanticTree } from '@/src/core/model';
import { prepareExport } from '@/src/core/export';
import { toolCatalog, validateToolArguments } from '../../helper/src/catalog.mjs';
const node = (role: string, name?: string, children: SemanticNode[] = []): SemanticNode => ({ role, name, children });
const tree = (...children: SemanticNode[]): SemanticTree => ({ schemaVersion: 1, root: node('page', undefined, children) });
const request = { target: { role: 'textbox', name: 'Display name' } };
const field = (): SemanticNode => ({ ...node('textbox', 'Display name'), actionRef: crypto.randomUUID(), captureIdentity: 'private-identity',
  value: 'Example', description: 'Use a public name', errorMessage: 'Name is too short', states: { required: true, readOnly: false, disabled: false } });
const projectSanitized = (source: SemanticTree) => {
  let sanitized!: SemanticTree;
  prepareExport(source, 'compact', 'semantic-text', true, undefined, undefined, { profile: 'agent-context' }, value => { sanitized = value; });
  return projectTargetRead(sanitized, request);
};
describe('targeted read contract', () => {
  it('uses one read-only catalog for native and HTTP with closed semantic queries', () => {
    const connectionId = crypto.randomUUID();
    expect(toolCatalog().find(tool => tool.name === 'read_target_context')?.annotations.readOnlyHint).toBe(true);
    expect(validateToolArguments('read_target_context', { connectionId, ...request })).toMatchObject(request);
    expect(validateToolArguments('read_target_context', { connectionId, target: { role: 'textbox', placeholder: 'Hint' } })).toHaveProperty('target');
    expect(validateToolArguments('read_target_context', { connectionId, ...request, group: { role: 'form', name: 'Profile' }, context: 'group' })).toHaveProperty('group');
    for (const bad of [ {}, { target: {} }, { target: { role: 'textbox' } }, { target: { role: 'textbox', name: '' } },
      { target: { role: 'textbox', name: '   ' } }, { target: { role: 'textbox', name: 'x', placeholder: 'x' } },
      { target: { role: 'button', placeholder: 'x' } }, { ...request, selector: '#x' }, { target: { ...request.target, id: 'x' } },
      { ...request, group: { role: 'generic', name: 'Profile' } }, { ...request, context: 'group' },
      { ...request, group: null }, { target: [] }, { target: { role: 'textbox', name: 'x'.repeat(301) } },
    ]) expect(() => validateToolArguments('read_target_context', { connectionId, ...bad })).toThrow('invalid-request');
  });
  it('returns one target with its supporting text, group summary and local status; only shown refs survive', () => {
    const target = field(), outside = { ...node('button', 'Outside'), actionRef: crypto.randomUUID() };
    const result = projectSanitized(tree(node('form', 'Profile', [target, node('status', 'Check the name'), outside]), node('alert', 'Outside alert')));
    expect(result.info).toMatchObject({ outcome: 'found', scope: 'target', omitted: 'rest-of-page' });
    const output = prepareExport(result.tree, 'compact', 'semantic-text', true, undefined, undefined, { profile: 'agent-context' });
    expect(output.serialized.content).toContain('Use a public name'); expect(output.serialized.content).toContain('Name is too short');
    expect(output.serialized.content).toContain('required=true'); expect(output.serialized.content).toContain('Check the name');
    expect(output.serialized.content).not.toContain('Outside'); expect(output.serialized.content).not.toContain('private-identity');
    expect(output.actionTargets?.map(item => item.ref)).toEqual([target.actionRef]);
  });
  it('never guesses repeated names or groups, including separate documents', () => {
    const source = tree(node('form', 'Profile', [field()]), node('form', 'Other', [field()]));
    expect(projectTargetRead(source, request).info).toMatchObject({ outcome: 'ambiguous', candidates: [{ group: { name: 'Profile' } }, { group: { name: 'Other' } }] });
    expect(projectTargetRead(source, { ...request, group: { role: 'form', name: 'Profile' } }).info.outcome).toBe('found');
    source.root.children[1]!.name = 'Profile';
    expect(projectTargetRead(source, { ...request, group: { role: 'form', name: 'Profile' } }).info.reason).toBe('group-ambiguous');
    const frames = tree(field(), node('embedded-document', 'Frame', [node('page', 'Frame page', [field()])]));
    expect(projectTargetRead(frames, request).info.outcome).toBe('ambiguous');
    const framedGroup = tree(node('form', 'Profile', [node('embedded-document', 'Frame', [node('page', undefined, [field()])])]));
    expect(projectTargetRead(framedGroup, { ...request, group: { role: 'form', name: 'Profile' } }).info.outcome).toBe('not-found');
  });
  it('uses a visible placeholder only on unnamed native field semantics with exact case', () => {
    const unnamed = { ...node('textbox'), placeholder: 'Public hint' };
    expect(projectTargetRead(tree(unnamed), { target: { role: 'textbox', placeholder: 'Public hint' } }).info.outcome).toBe('found');
    unnamed.name = 'Named';
    expect(projectTargetRead(tree(unnamed), { target: { role: 'textbox', placeholder: 'Public hint' } }).info.outcome).toBe('not-found');
    expect(projectTargetRead(tree(field()), { target: { role: 'textbox', name: 'display name' } }).info.outcome).toBe('not-found');
  });
  it('returns explicit incomplete/unavailable without candidate refs or a truncated group', () => {
    expect(projectTargetRead(tree(field()), request, true).info).toMatchObject({ outcome: 'capture-incomplete', reason: 'capture-partial' });
    expect(projectTargetRead(tree(), request, true).info.outcome).toBe('capture-incomplete');
    const source = tree(node('form', 'Profile', [field(), ...Array.from({ length: 80 }, () => node('button', 'Other'))]));
    const result = projectTargetRead(source, { ...request, context: 'group', group: { role: 'form', name: 'Profile' } });
    expect(result.info).toMatchObject({ outcome: 'context-unavailable', reason: 'scope-node-limit' }); expect(result.tree.root.children).toEqual([]);
    const regions = tree(node('form', 'Profile', [field(), ...Array.from({ length: 5 }, () => node('status', 'Status'))]));
    expect(projectTargetRead(regions, request).info.reason).toBe('related-region-limit');
    const huge = tree(field(), node('paragraph', '🌻'.repeat(150000)));
    expect(projectTargetRead(huge, request).info.reason).toBe('projection-limit');
    const many = projectTargetRead(tree(...Array.from({ length: 7 }, field)), request);
    expect(many.info.candidates).toHaveLength(5); expect(many.info.candidatesOmitted).toBe(true);
    expect(JSON.stringify(many)).not.toContain('private-identity'); expect(JSON.stringify(many)).not.toContain('actionRef');
  });
  it('searches sanitized labels and never restores excluded supporting values or refs', () => {
    const target = { ...field(), name: 'API token', value: 'SYNTHETIC-SECRET', description: 'SYNTHETIC-SECRET', errorMessage: 'SYNTHETIC-SECRET' };
    const source = tree(target);
    const result = prepareExport(source, 'compact', 'semantic-text', true);
    expect(result.serialized.content).not.toContain('SYNTHETIC-SECRET');
    for (const format of ['semantic-text', 'markdown'] as const) {
      const excluded = prepareExport(source, 'compact', format, false, undefined, { includeTitle: true, includeFormValues: false, pageUrl: 'omit', linkUrls: 'omit' });
      expect(excluded.serialized.content).not.toContain('SYNTHETIC-SECRET'); expect(excluded.serialized.content).not.toContain(target.actionRef);
    }
  });
});
