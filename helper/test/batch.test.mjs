// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolCatalog, validateToolArguments, toolResult, WRITE_TOOL_ACTIONS } from '../src/catalog.mjs';
const args = () => ({ connectionId: 'connection_00000001', snapshotId: 'snapshot_000000001', operationId: 'operation_00000001', actions: [
  { action: 'fill', elementRef: 'element_000000001', text: 'Synthetic 🌻' },
  { action: 'select-option', elementRef: 'element_000000002', optionRef: 'option_0000000001' },
  { action: 'set-checked', elementRef: 'element_000000003', checked: true },
] });
test('the shared native/HTTP catalog accepts typed batch items and marks writes for unknown-outcome handling', () => {
  const value = args(); assert.deepEqual(validateToolArguments('write_elements', value), value);
  assert.equal(WRITE_TOOL_ACTIONS.write_elements, 'batch');
  assert.equal(toolCatalog().find(tool => tool.name === 'write_elements').inputSchema.properties.actions.maxItems, 10);
  assert.equal(toolResult({ status: 'partial', actions: [{ index: 0, status: 'applied' }] }).isError, true);
});
test('nested overrides, duplicate targets, clicks and response modes fail before transport dispatch', () => {
  for (const edit of [value => { value.actions[0].snapshotId = 'another_snapshot_001'; }, value => { value.actions[0].responseMode = 'full'; },
    value => { value.actions.push(value.actions[0]); }, value => { value.actions[0].action = 'click'; }, value => { value.actions = []; }]) {
    const value = args(); edit(value); assert.throws(() => validateToolArguments('write_elements', value), /invalid-request/);
  }
});
