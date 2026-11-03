# Page as Context HFS relay protocol 1

Config schema: 1. Reviewed executable: HFS 3.3.4. MCP revision: 2025-11-25.
The generated config embeds `auth.mjs` and `relay.mjs` verbatim after removal of
module declarations. Edit sources and regenerate, never edit escaped JS.

## HTTP surface

The dedicated listener binds to a literal `127.0.0.1` and one saved port
1024–65535. Reject a different Host, any query string, and consumer Origin headers.
Provider Origin, if present, must be an extension origin; this is an additional
check, not authentication. Reject all non-bridge routes, including HFS admin and
files. No arbitrary forwarding. No transient queue is persisted.

All paths start with `/pac/v1`:

| Path | Method | Contract |
| --- | --- | --- |
| `/health` | GET | Relay/config compatibility only; never clients, instance IDs or page metadata. |
| `/provider/challenge` | POST | Signed request; short-lived server challenge in a signed response. |
| `/provider/register` | POST | Challenge + protocolVersion 1 + random generation. Returns random leaseId. Duplicate live instance returns 409. |
| `/provider/control` | POST | Replace admitted `{id,hash}` client list atomically or `{disconnect:true}`. Removed/rotated clients cancel pending work. |
| `/provider/poll` | POST | One waiting poll per lease, up to 20 s; requests immediately wake it. Returns request/cancel events. |
| `/provider/reply` | POST | `{ticket,status,body?,sessionId?}` for a dispatched live ticket in this lease; late/forged replies return 404/410. |
| `/mcp/{instanceId}/{clientId}` | POST/DELETE | Independent Authorization bearer. JSON responses; accepted notifications 202; GET 405. |

Provider headers are `x-pac-instance`, `x-pac-lease`, `x-pac-nonce`, `x-pac-time`
and `x-pac-mac`. Initial challenge/register use an empty lease. A MAC signs UTF-8
`JSON.stringify([1,direction,path,instanceId,leaseId,nonce,time,body])` with
HMAC-SHA-256 using the UTF-8 provider secret. Direction is `request` or `response`;
response body in that tuple is `{status,body}`. Nonce is 32 random bytes as lowercase
hex. Time is integer milliseconds within 30 seconds. Valid request nonces are
retained for 65 seconds and rejected on replay. Response verification binds the
original request nonce, exact path, scope and status. Primitive implementations
come from Web Crypto in both environments. No secret is in a URI or liveness reply.

A register challenge expires after 10 s and is single-use for its instance.
Leases expire after 45 s without authenticated provider activity; tab grants are
independent and polling never renews them. Reconnection waits for a crashed lease
to expire, never evicts another live registration. Full worker restart discards
MCP sessions and browser shares; later requests must initialize/share again.

Request events include protocolVersion, instanceId, leaseId, generation, random
64-hex ticket, clientId, credentialSecret, method, sessionId, protocol, deadline,
and payload. This envelope comes from authenticated admission, not client-supplied
routing fields. The browser rechecks its local profile and approved credential
hash before execution. Cancel events carry only the owned ticket.

## Bounds and state transitions

Queued → dispatched → completed/cancelled/expired. Dispatched work is never
requeued. Client abort or expiration produces an addressed browser cancel.
Unload/restart invalidates every lease and settles pending HTTP waits with 503.
A missing provider returns 503 immediately, without a persistent queue.

Consumer bodies: 64 KiB UTF-8. Browser response: 4 MiB including JSON framing,
subject to a lower organization limit. Provider reply envelopes reserve another
64 KiB. Body reads have a 10 s deadline. Aggregate reserved incoming body bytes
plus queued request bytes: 16 MiB; 64 execution tickets globally, 32 per provider,
4 per client, up to 16 providers. Cancellation/DELETE have reserved bounded slots
(80 total tickets including controls, 16 controls per provider, 2 per client), so
a full execution queue cannot prevent cancellation. These are wire/reservation budgets, not claims
about JS heap size. HFS/OS still own connection/header handling. Headers are
bounded by the pinned HFS Node HTTP parser; this is not a custom HTTP server.

Read/negotiation HTTP wait: 20 s (browser execution: 14 s). Write HTTP wait: 95 s
(browser execution: 85 s, browser approval: 45 s). Client timeout headers are
ignored. Cancellation does not wait for a write deadline and cannot undo an action.
Lost action replies must be treated as outcome-unknown; operationId deduplication
lives in the common controller, never in a retrying relay.

## MCP sessions

Initialize creates a random browser-owned MCP-Session-Id bound to client credential
and current provider lifetime. Later POST/DELETE must supply that ID and the
negotiated MCP-Protocol-Version. Missing ID is 400, unknown/wrong-owner ID is 404;
DELETE cancels only that session and needs no Accept header. The POST Accept
negotiation requirement does not apply to bodyless DELETE responses. Maximum eight sessions per client and 128 per
provider, with an absolute eight-hour lifetime independent of tab expiry.
At capacity, an authorized initialization replaces the same credential's least
recently used session with no active requests. Active requests and other clients'
sessions are never evicted to make room. If none can be reclaimed, initialize
returns 429. An evicted session returns 404; clients must initialize again as
required by the MCP Streamable HTTP specification.
Concurrent duplicate JSON-RPC IDs inside a session return 409; equal IDs in
other sessions are independent. No automatic tool-list push: refresh or initialize
a new session after client action restrictions or organization policy change.
The HTTP catalog lists policy/client-allowed operations independently of tab grants
and the user's current Read/Write mode. Changing Read/Write never changes that
catalog; get_connection_status reports current executable capabilities. Cached
tools are always checked again on execution. Explicit Add client atomically stores
the HTTP profile and approval, independently of downloads. Setup downloads contain only YAML and the OS launcher and never
create clients. The browser synchronizes client IDs/key hashes to the running
relay through authenticated provider/control. Client JSON export is optional;
cancelling it does not revoke a client. HTTP has no manual pairing code.
Initialization and tool listing reject unapproved credentials with 403. Older profiles need the explicit **Authorize & export** action to
be authorized. The unadvertised get_pairing_status compatibility call reports only
the authorization status. Authorization alone never shares an unselected tab;
new credentials inherit at most Read until another explicit Write choice.
