// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only

import type { CaptureError, SemanticTree } from '../core';
import type { CaptureWarningCode } from '../capture-warnings';

export type CaptureOutcome = { ok: true; tree: SemanticTree; warnings?: CaptureWarningCode[]; frameAccess?: string[] } |
  { ok: false; error: CaptureError };

export interface CaptureControls {
  actions?: { owner: string; snapshotId: string; expires: number };
  sources?: import('../policy/sources').CaptureSourceRules;
  data?: import('../core/data-controls').DataControls;
}
