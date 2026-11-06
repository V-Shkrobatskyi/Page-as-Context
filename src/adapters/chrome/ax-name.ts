// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import type { ChromeAxValue } from './types';

/** Empty and absent AX names have the same semantic representation. */
export function normalizeAxName(name: ChromeAxValue | undefined): string | undefined {
  return typeof name?.value === 'string' && name.value.length ? name.value : undefined;
}

export function validAxName(name: ChromeAxValue | undefined): boolean {
  return name === undefined || typeof name?.value === 'string';
}
