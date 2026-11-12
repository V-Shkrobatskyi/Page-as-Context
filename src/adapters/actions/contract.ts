// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import type { SemanticTree } from '../../core/model';
export type ActionCommand = { action: 'click' | 'fill' | 'select-option' | 'set-checked'; snapshotId: string; elementRef: string; text?: string; responseMode?: 'full' | 'scoped'; checked?: boolean; optionRef?: string };
export type ActionOutcome = { status: 'applied' | 'rejected' | 'outcome-unknown'; error?: string; parentTag?: string };
export interface ActionLease { owner: string; snapshotId: string; expires: number }
export interface IssuedTarget { ref: string; role: string; name?: string; placeholder?: string; captureIdentity?: string }
export interface ActionSnapshot {
  snapshotId: string;
  owner: string;
  tabId: number;
  expires: number;
  targets: Map<string, IssuedTarget>;
  scopeTree?: SemanticTree;
  /** Remove adapter addresses omitted by the sanitized response before retention. */
  retainOnly?: (refs: string[]) => Promise<void>;
  run: (command: ActionCommand, signal: AbortSignal, authorize: () => Promise<void>) => Promise<ActionOutcome>;
  dispose: () => void;
}

export const ACTION_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'option']);
