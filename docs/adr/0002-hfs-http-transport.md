# ADR 0002: Optional local HTTP MCP through HFS

Date: 2026-11-01. Status updated 2026-11-03: implemented for review; basic macOS and
Windows reads/actions verified. Linux startup, automatic startup and broader
sleep/crash recovery remain unverified; see [acceptance limits](../hfs-integration.md#support-and-technical-details).

## Context and decision

Keep ADR 0001 and the working stdio/native integrations. Add an explicitly enabled
HTTP route through the unmodified HFS 3.3.4 executable. The executable's embedded
runtime executes our generated `server_code`; no extra user Node/Python/Docker
runtime, cloud relay or HFS fork is introduced.

One browser execution controller owns policy, pairing, tab shares, snapshots,
approvals, the per-tab execution lock and operation ledger. Transports own framing,
connection leases and cancellation routing. A failed HTTP route must not revoke
independent native access. Existing settings leave HFS off.

`helper/src/catalog.mjs` is the browser-compatible catalog and argument validator.
Its location keeps helper npm packages self-contained. Browser code imports this
module, never the Node stdio server. Source archives must include the catalog and
all HFS sources.

Use a small explicit browser MCP dispatcher for the initial protocol subset.
Only 2025-11-25 is negotiated; no server notifications, SSE, resumption, tasks,
resources, prompts, sampling or OAuth are advertised. Tests exercise JSON-RPC,
initialization, notification status, session ownership, cancellation and catalog
selection. Size/import measurements accompany the implementation status. This
measurement on the implementation checkout: minified standalone dispatcher 10,335 bytes versus generic SDK server 338,008 bytes (Vite, one ES module, no Node built-in imports in either). This comparison is not a full SDK app or whole-extension measurement. The
choice avoids bringing the helper's Node transport and managed-client graph into
the worker. It does not exempt the dispatcher from protocol conformance checks.

## Trust and consequences

HFS and generated JavaScript are trusted local code. Client bearer authentication
identifies a credential, not the publisher of the AI application. Both relay and
browser validate client access. Explicit Add client atomically publishes the HTTP profile and approved credential,
without creating files. It grants trust to that key immediately. The extension
updates the relay's in-memory client IDs and key hashes through authenticated
provider/control. Server setup downloads (YAML and OS launcher) are independent
and create no clients. JSON client export is optional; cancellation does not undo
client creation. There are no download drafts or completion-triggered approvals.
No code-comparison pairing is needed for HTTP.
Legacy HTTP profiles require an explicit Authorize and export action. Possession
of a JSON export grants this client's identity, not publisher verification.
Native pairing is unchanged. Authorization never shares an unselected tab, and a
new HTTP credential cannot inherit Write from existing shares.
Providers authenticate both directions with Web Crypto HMAC; their root secret
is never sent as a bearer. A separate client export contains only its own bearer.

HTTP discovery lists supported operations allowed by client restrictions and
organization policy, independently of the current Read/Write selection or live
tab grants. This keeps mode changes usable in hosts that cache tool catalogs.
Discovery grants no execution rights: get_connection_status reports current
capabilities and every action rechecks its grant and approval. Native continues to publish tool-list change notifications. Changes to client restrictions/policy still need a catalog
refresh; the JSON-only binding does not push tool-list notifications.

HTTP sessions belong to the browser dispatcher. HFS only relays session headers
and assigns independent random delivery tickets. Cancellation targets route,
lease, client and session scopes; uncertain writes are never replayed.

The user installs HFS and manages its OS startup separately. Dedicated config,
private ACLs, pinned releases and disabled file/admin routes are mandatory.
HTTP-only hosts and existing stdio plugins are separate acceptance paths. Build
or SDK tests do not establish real ChatGPT/Claude/Antigravity support.
