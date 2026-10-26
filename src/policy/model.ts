// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { HistoryPolicy } from '../history/model';
import { validateMcpPolicy, type McpPolicy } from '../mcp/policy';
import { PAGE_URL_MODES, LINK_URL_MODES, DEFAULT_DATA_CONTROLS, type DataControls } from '../core/data-controls';
import { validateSourcePatterns, type SourceRules } from './sources';
import { COMPRESSION_LEVELS, DEFAULT_COMPRESSION_LEVEL, type CompressionLevel } from '../core/contracts';
import type { SupportedExportFormat } from '../core/export';
import { BUILTIN_FILTERS, defaultRedactionSettings, validateRedactionSettings, type BuiltinFilterId, type CustomRedactionRule, type RedactionSettings } from '../core/privacy/settings';

export const POLICY_FORMATS = ['semantic-text', 'markdown'] as const;
export interface ExportPreferences {
  format: SupportedExportFormat;
  compression: CompressionLevel;
  redactSensitiveData: boolean;
}
export interface EnterprisePolicy extends SourceRules, HistoryPolicy, McpPolicy {
  IncludePageTitle?: boolean;
  PageUrlMode?: DataControls['pageUrl'];
  LinkUrlMode?: DataControls['linkUrls'];
  IncludeFormValues?: boolean;
  LoggingLevel?: 'off' | 'error' | 'info' | 'debug';
  TechnicalLogClearAllowed?: boolean;
  LogMaxEvents?: number;
  LogMaxBytes?: number;
  LogMaxAgeHours?: number;
  PolicyVersion?: 1;
  ElementPickerAllowed?: boolean;
  PreviewAllowed?: boolean;
  FilterSettingsAllowed?: boolean;
  FileExportAllowed?: boolean;
  ClipboardExportAllowed?: boolean;
  AllowedExportFormats?: SupportedExportFormat[];
  DefaultExportFormat?: SupportedExportFormat;
  ForcedExportFormat?: SupportedExportFormat;
  AllowedCompressionLevels?: CompressionLevel[];
  DefaultCompression?: CompressionLevel;
  ForcedCompression?: CompressionLevel;
  RedactionMode?: 'user-controlled' | 'force-on' | 'force-off';
  RequiredBuiltinFilters?: BuiltinFilterId[];
  DisabledBuiltinFilters?: BuiltinFilterId[];
  ManagedRedactionRules?: CustomRedactionRule[];
  UserRedactionRulesAllowed?: boolean;
  UserPreferencesSaveAllowed?: boolean;
}
export class PolicyError extends Error {
  constructor(message: string) { super(message); this.name = 'PolicyError'; }
}
function invalid(key: string): never { throw new PolicyError(`Invalid organization policy: ${key}. Contact your administrator.`); }

/** Whitelist and validate without including policy values in errors. */
export function validatePolicy(raw: unknown): EnterprisePolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('configuration');
  const source = raw as Record<string, unknown>;
  const result: EnterprisePolicy = {};
  Object.assign(result, validateMcpPolicy(source, invalid));
  if (source.PolicyVersion !== undefined) {
    if (source.PolicyVersion !== 1) invalid('PolicyVersion');
    result.PolicyVersion = 1;
  }
  for (const key of ['ElementPickerAllowed', 'PreviewAllowed', 'FilterSettingsAllowed', 'FileExportAllowed', 'ClipboardExportAllowed', 'UserRedactionRulesAllowed', 'UserPreferencesSaveAllowed', 'IncludePageTitle', 'IncludeFormValues', 'CaptureHistoryEnabled', 'CaptureHistorySettingsLocked', 'CaptureHistoryClearAllowed', 'TechnicalLogClearAllowed'] as const) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== 'boolean') invalid(key);
    result[key] = source[key];
  }
  for (const key of ['AllowedCaptureSources', 'BlockedCaptureSources'] as const) {
    if (source[key] !== undefined) { try { result[key] = validateSourcePatterns(source[key]); } catch { invalid(key); } }
  }
  for (const [key, values] of [['PageUrlMode', PAGE_URL_MODES], ['LinkUrlMode', LINK_URL_MODES], ['LoggingLevel', ['off', 'error', 'info', 'debug']]] as const) {
    if (source[key] !== undefined) {
      if (!(values as readonly unknown[]).includes(source[key])) invalid(key);
      Object.assign(result, { [key]: source[key] });
    }
  }
  for (const [key, max] of [['LogMaxEvents', 1000], ['LogMaxBytes', 2097152], ['LogMaxAgeHours', 168], ['CaptureHistoryRetentionDays', 365], ['CaptureHistoryMaxMiB', 50]] as const) {
    if (source[key] === undefined) continue;
    if (!Number.isSafeInteger(source[key]) || Number(source[key]) < (key === 'LogMaxBytes' ? 2 : 1) || Number(source[key]) > max) invalid(key);
    result[key] = source[key] as number;
  }
  function list<T extends string>(key: string, allowed: readonly T[]): T[] | undefined {
    if (source[key] === undefined) return undefined;
    const value = source[key];
    if (!Array.isArray(value) || value.length > allowed.length || value.some(item => !allowed.includes(item)) || new Set(value).size !== value.length) invalid(key);
    return allowed.filter(item => value.includes(item));
  }
  result.AllowedExportFormats = list('AllowedExportFormats', POLICY_FORMATS);
  result.AllowedCompressionLevels = list('AllowedCompressionLevels', COMPRESSION_LEVELS);
  result.RequiredBuiltinFilters = list('RequiredBuiltinFilters', BUILTIN_FILTERS.map(filter => filter.id));
  result.DisabledBuiltinFilters = list('DisabledBuiltinFilters', BUILTIN_FILTERS.map(filter => filter.id));
  if (result.RequiredBuiltinFilters?.some(id => result.DisabledBuiltinFilters?.includes(id))) invalid('RequiredBuiltinFilters / DisabledBuiltinFilters');
  for (const key of ['DefaultExportFormat', 'ForcedExportFormat'] as const) {
    if (source[key] === undefined) continue;
    if (!POLICY_FORMATS.includes(source[key] as SupportedExportFormat)) invalid(key);
    result[key] = source[key] as SupportedExportFormat;
    if (!formats(result).includes(result[key]!)) invalid(key);
  }
  for (const key of ['DefaultCompression', 'ForcedCompression'] as const) {
    if (source[key] === undefined) continue;
    if (!COMPRESSION_LEVELS.includes(source[key] as CompressionLevel)) invalid(key);
    result[key] = source[key] as CompressionLevel;
    if (!levels(result).includes(result[key]!)) invalid(key);
  }
  if (source.RedactionMode !== undefined) {
    if (!['user-controlled', 'force-on', 'force-off'].includes(source.RedactionMode as string)) invalid('RedactionMode');
    result.RedactionMode = source.RedactionMode as EnterprisePolicy['RedactionMode'];
  }
  if (source.ManagedRedactionRules !== undefined) {
    try {
      if (!Array.isArray(source.ManagedRedactionRules) || source.ManagedRedactionRules.some(rule => !rule || rule.enabled !== true || typeof rule.type !== 'string')) invalid('ManagedRedactionRules');
      result.ManagedRedactionRules = validateRedactionSettings({ ...defaultRedactionSettings(), customRules: source.ManagedRedactionRules }).customRules;
    } catch { invalid('ManagedRedactionRules'); }
  }
  if (hasRequiredRules(result) && result.RedactionMode !== undefined && result.RedactionMode !== 'force-on') invalid('RedactionMode');
  return result;
}
export const formats = (policy: EnterprisePolicy): readonly SupportedExportFormat[] => policy.AllowedExportFormats ?? POLICY_FORMATS;
export const levels = (policy: EnterprisePolicy): readonly CompressionLevel[] => policy.AllowedCompressionLevels ?? COMPRESSION_LEVELS;
export const hasRequiredRules = (policy: EnterprisePolicy): boolean => !!(policy.RequiredBuiltinFilters?.length || policy.ManagedRedactionRules?.length);
export const hasManagedFilters = (policy: EnterprisePolicy): boolean => hasRequiredRules(policy) || !!policy.DisabledBuiltinFilters?.length;
export function managedBuiltinState(policy: EnterprisePolicy, id: BuiltinFilterId): boolean | undefined {
  if (policy.RequiredBuiltinFilters?.includes(id)) return true;
  if (policy.DisabledBuiltinFilters?.includes(id)) return false;
  return undefined;
}
export const redactionMode = (policy: EnterprisePolicy): NonNullable<EnterprisePolicy['RedactionMode']> => policy.RedactionMode ?? (hasRequiredRules(policy) ? 'force-on' : 'user-controlled');
export const isManaged = (policy: EnterprisePolicy): boolean => Object.values(policy).some(value => value !== undefined);

export function resolvePreferences(policy: EnterprisePolicy, personal: Partial<ExportPreferences> = {}): ExportPreferences {
  const allowedFormats = formats(policy), allowedLevels = levels(policy);
  if (!allowedFormats.length || !allowedLevels.length) throw new PolicyError('Export is disabled by your administrator.');
  const choose = <T>(allowed: readonly T[], forced: T | undefined, value: T | undefined, recommended: T | undefined, fallback: T): T =>
    forced ?? (value !== undefined && allowed.includes(value) ? value : recommended ?? (allowed.includes(fallback) ? fallback : allowed[0]!));
  const mode = redactionMode(policy);
  return {
    format: choose(allowedFormats, policy.ForcedExportFormat, personal.format, policy.DefaultExportFormat, 'semantic-text'),
    compression: choose(allowedLevels, policy.ForcedCompression, personal.compression, policy.DefaultCompression, DEFAULT_COMPRESSION_LEVEL),
    redactSensitiveData: mode === 'force-on' || mode === 'user-controlled' && (personal.redactSensitiveData ?? true),
  };
}
export type PolicyAction = 'capture' | 'copy' | 'save' | 'preview' | 'picker' | 'customize' | 'diagnostics-copy' | 'diagnostics-save' | 'mcp-read' | 'mcp-write' | 'mcp-test';
export function assertAction(policy: EnterprisePolicy, action: PolicyAction): void {
  if (action === 'mcp-read' || action === 'mcp-write' || action === 'mcp-test') {
    if (policy.McpAllowed === false || policy.McpAllowedModes?.length === 0 || !formats(policy).length || !levels(policy).length ||
      action === 'mcp-write' && !(policy.McpAllowedModes ?? ['read-only', 'read-write']).includes('read-write') ||
      action === 'mcp-test' && (policy.McpTestAllowed === false || policy.PreviewAllowed === false)) throw new PolicyError('MCP access is disabled by your administrator.');
    return;
  }
  if (action === 'diagnostics-copy' || action === 'diagnostics-save') {
    if (action === 'diagnostics-copy' && policy.ClipboardExportAllowed === false || action === 'diagnostics-save' && policy.FileExportAllowed === false) throw new PolicyError('Diagnostic export is disabled by your administrator.');
    return;
  }
  if (action === 'customize') {
    if (policy.FilterSettingsAllowed === false) throw new PolicyError('Filter settings are disabled by your administrator.');
    return;
  }
  if (action === 'preview' && policy.PreviewAllowed === false) throw new PolicyError('Preview is disabled by your administrator.');
  if (!formats(policy).length || !levels(policy).length) throw new PolicyError('Export is disabled by your administrator.');
  if (action === 'picker' && policy.ElementPickerAllowed === false) throw new PolicyError('Element selection is disabled by your administrator.');
  if (action === 'save' && policy.FileExportAllowed === false) throw new PolicyError('File export is disabled by your administrator.');
  if (action === 'copy' && policy.ClipboardExportAllowed === false) throw new PolicyError('Copying is disabled by your administrator.');
  if (['capture', 'preview', 'picker'].includes(action) && policy.FileExportAllowed === false && policy.ClipboardExportAllowed === false) throw new PolicyError('Export is disabled by your administrator.');
}

/** Apply only built-in states; keep personal rules available for unfinished UI drafts. */
export function applyManagedBuiltinStates(policy: EnterprisePolicy, personal: RedactionSettings): RedactionSettings {
  const disabled = new Set([...personal.disabledBuiltins, ...(policy.DisabledBuiltinFilters ?? [])]);
  const builtinCaseSensitivity = { ...personal.builtinCaseSensitivity };
  for (const id of policy.RequiredBuiltinFilters ?? []) disabled.delete(id);
  for (const id of [...(policy.RequiredBuiltinFilters ?? []), ...(policy.DisabledBuiltinFilters ?? [])]) delete builtinCaseSensitivity[id];
  return { ...personal, disabledBuiltins: BUILTIN_FILTERS.filter(filter => disabled.has(filter.id)).map(filter => filter.id), builtinCaseSensitivity };
}

/** Managed built-ins keep original matching semantics and override personal on/off states. */
export function mergeManagedFilters(policy: EnterprisePolicy, personal: RedactionSettings): RedactionSettings {
  const base = policy.UserRedactionRulesAllowed === false ? defaultRedactionSettings() : validateRedactionSettings(personal);
  if (!hasManagedFilters(policy)) return base;
  const builtins = applyManagedBuiltinStates(policy, base);
  const users = base.customRules;
  const ids = new Set(users.map(rule => rule.id));
  const managed = (policy.ManagedRedactionRules ?? []).map((rule, index) => {
    let suffix = 0;
    let id = `managed-${index}`;
    while (ids.has(id)) id = `managed-${index}-${++suffix}`;
    ids.add(id);
    return { ...rule, id, enabled: true };
  });
  try {
    return validateRedactionSettings({ ...builtins, customRules: [...managed, ...users] });
  } catch { throw new PolicyError('Unable to apply organization filters. Check the combined filter limits.'); }
}

/** Organization modes are minimum exclusions; a personal choice can be stricter. */
export function resolveDataControls(policy: EnterprisePolicy, personal: DataControls = DEFAULT_DATA_CONTROLS): DataControls {
  const stricter = <T extends string>(modes: readonly T[], a: T, b: T | undefined): T => modes[Math.max(modes.indexOf(a), b === undefined ? 0 : modes.indexOf(b))]!;
  return { includeTitle: personal.includeTitle && policy.IncludePageTitle !== false,
    includeFormValues: personal.includeFormValues && policy.IncludeFormValues !== false,
    pageUrl: stricter(PAGE_URL_MODES, personal.pageUrl, policy.PageUrlMode), linkUrls: stricter(LINK_URL_MODES, personal.linkUrls, policy.LinkUrlMode) };
}
export function dataControlsLocked(policy: EnterprisePolicy): boolean {
  return policy.IncludePageTitle === false || policy.IncludeFormValues === false || !!policy.PageUrlMode && policy.PageUrlMode !== 'full' || !!policy.LinkUrlMode && policy.LinkUrlMode !== 'full';
}
