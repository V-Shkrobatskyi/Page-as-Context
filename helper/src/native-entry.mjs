// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { configuration } from './security.mjs';
import { ensureBroker } from './startup.mjs';
import { nativeHost } from './native.mjs';

try {
  const config = await configuration(process.argv[2]);
  const caller = process.argv[process.argv.length - 1];
  if (!config.callers.includes(caller)) throw new Error('unknown-caller');
  await ensureBroker(config);
  await nativeHost(config, caller);
} catch {
  process.stderr.write('Page as Context native bridge unavailable. Check installation and broker status.\n');
  process.exitCode = 1;
}
