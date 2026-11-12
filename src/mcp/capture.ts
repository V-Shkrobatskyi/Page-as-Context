// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { projectTargetRead, unavailableTarget, TARGET_MAX_BYTES, type TargetReadRequest, type TargetReadInfo } from './targeted-read';
import { boundedScopeTree, projectFillScope, SCOPE_MAX_BYTES, type FillScopeRequest, type ScopeInfo } from './fill-scoped';
import type { SemanticTree } from '../core/model';
import { getMcpTab } from './tab';
import { captureActiveTab } from '../adapters/capture';
import { sourceAllowed } from '../policy/sources';
import { assertAction, PolicyError } from '../policy/model';
import { prepareExport } from '../core/export';
import { resolveMcpSettings, mcpWritesEnabled, type McpSettings } from './settings';
import { createActionSnapshot } from '../adapters/actions/snapshot';
import type { ActionSnapshot } from '../adapters/actions/contract';
import type { CompressionLevel } from '../core/contracts';

export interface CaptureAccess { owner: string; expires: number; write: boolean; collectScopeTree?: boolean; responseReserveBytes?: number; retain: (snapshot: ActionSnapshot) => void }

/** Both local preview and external reads use this explicitly targeted handler. */
export async function readMcpContext(tabId: number, authorize: () => void, preview: boolean, signal: AbortSignal, draft?: McpSettings, access?: CaptureAccess, fillScope?: FillScopeRequest, targetRead?: TargetReadRequest) {
  authorize();
  const effective = await resolveMcpSettings(draft);
  assertAction(effective.snapshot.policy, preview ? 'mcp-test' : 'mcp-read');
  if (!effective.modeAllowed) throw new Error('unsupported-combination');
  if (!preview && !effective.settings.enabled) throw new PolicyError('MCP is disabled.');
  const tab = await getMcpTab(tabId);
  if (tab.incognito || tab.discarded || !tab.url || !/^https?:\/\//u.test(tab.url) || !sourceAllowed(tab.url, effective.controls.sources)) throw new PolicyError('This source is unavailable for MCP.');
  const write = mcpWritesEnabled(effective.settings) && access?.write === true;
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
  const currentTab = await getMcpTab(tabId);
  if (signal.aborted || current.revision !== effective.revision || currentTab.url !== tab.url || currentTab.discarded || currentTab.incognito) throw new PolicyError('The page or MCP settings changed. Capture again.');
  if (!result.ok) throw new Error(result.error.code);
  if (result.tree.sourceUrl !== undefined) {
    // A failed HTTP navigation can leave the tab URL unchanged while Chrome
    // exposes an internal error document. Tab permission does not authorize it.
    let captured: URL;
    try { captured = new URL(result.tree.sourceUrl); }
    catch { throw new PolicyError('The captured document is unavailable for MCP.'); }
    if (!['http:', 'https:'].includes(captured.protocol) || captured.origin !== new URL(tab.url).origin ||
      !sourceAllowed(result.tree.sourceUrl, effective.controls.sources)) throw new PolicyError('The captured document is unavailable for MCP.');
  }
  let projected: SemanticTree | undefined;
  let output = prepareExport(result.tree, compression, effective.preferences.format, effective.preferences.redactSensitiveData,
    effective.filters, effective.data, { profile: 'agent-context' }, tree => { projected = targetRead ? tree : boundedScopeTree(tree); });
  const fullOutput = output;
  let scope: ScopeInfo | undefined;
  if (fillScope) {
    const selected = projectFillScope(projected ?? { schemaVersion: 1, root: { role: 'page', children: [] } }, fillScope);
    scope = selected.scope;
    if (!projected || result.warnings?.length) scope = { ...scope, kind: 'full', omitted: 'none', fallbackReason: result.warnings?.length ? 'capture-partial' : 'comparison-unavailable-or-limit' };
    if (scope.kind === 'scoped') {
      output = prepareExport(selected.tree, compression, effective.preferences.format, effective.preferences.redactSensitiveData,
        effective.filters, effective.data, { profile: 'agent-context' });
      if (new TextEncoder().encode(JSON.stringify(JSON.stringify(output.serialized.content))).length + 2048 > SCOPE_MAX_BYTES) {
        output = fullOutput; scope = { ...scope, kind: 'full', omitted: 'none', fallbackReason: 'scoped-response-limit' };
        delete scope.parentTag; delete scope.parentSummaryOnly; delete scope.relatedRegionRemoved;
      }
    }
  }
  let target: TargetReadInfo | undefined;
  if (targetRead) {
    const source = projected ?? { schemaVersion: 1, root: { role: 'page', children: [] } };
    let selection = compression === 'maximum' || !projected
      ? unavailableTarget(source, compression === 'maximum' ? 'semantic-compression-unavailable' : 'projection-unavailable', !!result.warnings?.length)
      : projectTargetRead(source, targetRead, !!result.warnings?.length);
    const render = () => prepareExport(selection.tree, compression, effective.preferences.format, effective.preferences.redactSensitiveData,
      effective.filters, effective.data, { profile: 'agent-context' });
    output = render(); target = selection.info;
    const boundedBytes = new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ target, context: output.serialized.content }) }] })).length + 2048 + (access?.responseReserveBytes ?? 0);
    if (boundedBytes > TARGET_MAX_BYTES) {
      selection = unavailableTarget(source, 'target-response-limit', !!result.warnings?.length);
      output = render(); target = selection.info;
      // Candidate details and all action refs are absent on an unavailable result.
    }
  }
  if (scope?.kind === 'full') { delete scope.parentTag; delete scope.parentSummaryOnly; delete scope.relatedRegionRemoved; }
  if (actionSnapshot && access?.collectScopeTree) actionSnapshot.scopeTree = result.warnings?.length ? undefined : projected;
  if (actionSnapshot) for (const target of output.actionTargets ?? []) actionSnapshot.targets.set(target.ref, target);
  const payload = { representationVersion: 1, snapshotId, mode: write ? 'read-write' as const : 'read-only' as const,
    format: effective.preferences.format, compression, ...(compression !== effective.preferences.compression ? { requestedCompression: effective.preferences.compression } : {}), partial: !!result.warnings?.length,
    ...(scope ? { scope } : {}), ...(target ? { target } : {}), warnings: [...(result.warnings ?? []), ...warnings], context: output.serialized.content };
  // Count the actual textual tool envelope, including JSON escaping. Reserve
  // bounded space for connectionId and the outer JSON-RPC response metadata.
  const toolBytes = new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }] })).length + 512 + (access?.responseReserveBytes ?? 0);
  if (toolBytes > Math.min(targetRead ? TARGET_MAX_BYTES : Infinity, Math.min(4096, effective.snapshot.policy.McpMaxResponseKiB ?? 4096) * 1024)) throw new Error('response-limit');
  if (actionSnapshot?.retainOnly) await actionSnapshot.retainOnly([...(output.actionTargets ?? [])].map(target => target.ref));
  authorize();
  if (actionSnapshot && access) { access.retain(actionSnapshot); retained = true; }
  return payload;
  } finally { if (!retained) actionSnapshot?.dispose(); }
}
