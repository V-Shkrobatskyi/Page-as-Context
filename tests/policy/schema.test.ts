// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_FILTERS } from '@/src/core/privacy/settings';
import { validatePolicy } from '@/src/policy/model';

const schema = JSON.parse(readFileSync('public/managed-schema.json', 'utf8'));
describe('Chrome managed schema compatibility', () => {
  it('validates independent clear permissions as booleans', () => {
    for (const key of ['CaptureHistoryClearAllowed', 'TechnicalLogClearAllowed']) {
      expect(schema.properties[key].type).toBe('boolean');
      for (const value of [true, false]) expect(validatePolicy({ [key]: value })).toMatchObject({ [key]: value });
      expect(() => validatePolicy({ [key]: 'false' })).toThrow(key);
    }
  });
  it('uses Chrome’s supported schema dialect, including object-valued additionalProperties only', () => {
    const attributes: Record<string, string[]> = {
      object: ['properties', 'required', 'additionalProperties'], array: ['items'],
      string: ['enum', 'pattern'], integer: ['enum', 'minimum', 'maximum'], boolean: [],
    };
    function visit(node: any) {
      expect(Object.keys(attributes)).toContain(node.type);
      for (const key of Object.keys(node)) expect(['type', 'title', 'description', 'sensitiveValue', ...attributes[node.type]!]).toContain(key);
      if (node.additionalProperties !== undefined) { expect(typeof node.additionalProperties).toBe('object'); visit(node.additionalProperties); }
      for (const child of Object.values(node.properties ?? {})) visit(child);
      if (node.items) visit(node.items);
    }
    expect(schema.type).toBe('object'); expect(schema.additionalProperties).toBeUndefined(); visit(schema);
    expect(schema.properties.RequiredBuiltinFilters.items.enum).toEqual(BUILTIN_FILTERS.map(filter => filter.id));
    expect(schema.properties.DisabledBuiltinFilters.items.enum).toEqual(BUILTIN_FILTERS.map(filter => filter.id));
  });
  it('keeps every documented preset valid at the runtime boundary', () => {
    for (const file of ['recommended.json', 'required-redaction.json', 'strict.json', 'builtin-filters.json', 'data-controls.json', 'mcp-read-only.json']) {
      const preset = JSON.parse(readFileSync(`docs/enterprise/${file}`, 'utf8'));
      expect(() => validatePolicy(preset)).not.toThrow();
      for (const key of Object.keys(preset)) expect(schema.properties).toHaveProperty(key);
    }
  });
});
