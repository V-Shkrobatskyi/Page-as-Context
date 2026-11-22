// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { prepareExport, compressSemanticTree, redactSemanticTree, type SemanticNode, type SemanticTree } from '@/src/core';
import { applyDataControls, DEFAULT_DATA_CONTROLS } from '@/src/core/data-controls';
import { decodeMaximum } from '../helpers/decode-maximum';

const fields = ['placeholder', 'description', 'errorMessage'] as const;
const formats = ['semantic-text', 'markdown'] as const;
const profiles = ['standard', 'agent-context'] as const;
const leaf = (role: string, name?: string): SemanticNode => ({ role, ...(name === undefined ? {} : { name }), children: [] });
const repeated = (): SemanticTree => ({
  schemaVersion: 1, title: 'Synthetic deployment dashboard', sourceUrl: 'https://example.test/dashboard', capturedAt: '2026.11.21 12:00:00',
  root: { role: 'page', children: Array.from({ length: 100 }, () => ({
    role: 'navigation', name: 'Shared deployment navigation', children: [leaf('link', 'Review deployment configuration for all regions')],
  })) },
});
const expected = (tree: SemanticTree, privacy: boolean) => {
  const compact = compressSemanticTree(tree, 'compact');
  return (privacy ? redactSemanticTree(compact).tree : compact).root;
};
const packed = (tree: SemanticTree, format: typeof formats[number], privacy = false, profile: typeof profiles[number] = 'standard') => {
  const output = prepareExport(tree, 'maximum', format, privacy, undefined, undefined, { profile });
  expect(output.serialized.content).toContain('Encoding:');
  expect(output.characterCount).toBe(output.serialized.content.length);
  expect(output.approximateTokenCount).toBe(Math.ceil(output.characterCount / 4));
  const compact = prepareExport(tree, 'compact', format, privacy, undefined, undefined, { profile });
  expect(output.characterCount).toBeLessThan(compact.characterCount);
  expect(output.redactionCount).toBe(compact.redactionCount);
  const baseline = prepareExport(tree, 'without', format, privacy, undefined, undefined, { profile });
  expect(output.reductionRatio).toBe(Math.max(0, 1 - output.characterCount / baseline.characterCount));
  expect(decodeMaximum(output.serialized.content, format === 'markdown')).toEqual(expected(tree, privacy));
  return output;
};

describe('Maximum preserves supporting field context while packing', () => {
  for (const format of formats) for (const privacy of [false, true]) for (const profile of profiles) {
    for (const field of fields) it(`${format}/${profile}/${privacy}: one ${field} does not disable the whole page`, () => {
      const tree = repeated();
      tree.root.children.push({ ...leaf('textbox', 'Search deployments'), [field]: 'Synthetic supporting text' });
      const before = structuredClone(tree);
      packed(tree, format, privacy, profile);
      expect(tree).toEqual(before);
    });
  }

  for (const format of formats) for (const field of fields) {
    it(`${format}: subtree templates distinguish different ${field} values`, () => {
      const tree = repeated();
      tree.root.children = Array.from({ length: 60 }, (_, i) => ({
        role: 'group', [field]: i % 2 ? 'A' : 'B', children: [
          leaf('button', 'Review deployment configuration for all regions'),
          leaf('textbox', 'Deployment environment configuration details'),
          leaf('checkbox', 'Enable deployment notifications for every selected region'),
        ],
      }));
      expect(packed(tree, format).serialized.content).toContain('Trees:');
    });

    for (const target of ['cell', 'link'] as const) it(`${format}: chain packing preserves ${field} on ${target}`, () => {
      const tree = repeated();
      tree.root.children = Array.from({ length: 60 }, (_, i) => ({
        role: 'cell', name: `Deployment configuration for region ${i}`, children: [leaf('link', `Deployment configuration for region ${i}`)],
      }));
      const node = tree.root.children[7]!;
      (target === 'cell' ? node : node.children[0]!)[field] = 'Distinct supporting context';
      expect(packed(tree, format).serialized.content).toContain('Chains:');
    });

    for (const target of ['paragraph', 'StaticText', 'strong', 'code'] as const) it(`${format}: inline packing preserves ${field} on ${target}`, () => {
      const tree = repeated();
      tree.root.children = Array.from({ length: 60 }, (_, i) => ({
        role: 'paragraph', children: [leaf('StaticText', `Start ${i}`), { role: 'strong', children: [leaf('StaticText', 'Important')] },
          { role: 'code', children: [leaf('StaticText', 'resource')] }, leaf('StaticText', `End ${i}`)],
      }));
      const node = tree.root.children[7]!;
      (target === 'paragraph' ? node : node.children.find(child => child.role === target)!)[field] = 'Distinct supporting context';
      expect(packed(tree, format).serialized.content).toContain('Inline:');
    });

    it(`${format}: escapes ${field} literals without interpreting dictionary or tree references`, () => {
      const tree = repeated();
      tree.root.children.push({ ...leaf('textbox', 'Notes'), [field]: 'A @T1 "quoted" \\ path\nnext\tline 🙂\u2028\u2029 `[]_*<>;{}' });
      packed(tree, format);
      tree.root.children[100]![field] = '';
      packed(tree, format);
    });
  }

  for (const format of formats) it(`${format}: filters and excludes private hints before templates and dictionaries`, () => {
    const tree = repeated();
    tree.root.children.push({ ...leaf('textbox', 'API key'), placeholder: 'token=SYNTHETIC_PRIVATE_HINT',
      description: 'SYNTHETIC_PRIVATE_DESCRIPTION', errorMessage: 'SYNTHETIC_PRIVATE_ERROR', value: 'SYNTHETIC_PRIVATE_VALUE' });
    const output = packed(tree, format, true);
    expect(output.serialized.content).not.toContain('SYNTHETIC_PRIVATE');
    const controls = { ...DEFAULT_DATA_CONTROLS, includeFormValues: false };
    const excluded = prepareExport(tree, 'maximum', format, true, undefined, controls);
    expect(excluded.serialized.content).toContain('Encoding:');
    expect(excluded.serialized.content).not.toContain('SYNTHETIC_PRIVATE');
    expect(decodeMaximum(excluded.serialized.content, format === 'markdown')).toEqual(expected(applyDataControls(tree, controls), true));
  });

  for (const format of formats) it(`${format}: keeps fallback for small exports and action references`, () => {
    const small: SemanticTree = { schemaVersion: 1, root: { role: 'page', children: [
      { ...leaf('textbox', 'Search'), placeholder: 'Search items', description: 'Help', errorMessage: 'Invalid' },
    ] } };
    for (const field of [small, repeated()]) {
      if (field !== small) field.root.children.push({ ...leaf('button', 'Continue'), actionRef: 'synthetic_action_reference' });
      const maximum = prepareExport(field, 'maximum', format, false);
      const compact = prepareExport(field, 'compact', format, false);
      expect(maximum.serialized.content).not.toContain('Encoding:');
      expect(maximum.characterCount).toBe(compact.characterCount);
      expect(maximum.serialized.content.replace(/\/6 \(/u, '/4 (')).toBe(compact.serialized.content);
    }
  });
});
