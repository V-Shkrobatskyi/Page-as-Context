// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { SemanticTree } from './model';

export const COMPRESSION_LEVELS = ['without', 'detailed', 'compact', 'maximum'] as const;
export type CompressionLevel = (typeof COMPRESSION_LEVELS)[number];
export const DEFAULT_COMPRESSION_LEVEL: CompressionLevel = 'compact';

export const EXPORT_PROFILES = ['standard', 'agent-context'] as const;
export type ExportProfile = (typeof EXPORT_PROFILES)[number];
export interface ExportPresentation {
  profile?: ExportProfile;
  /** Trusted, source-independent capture notices, supplied by the capture pipeline. */
  warnings?: readonly string[];
}

export const EXPORT_FORMATS = [
  'semantic-text',
  'markdown',
  'json',
  'raw-debug',
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const CAPTURE_ERROR_CODES = [
  'unsupported-page',
  'permission-denied',
  'debugger-busy',
  'capture-failed',
  'capture-unavailable',
  'capture-limit',
  'capture-timeout',
  'page-changed',
  'invalid-tree',
  'redaction-settings',
  'policy-blocked',
] as const;
export type CaptureErrorCode = (typeof CAPTURE_ERROR_CODES)[number];

export interface CaptureError {
  code: CaptureErrorCode;
  message: string;
  details?: string;
}

export type CaptureResult =
  | { ok: true; tree: SemanticTree }
  | { ok: false; error: CaptureError };

export interface SerializedContext {
  format: ExportFormat;
  content: string;
  characterCount: number;
}
