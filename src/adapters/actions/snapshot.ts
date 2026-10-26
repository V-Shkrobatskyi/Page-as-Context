// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import type { ActionLease, ActionSnapshot } from './contract';
export async function createActionSnapshot(tabId: number, lease: ActionLease): Promise<ActionSnapshot> {
  if (import.meta.env.BROWSER === 'firefox') {
    const { createFirefoxActionSnapshot } = await import('../firefox/actions'); return createFirefoxActionSnapshot(tabId, lease);
  }
  const { createChromeActionSnapshot } = await import('../chrome/actions'); return createChromeActionSnapshot(tabId, lease);
}
