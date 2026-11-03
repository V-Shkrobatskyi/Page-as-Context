// Copyright (c) 2026 Vitalii Shkrobatskyi
// SPDX-License-Identifier: GPL-3.0-only
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
for (const [name, path] of [['explicit-browser-dispatcher', '../src/mcp/dispatcher.ts'], ['sdk-generic-server', '../helper/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js']]) {
  const result = await build({ configFile: false, logLevel: 'error', build: { write: false, minify: true, lib: { entry: fileURLToPath(new URL(path, import.meta.url)), formats: ['es'], fileName: name } } });
  const output = (Array.isArray(result) ? result : [result]).flatMap(result => result.output);
  const code = output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
  console.log(JSON.stringify({ name, javascriptBytes: Buffer.byteLength(code), chunks: output.filter(item => item.type === 'chunk').length,
    nodeBuiltinImport: /(?:from|import)\s*['"](?:node:|fs['"]|net['"]|http['"])/u.test(code) }));
}
