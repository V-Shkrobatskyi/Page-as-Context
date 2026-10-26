// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { browser } from 'wxt/browser';
import { captureActiveTab } from '../adapters/capture';
import { sourceAllowed } from '../policy/sources';
import { assertAction, PolicyError } from '../policy/model';
import { prepareExport } from '../core/export';
import { resolveMcpSettings, type McpSettings } from './settings';
import { createActionSnapshot } from '../adapters/actions/snapshot';
import type { ActionSnapshot } from '../adapters/actions/contract';
import type { CompressionLevel } from '../core/contracts';

export interface CaptureAccess { owner: string; expires: number; write: boolean; retain: (snapshot: ActionSnapshot) => void }

/** Both local preview and external reads use this explicitly targeted handler. */
export async function readMcpContext(tabId: number, authorize: () => void, preview: boolean, signal: AbortSignal, draft?: McpSettings, access?: CaptureAccess) {
  authorize();
  const effective = await resolveMcpSettings(draft);
  assertAction(effective.snapshot.policy, preview ? 'mcp-test' : 'mcp-read');
  if (!effective.modeAllowed) throw new Error('unsupported-combination');
  if (!preview && !effective.settings.enabled) throw new PolicyError('MCP is disabled.');
  const tab = await browser.tabs.get(tabId);
  if (tab.incognito || tab.discarded || !tab.url || !/^https?:\/\//u.test(tab.url) || !sourceAllowed(tab.url, effective.controls.sources)) throw new PolicyError('This source is unavailable for MCP.');
  const write = effective.settings.mode === 'read-write' && access?.write === true;
  if (write) assertAction(effective.snapshot.policy, 'mcp-write');
  let compression = effective.preferences.compression;
  const warnings: string[] = [];
  if (write && compression === 'maximum') {
    const allowed = effective.snapshot.policy.AllowedCompressionLevels ?? ['without', 'detailed', 'compact', 'maximum'];
    const fallback = (['compact', 'detailed', 'without'] as CompressionLevel[]).find(level => allowed.includes(level));
    if (effective.snapshot.policy.ForcedCompression === 'maximum' || !fallback) throw new Error('unsupported-combination');
    compression = fallback; warnings.push('action-safe-compression');
  }
  const snapshotId = crypto.randomUUID();
  const lease = write && access ? { owner: access.owner, snapshotId, expires: Math.min(access.expires, Date.now() + 30 * 60000) } : undefined;
  const actionSnapshot = lease ? await createActionSnapshot(tabId, lease) : undefined;
  let retained = false;
  try {
  const result = await captureActiveTab({ id: tabId, title: tab.title, url: tab.url }, new Date().toISOString(), undefined, signal,
    { ...effective.controls, ...(lease ? { actions: lease } : {}) });
  authorize();
  const current = await resolveMcpSettings(draft);
  const currentTab = await browser.tabs.get(tabId);
  if (signal.aborted || current.revision !== effective.revision || currentTab.url !== tab.url || currentTab.discarded || currentTab.incognito) throw new PolicyError('The page or MCP settings changed. Capture again.');
  if (!result.ok) throw new Error(result.error.code);
  const output = prepareExport(result.tree, compression, effective.preferences.format, effective.preferences.redactSensitiveData,
    effective.filters, effective.data, { profile: 'agent-context' });
  if (actionSnapshot) for (const target of output.actionTargets ?? []) actionSnapshot.targets.set(target.ref, target);
  const payload = { representationVersion: 1, snapshotId, mode: write ? 'read-write' as const : 'read-only' as const,
    format: effective.preferences.format, compression, ...(compression !== effective.preferences.compression ? { requestedCompression: effective.preferences.compression } : {}), partial: !!result.warnings?.length,
    warnings: [...(result.warnings ?? []), ...warnings], context: output.serialized.content };
  // Count the actual textual tool envelope, including JSON escaping. Reserve
  // bounded space for connectionId and the outer JSON-RPC response metadata.
  const toolBytes = new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }] })).length + 512;
  if (toolBytes > Math.min(4096, effective.snapshot.policy.McpMaxResponseKiB ?? 4096) * 1024) throw new Error('response-limit');
  authorize();
  if (actionSnapshot && access) { access.retain(actionSnapshot); retained = true; }
  return payload;
  } finally { if (!retained) actionSnapshot?.dispose(); }
}
