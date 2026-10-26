// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import { applyDataControls, type DataControls } from './data-controls';
import { renderExportAttribution } from './serializers/attribution';
import type { CompressionLevel, ExportFormat, SerializedContext, ExportPresentation } from './contracts';
import type { SemanticTree } from './model';
import { redactSemanticTree, type RedactionSettings } from './privacy';
import { serializeMarkdown, serializeSemanticText } from './serializers';
import { serializeMaximum } from './serializers/maximum';
import { countMarkdownCharacters } from './serializers/markdown';
import { countSemanticTextCharacters } from './serializers/semantic-text';
import { compressSemanticTree } from './transforms';
import { sanitizeActionReferences } from './action-projection';

export type SupportedExportFormat = Extract<ExportFormat, 'semantic-text' | 'markdown'>;

export interface PreparedExport {
  actionTargets?: { ref: string; role: string; name?: string }[];
  serialized: SerializedContext;
  characterCount: number;
  approximateTokenCount: number;
  reductionRatio: number | null;
  redactionCount: number;
}

/** Runs export in the order mandatory data exclusions, compression, optional redaction, then serialization. */
export function prepareExport(
  tree: SemanticTree,
  compressionLevel: CompressionLevel,
  format: SupportedExportFormat,
  redactSensitiveData = true,
  redactionSettings?: RedactionSettings,
  dataControls?: DataControls,
  presentation: ExportPresentation = {},
): PreparedExport {
  tree = sanitizeActionReferences(tree, applyDataControls(tree, dataControls));
  // Without is already normalized; serializers and redaction do not mutate it.
  const selectedTree = compressionLevel === 'without' ? tree : compressSemanticTree(tree, compressionLevel);
  const redaction = redactForExport(selectedTree, redactSensitiveData, redactionSettings);
  const actionTargets: NonNullable<PreparedExport['actionTargets']> = [];
  if (presentation.profile === 'agent-context') {
    const stack = [redaction.tree.root];
    while (stack.length) { const node = stack.pop()!; if (node.actionRef) actionTargets.push({ ref: node.actionRef, role: node.role, ...(node.name ? { name: node.name } : {}) }); stack.push(...node.children); }
  }
  const attribution = renderExportAttribution(compressionLevel, redactSensitiveData, redactionSettings);
  const selected = compressionLevel === 'maximum'
    ? serializeMaximum(redaction.tree, format, attribution, presentation) : serialize(redaction.tree, format, attribution, presentation);
  const baseline = compressionLevel === 'without'
    ? selected.characterCount
    : countCharacters(redactForExport(tree, redactSensitiveData, redactionSettings).tree, format, renderExportAttribution('without', redactSensitiveData, redactionSettings), presentation);
  const characterCount = selected.characterCount;
  const rawRatio = baseline === 0
    ? null
    : 1 - characterCount / baseline;

  return {
    ...(actionTargets.length ? { actionTargets } : {}),
    serialized: selected,
    characterCount,
    approximateTokenCount: Math.ceil(characterCount / 4),
    reductionRatio: rawRatio === null ? null : Math.max(0, rawRatio),
    redactionCount: redaction.redactionCount,
  };
}

function redactForExport(tree: SemanticTree, redactSensitiveData: boolean, settings?: RedactionSettings) {
  const result = redactSensitiveData ? redactSemanticTree(tree, settings) : { tree, redactionCount: 0 };
  return { ...result, tree: sanitizeActionReferences(tree, result.tree) };
}

function serialize(tree: SemanticTree, format: SupportedExportFormat, attribution: string, presentation: ExportPresentation): SerializedContext {
  return format === 'semantic-text' ? serializeSemanticText(tree, attribution, presentation) : serializeMarkdown(tree, attribution, presentation);
}

function countCharacters(tree: SemanticTree, format: SupportedExportFormat, attribution: string, presentation: ExportPresentation): number {
  return format === 'semantic-text' ? countSemanticTextCharacters(tree, attribution, presentation) : countMarkdownCharacters(tree, attribution, presentation);
}
