// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { technicalEvent } from '../diagnostics/client';
import { DEFAULT_DATA_CONTROLS, validateDataControls, type DataControls } from '../core/data-controls';
import { resolveDataControls } from './model';
import { defaultSourceSettings, personalSourceRules, sourceAllowed, validateSourceSettings, type PersonalSourceSettings, type CaptureSourceRules } from './sources';
import { browser } from 'wxt/browser';
import { assertAction, isManaged, PolicyError, resolvePreferences, validatePolicy, type EnterprisePolicy, type ExportPreferences, type PolicyAction } from './model';

export const DATA_CONTROLS_KEY = 'data-controls-v1';
export const CAPTURE_SOURCES_KEY = 'capture-sources-v1';
export interface PolicySnapshot { policy: EnterprisePolicy; revision?: string; dataControls?: DataControls; captureSources?: PersonalSourceSettings }
export const captureSourceRules = (snapshot: PolicySnapshot): CaptureSourceRules => ({ AllowedCaptureSources: snapshot.policy.AllowedCaptureSources, BlockedCaptureSources: snapshot.policy.BlockedCaptureSources, ...(snapshot.captureSources ? { personal: personalSourceRules(snapshot.captureSources) } : {}) });
export const captureOptions = (snapshot: PolicySnapshot): import('../adapters/types').CaptureControls => ({ sources: captureSourceRules(snapshot), data: captureDataControls(snapshot) });
export const captureDataControls = (snapshot: PolicySnapshot): DataControls => resolveDataControls(snapshot.policy, snapshot.dataControls);
export function assertSource(url: string | undefined, snapshot: PolicySnapshot): void {
  if (!sourceAllowed(url, snapshot.policy)) throw new PolicyError('Capture of this source is disabled by your administrator.');
  if (!sourceAllowed(url, captureSourceRules(snapshot))) throw new PolicyError('Capture of this source is disabled by your personal site settings. Open Diagnostics to change them.');
}
export interface PolicyContext extends ExportPreferences { operationId?: string; policyRevision?: string }

/** Read on every operation; never replace a failed read with cached permissive values. */
export async function readPolicy(includePersonal = true): Promise<PolicySnapshot> {
  let raw: unknown = {};
  try {
    // Firefox Android exposes managed storage methods but rejects every call.
    // Skip only on a confirmed unsupported platform; desktop failures remain blocking.
    const platform = import.meta.env.BROWSER === 'firefox'
      ? await browser.runtime?.getPlatformInfo?.().catch(() => undefined) : undefined;
    if (platform?.os !== 'android' && browser.storage?.managed?.get) raw = await browser.storage.managed.get(null);
  } catch (error) {
    // Firefox reports an absent native manifest this way on ordinary installations.
    if (!(import.meta.env.BROWSER === 'firefox' && error instanceof Error && error.message === 'Managed storage manifest not found')) {
      throw new PolicyError('Unable to load organization policies. Retry or contact your administrator.');
    }
  }
  const policy = validatePolicy(raw);
  let personal: DataControls = { ...DEFAULT_DATA_CONTROLS };
  try {
    const stored = includePersonal ? await browser.storage?.local?.get?.(DATA_CONTROLS_KEY) : undefined;
    if (stored?.[DATA_CONTROLS_KEY] !== undefined) personal = validateDataControls(stored[DATA_CONTROLS_KEY]);
  } catch { throw new PolicyError('Unable to load data controls. Open Diagnostics and retry.'); }
  let captureSources = defaultSourceSettings();
  try {
    const stored = includePersonal ? await browser.storage?.local?.get?.(CAPTURE_SOURCES_KEY) : undefined;
    if (stored?.[CAPTURE_SOURCES_KEY] !== undefined) captureSources = validateSourceSettings(stored[CAPTURE_SOURCES_KEY]);
  } catch { throw new PolicyError('Unable to load capture source settings. Open Diagnostics and save valid site settings.'); }
  const custom = JSON.stringify(personal) !== JSON.stringify(DEFAULT_DATA_CONTROLS);
  const customSources = JSON.stringify(captureSources) !== JSON.stringify(defaultSourceSettings());
  if (!isManaged(policy) && !custom && !customSources) return { policy };
  const bytes = new TextEncoder().encode(JSON.stringify(custom || customSources ? { policy, ...(custom ? { dataControls: personal } : {}), ...(customSources ? { captureSources } : {}) } : policy));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const revision = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  return { policy, revision, ...(custom ? { dataControls: personal } : {}), ...(customSources ? { captureSources } : {}) };
}

export async function checkPolicy(action: PolicyAction, context?: PolicyContext): Promise<PolicySnapshot> {
  try {
    const snapshot = await readPolicy();
    assertAction(snapshot.policy, action);
    if (context) {
      if (snapshot.revision !== context.policyRevision) throw new PolicyError('Capture settings or organization policies changed. Prepare the context again.');
      const effective = resolvePreferences(snapshot.policy, context);
      if (effective.format !== context.format || effective.compression !== context.compression || effective.redactSensitiveData !== context.redactSensitiveData) {
        throw new PolicyError('Export preferences are restricted by your administrator. Prepare the context again.');
      }
    } else if (snapshot.revision && (action === 'copy' || action === 'save')) {
      throw new PolicyError('Prepare the context again using the current organization policies.');
    }
    technicalEvent({ code: 'policy-check', result: 'success' });
    return snapshot;
  } catch (error) {
    technicalEvent({ code: 'policy-check', result: 'error', reason: 'policy-blocked' });
    throw error;
  }
}

/** Unsubscribe with the owning document/session to avoid retaining captured content. */
export function watchPolicy(changed: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => { if (area === 'managed' || area === 'local' && (changes[DATA_CONTROLS_KEY] || changes[CAPTURE_SOURCES_KEY])) changed(); };
  browser.storage?.onChanged?.addListener(listener);
  return () => browser.storage?.onChanged?.removeListener(listener);
}

export function policyMessage(error: unknown): string {
  return error instanceof PolicyError ? error.message : 'Unable to apply organization policies. Retry or contact your administrator.';
}
