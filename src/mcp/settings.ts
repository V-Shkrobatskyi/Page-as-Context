// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { browser } from 'wxt/browser';
import { readPolicy, captureOptions, type PolicySnapshot } from '../policy/runtime';
import { assertAction, resolvePreferences, mergeManagedFilters, PolicyError, resolveDataControls, type ExportPreferences } from '../policy/model';
import { defaultRedactionSettings, validateRedactionSettings } from '../core/privacy/settings';
import { REDACTION_SETTINGS_KEY } from '../redaction-settings';
import { COMPRESSION_LEVELS } from '../core/contracts';
import { validateDataControls, type DataControls } from '../core/data-controls';
import { MCP_MODES, type McpMode } from './policy';

export const MCP_SETTINGS_KEY = 'mcp-settings-v1';
export interface McpSettings {
  version: 1;
  enabled: boolean;
  mode: McpMode;
  inherit: boolean;
  preferences?: ExportPreferences;
  data?: DataControls;
  writeApproval?: 'each-action' | 'session';
}
export const defaultMcpSettings = (): McpSettings => ({ version: 1, enabled: false, mode: 'read-only', inherit: true });
export function validateMcpSettings(raw: unknown): McpSettings {
  if (raw === undefined) return defaultMcpSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PolicyError('Unable to load MCP settings.');
  const value = raw as McpSettings;
  if (Object.keys(raw).some(key => !['version', 'enabled', 'mode', 'inherit', 'preferences', 'data', 'writeApproval'].includes(key)) || value.version !== 1 ||
    value.writeApproval !== undefined && !['each-action', 'session'].includes(value.writeApproval) ||
    typeof value.enabled !== 'boolean' || typeof value.inherit !== 'boolean' || !MCP_MODES.includes(value.mode)) throw new PolicyError('Unable to load MCP settings.');
  if (value.preferences !== undefined) {
    const p = value.preferences;
    if (!p || typeof p !== 'object' || Object.keys(p).some(key => !['format', 'compression', 'redactSensitiveData'].includes(key)) ||
      !['semantic-text', 'markdown'].includes(p.format) || !COMPRESSION_LEVELS.includes(p.compression) || typeof p.redactSensitiveData !== 'boolean') throw new PolicyError('Invalid MCP export preferences.');
  }
  if (!value.inherit && !value.preferences) throw new PolicyError('MCP export preferences are required.');
  return { ...value, ...(value.data !== undefined ? { data: validateDataControls(value.data) } : {}) };
}

export async function resolveMcpSettings(draft?: McpSettings) {
  const snapshot = await readPolicy();
  const stored = await browser.storage.local.get([MCP_SETTINGS_KEY, 'popup-settings', REDACTION_SETTINGS_KEY]);
  const saved = validateMcpSettings(stored[MCP_SETTINGS_KEY]);
  if (stored[MCP_SETTINGS_KEY] === undefined) {
    const allowed = snapshot.policy.McpAllowedModes ?? [...MCP_MODES];
    saved.mode = snapshot.policy.McpDefaultMode ?? (allowed.includes('read-only') ? 'read-only' : allowed[0] ?? 'read-only');
  }
  const settings = draft ? validateMcpSettings(draft) : saved;
  if (draft && snapshot.policy.McpSettingsLocked && JSON.stringify(settings) !== JSON.stringify(saved)) throw new PolicyError('MCP settings are managed by your organization.');
  const policy = snapshot.policy;
  const preferences = resolvePreferences(policy, settings.inherit ? stored['popup-settings'] ?? {} : settings.preferences);
  const filters = mergeManagedFilters(policy, policy.UserRedactionRulesAllowed === false ? defaultRedactionSettings() :
    stored[REDACTION_SETTINGS_KEY] === undefined ? defaultRedactionSettings() : validateRedactionSettings(stored[REDACTION_SETTINGS_KEY]));
  let data = resolveDataControls(policy, snapshot.dataControls);
  if (settings.data) data = resolveDataControls({ IncludePageTitle: data.includeTitle, IncludeFormValues: data.includeFormValues, PageUrlMode: data.pageUrl, LinkUrlMode: data.linkUrls }, settings.data);
  const controls = captureOptions(snapshot);
  controls.data = data;
  controls.sources = { ...controls.sources, additional: { AllowedCaptureSources: policy.McpAllowedCaptureSources, BlockedCaptureSources: policy.McpBlockedCaptureSources } };
  const modes = policy.McpAllowedModes ?? [...MCP_MODES];
  const modeAllowed = modes.includes(settings.mode);
  if (draft && !modeAllowed) throw new PolicyError('This MCP mode is disabled by your administrator.');
  const bytes = new TextEncoder().encode(JSON.stringify({ snapshot, saved, preferences, filters, data }));
  const revision = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const sessionApprovalAllowed = policy.McpWriteApproval !== 'each-action';
  return { snapshot, settings, preferences, filters, data, controls, revision, modeAllowed, sessionApprovalAllowed };
}

export async function saveMcpSettings(value: unknown, expectedRevision: string) {
  const current = await resolveMcpSettings();
  assertAction(current.snapshot.policy, 'mcp-read');
  if (current.revision !== expectedRevision || current.snapshot.policy.McpSettingsLocked || current.snapshot.policy.UserPreferencesSaveAllowed === false) throw new PolicyError('MCP settings changed or saving is managed. Reload settings.');
  const settings = validateMcpSettings(value);
  await resolveMcpSettings(settings);
  await browser.storage.local.set({ [MCP_SETTINGS_KEY]: settings });
}
