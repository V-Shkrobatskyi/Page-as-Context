// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
const [bundle, browser = 'chrome', ...extra] = process.argv.slice(2);
if (!bundle || extra.length) throw new Error('Pass the built bundle directory and optionally chrome or firefox.');
process.argv = [process.argv[0], process.argv[1], bundle, 'antigravity', browser];
await import('./check-chatgpt-package.mjs');
