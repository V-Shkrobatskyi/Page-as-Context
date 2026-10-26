// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { configuration } from './security.mjs';
import { startBroker } from './broker.mjs';

// Dedicated process: never inherit or write the caller's MCP protocol stream.
process.umask(0o077);
try {
  const idleTimeout = Number(process.argv[3]);
  if (!Number.isSafeInteger(idleTimeout) || idleTimeout < 50 || idleTimeout > 30000) throw new Error('invalid-idle-timeout');
  const broker = await startBroker(await configuration(process.argv[2]), { idleTimeout, managedIdle: true });
  const stop = () => { void broker.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
} catch (error) {
  // A concurrent successful bind belongs to another starter. Never unlink or replace it.
  process.exitCode = error.code === 'EADDRINUSE' ? 0 : 1;
}
