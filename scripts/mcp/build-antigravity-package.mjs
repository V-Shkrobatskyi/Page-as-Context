// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
// Reuse the locked runtime, dependency installation and inventory builder.
if (process.argv.slice(2).some(arg => arg === '--client' || arg.startsWith('--client='))) {
  throw new Error('This entry point builds only the Antigravity plugin.');
}
process.argv.push('--client', 'antigravity');
await import('./build-chatgpt-package.mjs');
