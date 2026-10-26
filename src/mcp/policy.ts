// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { validateSourcePatterns } from '../policy/sources';

export const MCP_MODES = ['read-only', 'read-write'] as const;
export type McpMode = typeof MCP_MODES[number];
export const MCP_ACTIONS = ['click', 'fill', 'select-option', 'set-checked'] as const;
export type McpAction = typeof MCP_ACTIONS[number];
export interface McpPolicy {
  McpAllowed?: boolean;
  McpAllowedModes?: McpMode[];
  McpDefaultMode?: McpMode;
  McpSettingsLocked?: boolean;
  McpTestAllowed?: boolean;
  McpAllowedClientIds?: string[];
  McpAllowedCaptureSources?: string[];
  McpBlockedCaptureSources?: string[];
  McpAllowedActions?: McpAction[];
  McpWriteApproval?: 'each-action' | 'session';
  McpMaxSessionMinutes?: number;
  McpMaxResponseKiB?: number;
}

/** MCP configuration failures must not silently become permissive defaults. */
export function validateMcpPolicy(raw: Record<string, unknown>, invalid: (key: string) => never): McpPolicy {
  const result: McpPolicy = {};
  for (const key of ['McpAllowed', 'McpSettingsLocked', 'McpTestAllowed'] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') invalid(key);
    result[key] = raw[key] as boolean;
  }
  for (const [key, allowed] of [['McpAllowedModes', MCP_MODES], ['McpAllowedActions', MCP_ACTIONS]] as const) {
    const value = raw[key]; if (value === undefined) continue;
    if (!Array.isArray(value) || value.length > allowed.length || new Set(value).size !== value.length || value.some(item => !(allowed as readonly unknown[]).includes(item))) invalid(key);
    Object.assign(result, { [key]: value });
  }
  for (const [key, allowed] of [['McpDefaultMode', MCP_MODES], ['McpWriteApproval', ['each-action', 'session']]] as const) {
    if (raw[key] === undefined) continue;
    if (!(allowed as readonly unknown[]).includes(raw[key])) invalid(key);
    Object.assign(result, { [key]: raw[key] });
  }
  if (result.McpDefaultMode && !(result.McpAllowedModes ?? MCP_MODES).includes(result.McpDefaultMode)) invalid('McpDefaultMode');
  for (const [key, min, max] of [['McpMaxSessionMinutes', 1, 480], ['McpMaxResponseKiB', 64, 16384]] as const) {
    if (raw[key] === undefined) continue;
    if (!Number.isSafeInteger(raw[key]) || Number(raw[key]) < min || Number(raw[key]) > max) invalid(key);
    result[key] = raw[key] as number;
  }
  if (raw.McpAllowedClientIds !== undefined) {
    const value = raw.McpAllowedClientIds;
    if (!Array.isArray(value) || value.length > 500 || value.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/u.test(id)) || new Set(value).size !== value.length) invalid('McpAllowedClientIds');
    result.McpAllowedClientIds = value as string[];
  }
  for (const key of ['McpAllowedCaptureSources', 'McpBlockedCaptureSources'] as const) {
    if (raw[key] === undefined) continue;
    try { result[key] = validateSourcePatterns(raw[key]); } catch { invalid(key); }
  }
  return result;
}
