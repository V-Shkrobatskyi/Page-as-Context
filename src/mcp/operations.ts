// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import type { ActionCommand, ActionOutcome } from '../adapters/actions/contract';
export const WRITE_TOOLS = { click_element: 'click', fill_element: 'fill', select_option: 'select-option', set_checked: 'set-checked' } as const;
export const validMcpId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/u.test(value);
export function actionArguments(tool: string, raw: Record<string, unknown>): ActionCommand & { operationId: string; connectionId: string } {
  const action = WRITE_TOOLS[tool as keyof typeof WRITE_TOOLS];
  const fields = ['connectionId', 'snapshotId', 'elementRef', 'operationId', ...(action === 'fill' ? ['text'] : action === 'select-option' ? ['optionRef'] : action === 'set-checked' ? ['checked'] : [])];
  if (!action || Object.keys(raw).length !== fields.length || Object.keys(raw).some(key => !fields.includes(key)) ||
    !['connectionId', 'snapshotId', 'elementRef', 'operationId'].every(key => validMcpId(raw[key])) ||
    action === 'fill' && (typeof raw.text !== 'string' || raw.text.length > 10000) || action === 'select-option' && !validMcpId(raw.optionRef) ||
    action === 'set-checked' && typeof raw.checked !== 'boolean') throw new Error('invalid-request');
  return { action, connectionId: raw.connectionId as string, snapshotId: raw.snapshotId as string, elementRef: raw.elementRef as string, operationId: raw.operationId as string,
    ...(action === 'fill' ? { text: raw.text as string } : action === 'select-option' ? { optionRef: raw.optionRef as string } : action === 'set-checked' ? { checked: raw.checked as boolean } : {}) };
}

type Receipt = ActionOutcome & { operationId: string; snapshotId?: string; snapshotUnavailable?: string };
/** Never evict an operation ID while its grant can still use it. Cache receipts only. */
export class OperationLedger {
  private entries = new Map<string, { hash: string; receipt: Promise<Receipt> }>();
  clear() { this.entries.clear(); }
  async execute<T extends Receipt>(grant: string, args: ActionCommand & { operationId: string }, perform: () => Promise<T>): Promise<T | Receipt> {
    const encoded = new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b)))));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)), byte => byte.toString(16).padStart(2, '0')).join('');
    const key = `${grant}:${args.operationId}`, previous = this.entries.get(key);
    if (previous) { if (previous.hash !== hash) throw new Error('operation-id-reused'); return previous.receipt; }
    if (this.entries.size >= 1024 || [...this.entries.keys()].filter(key => key.startsWith(grant + ':')).length >= 64) throw new Error('operation-limit');
    let settle!: (receipt: Receipt) => void;
    const receipt = new Promise<Receipt>(resolve => { settle = resolve; }); this.entries.set(key, { hash, receipt });
    try {
      const result = await perform();
      settle({ operationId: result.operationId, status: result.status, ...(result.error ? { error: result.error } : {}),
        ...(result.snapshotId ? { snapshotId: result.snapshotId } : {}), ...(result.snapshotUnavailable ? { snapshotUnavailable: result.snapshotUnavailable } : {}) });
      return result;
    } catch {
      const unknown: Receipt = { operationId: args.operationId, status: 'outcome-unknown', error: 'outcome-unknown' }; settle(unknown); return unknown;
    }
  }
}
