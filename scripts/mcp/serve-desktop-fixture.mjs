// Copyright (c) 2026 Vitalii Shkrobatskyi; SPDX-License-Identifier: GPL-3.0-only
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { port: { type: 'string', default: '8765' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.');
const root = new URL('../../tests/manual/mcp-desktop/', import.meta.url);
const routes = new Map([['/', ['index.html', 'text/html']], ['/frame.html', ['frame.html', 'text/html']],
  ['/next.html', ['next.html', 'text/html']], ['/fixture.js', ['fixture.js', 'text/javascript']]]);
const server = createServer(async (request, response) => {
  // Serve only these public fixture files. Never expose repository or local state.
  const route = routes.get(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD' || !route) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(new URL(route[0], root));
    response.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8`, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'" });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(500).end('Fixture unavailable.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Desktop acceptance fixture: http://127.0.0.1:${port}/`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
