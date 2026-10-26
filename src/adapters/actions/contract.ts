// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
export type ActionCommand = { action: 'click' | 'fill' | 'select-option' | 'set-checked'; snapshotId: string; elementRef: string; text?: string; checked?: boolean; optionRef?: string };
export type ActionOutcome = { status: 'applied' | 'rejected' | 'outcome-unknown'; error?: string };
export interface ActionLease { owner: string; snapshotId: string; expires: number }
export interface IssuedTarget { ref: string; role: string; name?: string }
export interface ActionSnapshot {
  snapshotId: string;
  owner: string;
  tabId: number;
  expires: number;
  targets: Map<string, IssuedTarget>;
  run: (command: ActionCommand, signal: AbortSignal, authorize: () => Promise<void>) => Promise<ActionOutcome>;
  dispose: () => void;
}

export const ACTION_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'option']);
