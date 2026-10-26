// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
export interface SourceRules { AllowedCaptureSources?: string[]; BlockedCaptureSources?: string[] }
export interface CaptureSourceRules extends SourceRules { personal?: SourceRules; additional?: SourceRules }
export interface PersonalSourceSettings { allowlistEnabled: boolean; allowed: string[]; blocked: string[] }
export const defaultSourceSettings = (): PersonalSourceSettings => ({ allowlistEnabled: false, allowed: [], blocked: [] });
export function validateSourceSettings(raw: unknown): PersonalSourceSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid capture source settings.');
  const value = raw as PersonalSourceSettings;
  if (Object.keys(raw).some(key => !['allowlistEnabled', 'allowed', 'blocked'].includes(key)) || typeof value.allowlistEnabled !== 'boolean') throw new Error('Invalid capture source settings.');
  return { allowlistEnabled: value.allowlistEnabled, allowed: validateSourcePatterns(value.allowed), blocked: validateSourcePatterns(value.blocked) };
}
export const personalSourceRules = (settings: PersonalSourceSettings): SourceRules => ({
  ...(settings.allowlistEnabled ? { AllowedCaptureSources: settings.allowed } : {}), BlockedCaptureSources: settings.blocked,
});
interface Pattern { scheme: string; host: string; subdomains: boolean; port: string }
/** Origin patterns only. Omitted port means the scheme's standard port; :* allows any port. */
function pattern(raw: string): Pattern {
  const input = raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (/\s|\\/u.test(input) || input.endsWith(':')) throw new Error('Invalid source pattern.');
  const match = /^(https?|\*):\/\/(\*\.)?([^/?#@]+)$/u.exec(input);
  if (!match) throw new Error('Invalid source pattern.');
  const authority = match[3]!;
  const anyPort = authority.endsWith(':*');
  const url = new URL(`${match[1] === '*' ? 'https' : match[1]}://${anyPort ? authority.slice(0, -2) : authority}`);
  if (url.username || url.password || url.pathname !== '/' || !url.hostname || url.hostname.includes('*')) throw new Error('Invalid source pattern.');
  return { scheme: match[1]!, host: url.hostname.toLowerCase().replace(/\.$/u, ''), subdomains: !!match[2], port: anyPort ? '*' : match[1] === '*' ? /:(\d+)$/u.exec(authority)?.[1] ?? '' : url.port };
}
export function validateSourcePatterns(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > 500) throw new Error('Invalid source list.');
  return [...new Set(raw.map(value => {
    if (typeof value !== 'string' || value.length > 512) throw new Error('Invalid source pattern.');
    const p = pattern(value);
    return `${p.scheme}://${p.subdomains ? '*.' : ''}${p.host}${p.port ? `:${p.port}` : ''}`;
  }))].sort();
}
export function sourceAllowed(raw: string | undefined, rules: CaptureSourceRules = {}, actualOrigin?: string): boolean {
  return matchesSourceRules(raw, rules, actualOrigin) && (!rules.personal || matchesSourceRules(raw, rules.personal, actualOrigin)) &&
    (!rules.additional || matchesSourceRules(raw, rules.additional, actualOrigin));
}
function matchesSourceRules(raw: string | undefined, rules: SourceRules, actualOrigin?: string): boolean {
  if (rules.AllowedCaptureSources === undefined && !rules.BlockedCaptureSources?.length) return true;
  try {
    if (actualOrigin !== undefined && new URL(actualOrigin).origin === 'null') return false;
    let url = new URL(raw ?? '');
    if (url.protocol === 'blob:') url = new URL(url.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    const matches = (s: string) => {
      const p = pattern(s);
      return (p.scheme === '*' || `${p.scheme}:` === url.protocol) && (p.host === host || p.subdomains && host.endsWith(`.${p.host}`)) && (p.port === '*' || (p.scheme === '*' && p.port ? p.port === (url.port || (url.protocol === 'https:' ? '443' : '80')) : p.port === url.port));
    };
    return !rules.BlockedCaptureSources?.some(matches) && (rules.AllowedCaptureSources === undefined || rules.AllowedCaptureSources.some(matches));
  } catch { return false; }
}
