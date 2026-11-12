// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { validateHfsSettings, type HfsSettings } from './hfs-settings';
import { browser } from 'wxt/browser';
import { readPolicy, captureOptions, type PolicySnapshot } from '../policy/runtime';
import { assertAction, resolvePreferences, mergeManagedFilters, PolicyError, resolveDataControls, type ExportPreferences } from '../policy/model';
import { defaultRedactionSettings, validateRedactionSettings } from '../core/privacy/settings';
import { REDACTION_SETTINGS_KEY } from '../redaction-settings';
import { COMPRESSION_LEVELS } from '../core/contracts';
import { validateDataControls, type DataControls } from '../core/data-controls';
import { MCP_MODES, type McpMode } from './policy';
import { MAX_WRITE_ACTIONS } from '../../helper/src/catalog.mjs';

export const MCP_SETTINGS_KEY = 'mcp-settings-v1';
export interface McpAutoDisconnect { amount: number; unit: 'minutes' | 'hours' | 'days' | 'unlimited' }
export const defaultAutoDisconnect = (): McpAutoDisconnect => ({ amount: 1, unit: 'hours' });
export interface McpSettings {
  version: 1;
  nativeEnabled?: boolean;
  hfs?: HfsSettings;
  enabled: boolean;
  connection?: 'automatic' | 'manual';
  mode: McpMode;
  inherit: boolean;
  preferences?: ExportPreferences;
  data?: DataControls;
  writeApproval?: 'each-action' | 'session';
  maxActions?: number;
  autoDisconnect?: McpAutoDisconnect;
}
export const defaultMcpSettings = (): McpSettings => ({ version: 1, enabled: false, connection: 'automatic', mode: 'read-only', inherit: true });
export const automaticMcp = (settings: McpSettings) => settings.connection === 'automatic';
export const mcpWritesEnabled = (settings: McpSettings) => settings.mode === 'read-write';
export const maxWriteActions = (settings: McpSettings, policy: { McpMaxActions?: number } = {}) => Math.min(settings.maxActions ?? MAX_WRITE_ACTIONS, policy.McpMaxActions ?? MAX_WRITE_ACTIONS);
export function autoDisconnectMilliseconds(settings: McpSettings): number {
  const timeout = settings.autoDisconnect ?? defaultAutoDisconnect();
  return timeout.unit === 'unlimited' ? Infinity : timeout.amount * ({ minutes: 60000, hours: 3600000, days: 86400000 }[timeout.unit]);
}
export function validateMcpSettings(raw: unknown): McpSettings {
  if (raw === undefined) return defaultMcpSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PolicyError('Unable to load MCP settings.');
  const value = raw as McpSettings & { allowPageActions?: boolean };
  if (Object.keys(raw).some(key => !['nativeEnabled', 'hfs', 'version', 'enabled', 'connection', 'allowPageActions', 'mode', 'inherit', 'preferences', 'data', 'writeApproval', 'maxActions', 'autoDisconnect'].includes(key)) || value.version !== 1 ||
    value.connection !== undefined && !['automatic', 'manual'].includes(value.connection) ||
    value.allowPageActions !== undefined && typeof value.allowPageActions !== 'boolean' ||
    value.writeApproval !== undefined && !['each-action', 'session'].includes(value.writeApproval) ||
    typeof value.enabled !== 'boolean' || typeof value.inherit !== 'boolean' || !MCP_MODES.includes(value.mode)) throw new PolicyError('Unable to load MCP settings.');
  if (value.maxActions !== undefined && (!Number.isSafeInteger(value.maxActions) || value.maxActions < 1 || value.maxActions > MAX_WRITE_ACTIONS)) throw new PolicyError('Maximum actions per write call must be an integer from 1 to 10.');
  if (value.nativeEnabled !== undefined && typeof value.nativeEnabled !== 'boolean') throw new PolicyError('Invalid native transport settings.');
  if (value.hfs !== undefined) validateHfsSettings(value.hfs);
  if (value.autoDisconnect !== undefined) {
    const timeout = value.autoDisconnect;
    if (!timeout || typeof timeout !== 'object' || Array.isArray(timeout) || Object.keys(timeout).some(key => !['amount', 'unit'].includes(key)) ||
      !['minutes', 'hours', 'days', 'unlimited'].includes(timeout.unit) || !Number.isSafeInteger(timeout.amount) || timeout.amount < 1 || timeout.amount > 999) throw new PolicyError('Invalid tab auto-disconnect settings.');
  }
  if (value.preferences !== undefined) {
    const p = value.preferences;
    if (!p || typeof p !== 'object' || Object.keys(p).some(key => !['format', 'compression', 'redactSensitiveData'].includes(key)) ||
      !['semantic-text', 'markdown'].includes(p.format) || !COMPRESSION_LEVELS.includes(p.compression) || typeof p.redactSensitiveData !== 'boolean') throw new PolicyError('Invalid MCP export preferences.');
  }
  if (!value.inherit && !value.preferences) throw new PolicyError('MCP export preferences are required.');
  // Accept the prerelease checkbox only for migration; never widen a saved Mode.
  const { allowPageActions, ...settings } = value;
  return { ...settings, ...(automaticMcp(settings) && allowPageActions === false ? { mode: 'read-only' as const } : {}),
    ...(value.data !== undefined ? { data: validateDataControls(value.data) } : {}) };
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
  const nativeAllowed = (policy.McpAllowedTransports ?? ['native', 'hfs']).includes('native');
  const hfsAllowed = (policy.McpAllowedTransports ?? ['native', 'hfs']).includes('hfs') && (!policy.McpHfsEndpoint || settings.hfs?.endpoint === policy.McpHfsEndpoint);
  if (draft && (settings.nativeEnabled !== false && !nativeAllowed || settings.hfs?.enabled && !hfsAllowed)) throw new PolicyError('This MCP transport is disabled by your administrator.');
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
  return { nativeAllowed, hfsAllowed, snapshot, settings, preferences, filters, data, controls, revision, modeAllowed, sessionApprovalAllowed };
}

export async function saveMcpSettings(value: unknown, expectedRevision: string) {
  const current = await resolveMcpSettings();
  assertAction(current.snapshot.policy, 'mcp-read');
  if (current.revision !== expectedRevision || current.snapshot.policy.McpSettingsLocked || current.snapshot.policy.UserPreferencesSaveAllowed === false) throw new PolicyError('MCP settings changed or saving is managed. Reload settings.');
  const settings = validateMcpSettings(value);
  await resolveMcpSettings(settings);
  await browser.storage.local.set({ [MCP_SETTINGS_KEY]: settings });
}
