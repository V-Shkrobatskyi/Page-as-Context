# MCP local transport

Status: implemented local transport, read-only and authorized page interaction. A
content-free round trip and production read-only probe passed on Chrome
155.0.8059.86 and Firefox 158.0.1 on macOS. Four approved native-control actions passed synthetic probes in both browsers.
Store release qualification remains a separate manual checklist.

## Decision

Use a separately installed Node.js helper with three roles: MCP stdio process,
on-demand local IPC broker, and browser-launched Native Messaging host. The
extension initiates the native connection. No TCP or HTTP endpoint is opened by
the helper. Browser automation endpoints belong only to the opt-in test harness.

The development runtime is Node.js 24.10.x. The helper is an independent npm
package and lockfile; it is never bundled into the browser extension. SDK
`@modelcontextprotocol/sdk` is pinned to 1.32.2 (MIT). Its latest protocol is
2025-11-25; it also implements 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07.
The SDK's supported versions are not a claim that all corresponding clients have
been tested. The newer 2026-07-28 protocol is deliberately not advertised.

## Boundaries and identity

The private installation directory is owned by the current OS user and mode
0700; configuration and credential files are mode 0600, regular files opened
without following symlinks. IPC sockets are mode 0600. Installation manifests
contain exact Chrome origins or Firefox extension IDs, never wildcards. The
native host additionally validates the browser-provided caller argument. A
separate installation secret authenticates the native role to the broker.

Native registration includes a random extension-instance ID and browser kind;
this distinguishes browser profiles even when numeric tab IDs coincide. Clients
select an exact instance through their protected credential file. The broker
never chooses the first available instance and rejects duplicate registrations.

The broker forwards client credentials to the selected extension for validation
on every operation. It is not the policy or grant authority. The separate spike fixture uses a temporary synthetic credential and accepts only a nonce probe. Production pairing uses explicit browser UI,
credential revocation, bounded grants, current policy/settings checks and no
automatic restoration of tab/write access after restart. These checks are now
implemented for the read-only channel; write grants now use separate browser consent, TTL, snapshot references, approval and a bounded receipt ledger. Self-declared client
names are not verified program identities. Other software running as the same
OS user may access credentials; this transport cannot prevent that.

## Framing and bounds

MCP uses the SDK's newline-delimited UTF-8 JSON-RPC stdio transport (64 KiB input
buffer). Native Messaging uses a native-endian uint32 byte length and UTF-8 JSON.
Internal IPC uses the same bounded framing, but remains an implementation detail.
Frames are limited to 256 KiB, below the browsers' 1 MiB native-host reply limit.
Results are ordered base64 chunks of at most 64 KiB decoded, with at most 64
chunks and 4 MiB total. Assemblies are scoped to a request, sender and deadline.
Invalid JSON/UTF-8, oversized headers, duplicate/reordered chunks and output
backpressure terminate the transport. There is no silent truncation.

The broker limits connections to 32, active requests to 64 globally and 4 per
client. Handshakes expire after 3 seconds, partial frames after 10 seconds and
read requests after 15 seconds and write requests after 90 seconds (including browser approval). Native registration expires after 5 seconds.
Disconnects reject pending requests; late replies cannot revive an expired one.
Cancellation propagates toward the endpoint. The dispatcher distinguishes rejected-before-dispatch requests from unknown outcomes after dispatch; it never automatically repeats a write.

## Process ownership and recovery

The native host or MCP client starts one detached broker on demand after explicit
installation. Binding the private socket is the singleton arbitration; a scoped
HMAC challenge authenticates readiness and verifies protocol, installation and
broker version. Startup is bounded, without an OS login service or restart loop.
The fixed native launcher uses a quoted exec wrapper; the broker process is
spawned directly without a shell and with ignored stdio. A managed broker exits
30 seconds after the last MCP connection closes, even if native ports remain;
SIGINT/SIGTERM closes sockets and clears requests. It removes only the socket
inode it created. Stale sockets after an ungraceful crash are not silently
deleted; `doctor` fails and an operator must verify no broker is running before
removing the stale socket. One client closing never terminates another client's
lease. A later request can reconnect/start after graceful shutdown, but an
in-flight request is never replayed. Full setup/pairing UX is not complete.

The browser owns its native-host process. Closing its port ends the host stream
and IPC connection. EOF on the MCP client's stdin closes that client's bridge.
No tab grants or action registries are persisted by the spike.

## Installation and support matrix

The installer writes exact native-host manifests and an executable launcher with
an absolute private Node binary plus native modules and the Node license. This
stable runtime is independent of the versioned plugin cache. It fails on existing installations instead of
overwriting them. Uninstall checks ownership of each manifest before removal and
retains credential files. `doctor` checks private configuration and broker
connectivity; it is not proof of browser permissions or store compatibility.

| Platform | Registration implemented | Release support |
| --- | --- | --- |
| macOS | User Chrome and Firefox directories | Requires recorded live install/read/write/revoke/uninstall checks |
| Linux | User Chrome and Firefox directories | Unverified; not a supported release |
| Windows | Rejected explicitly | Named-pipe ACLs and registry/native launcher not implemented |
| Android | No native helper | Existing extension export remains unchanged |

Native runtime modules are copied into the private installation directory rather
than imported from the checkout. This removes a runtime dependency on protected
Desktop/Documents directories and makes the browser-launched host self-contained.
For Chrome custom user-data directories, manifests belong to their own
`NativeMessagingHosts` subdirectory, selected with `--chrome-user-data`.

Development and store IDs must be configured separately. No browser IDs, current
storage keys, enterprise deployment identifiers or store names are changed by
this integration. Managed client allowlists are enforced in the extension.
Automatic broker lifecycle remains follow-up implementation.

## Verification

`npm --prefix helper test` exercises framing, chunk assembly, private files,
credential rejection, exact instance routing, disconnect/timeout, singleton
behavior, installer cleanup, native stream translation and an actual SDK stdio
client. `node scripts/mcp/transport-spike.mjs --report PATH` additionally starts
isolated desktop browser profiles, temporarily registers the native host and
tests SDK → stdio → IPC → browser-launched native host → extension. The fixture
has no page access permissions and only returns a synthetic nonce. It is never
installed into the user's normal browser profile. See the dated local report
for actual versions and results; a mock test is not a live browser result.

## Sources

- [MCP 2025-11-25 stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP 2026-07-28 transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Firefox Native Messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)
