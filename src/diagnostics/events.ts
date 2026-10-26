// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
export const LOG_LEVELS = ['off', 'error', 'info', 'debug'] as const;
export type LogLevel = typeof LOG_LEVELS[number];
export const EVENT_CODES = ['mcp-read', 'mcp-write', 'background-ready', 'capture-start', 'capture-complete', 'picker-start', 'picker-complete', 'preview-transfer', 'clipboard-complete', 'download-complete', 'filters-load', 'filters-save', 'policy-check'] as const;
export const REASONS = ['none', 'failed', 'cancelled', 'policy-blocked', 'permission-denied', 'capture-timeout', 'capture-limit', 'page-changed', 'invalid-tree', 'unsupported-page', 'debugger-busy', 'capture-failed', 'capture-unavailable', 'redaction-settings'] as const;
export interface EventInput {
  code: typeof EVENT_CODES[number];
  result: 'started' | 'success' | 'error';
  reason?: typeof REASONS[number];
  operation?: string;
  durationMs?: number;
}
export function eventComponent(code: EventInput['code']): string {
  if (code.startsWith('mcp-')) return 'mcp';
  if (code.startsWith('capture')) return 'capture';
  if (code.startsWith('picker')) return 'picker';
  if (code.startsWith('filters')) return 'filters';
  if (code.startsWith('clipboard')) return 'clipboard';
  if (code.startsWith('download')) return 'download';
  if (code.startsWith('preview')) return 'preview';
  return code === 'policy-check' ? 'policy' : 'background';
}
export interface LogEvent extends EventInput { component: string; version: 1; time: number; level: Exclude<LogLevel, 'off'>; repeats: number }
export function validateEvent(value: unknown): EventInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as EventInput;
  if (Object.keys(v).some(k => !['code', 'result', 'reason', 'operation', 'durationMs'].includes(k)) || !EVENT_CODES.includes(v.code) || !['started', 'success', 'error'].includes(v.result) || v.reason !== undefined && !REASONS.includes(v.reason) || v.operation !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v.operation) || v.durationMs !== undefined && (!Number.isSafeInteger(v.durationMs) || v.durationMs < 0 || v.durationMs > 3600000)) return;
  return { code: v.code, result: v.result, ...(v.reason ? { reason: v.reason } : {}), ...(v.operation ? { operation: v.operation } : {}), ...(v.durationMs !== undefined ? { durationMs: v.durationMs } : {}) };
}
