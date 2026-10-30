# Page as Context for Claude

One private macOS Apple silicon integration for Claude Desktop and Claude Code. Both installation formats use the same source directory, server, helper, runtime and version. Client entry points retain independent credentials. Uses the shared MCP server,
setup, broker and native transport in `helper/`; it contains no browser adapter
or duplicate grant/permission implementation. See [the package user guide](PACKAGE-README.md).

## Build and verify

Requires Node 24.10.0, npm 11.6.0, cached production helper dependencies, the
official Node 24.10.0 macOS arm64 archive and pinned MCPB build tooling:

```sh
npm ci --prefix integrations/claude --ignore-scripts
node scripts/mcp/build-claude-package.mjs \
  --archive /path/to/node-v24.10.0-darwin-arm64.tar.gz \
  --output 'artifacts/mcp/Claude 0.2.0 macOS arm64'
node scripts/mcp/check-claude-package.mjs \
  'artifacts/mcp/Claude 0.2.0 macOS arm64/Page-as-Context-Claude-0.2.0-macOS-arm64.mcpb'
```

The archive's official Node checksum is verified before extraction. Output
directories must be new. After a package is installed, changed bytes require a
new manifest version. Keep generated bundles, runtimes, profiles and reports out
of Git. The version is independent of the browser extension and ChatGPT plugin.

Tooling `@anthropic-ai/mcpb` is pinned to 2.1.2 with its own lockfile; manifest
schema is pinned to 0.3. Tooling is build-only, excluded from the runtime bundle.
The official packer excludes type declarations/maps and `package-lock.json`;
the exact production dependency lock is retained as `DEPENDENCY-LOCK.json`.
`PACKAGE.json` hashes every packed file except itself, and `SHA256SUMS.txt`
identifies the resulting MCPB. Node and SDK licenses ship with the runtime.

The checker unpacks the actual MCPB, validates its strict schema and inventory,
preserved executable permission, bundled runtime, required browser selection,
invalid-browser rejection and installed-copy discovery. For both browser choices
it verifies isolated setup through MCP, confirmation rejection, synthetic pairing/
read/write denial and independent Claude profiles while preserving a synthetic
ChatGPT profile. No real browser registrations or client settings are modified.
These are SDK/synthetic checks, not actual Claude installation or acceptance.

## Packaging decisions

- One MCPB has one stdio server. Required `browser` configuration accepts exactly
  `chrome` or `firefox`; no default silently selects a browser. The current schema
  provides a text field rather than a browser enum. Invalid values fail closed
  before setup. Configuration changes require extension restart and new tab grants.
- `server.type` is `binary`, launching the bundled `runtime/node`. Claude's
  built-in Node version is not assumed compatible or used by this package.
  Browser-launched native hosts continue using the stable private runtime
  installed by shared setup, independent of versioned Claude caches.
- Wrapper paths and display names are fixed: `claude/profiles/{browser}.json`
  and `Claude — Chrome`/`Claude — Firefox`. Page/setup arguments cannot override
  paths, client identity or browser choice.
- Setup workflow is supplied through MCP initialization instructions and shared
  tool descriptions, not a ChatGPT-specific skill. Human confirmation, code
  comparison, browser pairing and tab grants remain separate.

## Actual-client acceptance

Install through Claude **Extensions → Advanced settings → Install Extension…**
or its supported MCPB drop target, never by editing desktop JSON configuration.
Record the actual app/account UI, installation result and tool calls. Free-tier
usage limits are separate from server defects. Combine sequential safe fixture
checks in concise prompts, preserve individual tool receipts and stop when human
approval is required. Unfinished scenarios remain pending when usage is exhausted.

References reviewed 26 October 2026:

- [Claude local MCP and desktop extensions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [MCPB manifest specification](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)

Actual Claude/browser acceptance, shared-client isolation and full update/removal
qualification remain required before claiming support. The bundle is unsigned
and has not been submitted to a public directory.

## Claude Code installation format

The same `package/` source includes `.claude-plugin/plugin.json` and `.mcp.json`.
The Desktop entry point selects `--client desktop` by default; the Code manifest
explicitly selects `--client code`. No model/tool argument selects identity.
Both formats are version 0.2.0. A root `plugin.json` mirrors plugin identity for
the common package inventory verifier; Desktop reads `manifest.json` instead.

```sh
node scripts/mcp/build-chatgpt-package.mjs --client claude-code \
  --archive /private/tmp/node-v24.10.0-darwin-arm64.tar.gz \
  --output 'artifacts/mcp/Claude 0.2.0 plugin macOS arm64'
```

Check the extracted marketplace using its bundled `runtime/node` with
`scripts/mcp/check-chatgpt-package.mjs MARKETPLACE claude-code chrome` and the
same invocation with `firefox`. This is isolated SDK evidence, not actual Code
installation. Official plugin manifest reference reviewed 29 October 2026:
https://code.claude.com/docs/en/plugins-reference
