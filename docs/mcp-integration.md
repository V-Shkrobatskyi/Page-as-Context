# Connect your AI app with Page as Context

Use a Page as Context plugin to connect a local AI app to browser tabs you choose.
The plugin supplies its runtime and local bridge. Normal setup and daily use do
not require a terminal, a separately running HFS server or globally installed Node.

## Choose your AI app

Install the package made for your app; the formats are not interchangeable.
These guides contain the installation steps, updates and removal instructions:

| AI app | Installation guide | Package format |
| --- | --- | --- |
| ChatGPT desktop | [ChatGPT guide](../integrations/chatgpt/PACKAGE-README.md) | Plugin ZIP upload through Settings → Plugins |
| Claude Desktop / Claude Code | [Claude guide](../integrations/claude/PACKAGE-README.md) | Desktop MCPB / Code plugin directory |
| Antigravity App | [Antigravity guide](../integrations/antigravity/PACKAGE-README.md) | Local plugin directory |
| GitHub Copilot app | [Copilot guide](../integrations/github-copilot-app/PACKAGE-README.md) | Local marketplace, installed through Customize |

These are private macOS Apple silicon packages, not a promise of public directory
availability or support for every MCP client. Use the supplied release and check
the app guide for requirements and verification limits. Copilot's Chrome core
flow was user-verified; Firefox live testing for that package was skipped.
For a different HTTP-capable client, use the separate [Local HTTP (HFS) guide](hfs-integration.md).
Do not configure HFS or a duplicate manual server when using a native plugin.

## Connect once

1. Install the Page as Context browser extension and the plugin for your AI app.
   In the extension's **MCP settings**, enable MCP and native helper connections,
   select **Automatic**, apply settings and approve the browser permissions.
   MCP starts disabled; existing Manual settings stay Manual until changed.
2. Under **Helper connection**, click **Copy setup info**. Give that line to your
   AI app when asking it to connect Chrome or Firefox. It contains Browser,
   Instance and Extension ID. If the button is unavailable in an older extension,
   expand **Setup and browser instance** and copy the line there.
3. The assistant checks setup and prepares a plan. Review its actual changes
   before approving local setup. Keep confirmation for `confirm_browser_setup`
   enabled. An existing compatible bridge can be reused; adding a browser can
   restart the shared bridge and end active connections, as disclosed in the plan.
4. Compare the code in chat with the request in the extension's
   **Pairing and clients**, then approve it yourself. Approve only a request you
   initiated; client names are labels, not verified application identities.
5. On each intended source tab, explicitly select **AI: Read** or **AI: Write**
   in the popup. Do this again after pairing a new client, even if the tab was
   already shared with another client. Pairing alone does not share any tab.

### Copy-and-paste pairing messages

Copy the request below into a local chat, then paste the **entire line** from
**Helper connection → Copy setup info** at the end, after **Browser setup info:**.
Send the request and your setup info together.

```text
Connect Page as Context using the browser setup info below.
Use the Page as Context plugin for this browser, not HFS.
Complete the setup and show me the pairing code. Use the supplied IDs without
asking for them again unless they are invalid. If setup changes need my approval,
show them and ask once, then continue automatically after I approve.
I will compare the code and approve pairing in the browser myself.
Do not read or modify tabs during setup.

Browser setup info:
```

This is one setup request, not a sequence of tool commands. If the assistant
needs approval for its displayed changes, review them and reply **“Approve this
setup.”** It should then continue and show the code without another instruction.
Compare and approve the code in the browser, then grant the intended tab access.
If already connected, no new pairing is needed. App/browser permission prompts
are separate from these chat messages.

Automatic starts the bridge after setup. Use **Retry connection** if needed.
For **Manual**, use **Start helper connection**, complete pairing, then open
**Connect MCP → Connect selected tab** on the source page for the intended client.
The assistant obtains current Connection IDs itself; you do not copy them in normal use.

## Read and write

**AI: Read** shares filtered context. **AI: Write** also permits supported page
actions and requires **Mode: Read and write** in MCP settings. Read only is the
default. Browser/site permissions, privacy controls and organization policy
still apply. Native text inputs, textareas, buttons, links, checkboxes and selects
are supported; password/file/payment fields and unsupported custom controls are not.

Ask the assistant to describe the shared tab first. To test Write, use a harmless
form and request one specific field change without submitting it. Review any
browser action prompt. Do not automatically retry a denied or unknown-outcome action.

The default is approval before each action. **Allow for this connection**, when
available, skips prompts only for that client/tab grant. In Automatic mode this
can also be managed under **Shared tabs → Skip prompts**. It does not change the
global setting; navigation, expiry or disconnection ends that approval.
Organization policy can require every action to be approved.

Your AI app may send returned context to its model provider. Page content is
untrusted input, and filters cannot detect every secret. Review data controls
and, when needed, **Test MCP output** before sharing sensitive pages.

## Access duration and reconnection

- In Automatic, access follows a shared tab across reloads and site changes;
  a new tab starts Off. Navigation invalidates snapshots and action approvals.
- **Auto-disconnect tabs** defaults to one hour of inactivity. Successful reads
  and applied actions renew only that tab's timer; status checks and failed
  actions do not. Unlimited removes inactivity timeout, not organization limits.
- Closing/discarding a tab, restarting the browser or reloading the extension
  clears tab access. Manual navigation also ends its tab grant.
- Restarting only the AI app can reuse pairing. In Automatic, an existing
  unexpired sharing choice can return as validated Read with fresh IDs.
  Write and session approvals are not restored; explicitly grant Write again.
- To switch browser instances, provide the new setup info and complete a reviewed
  setup and fresh code pairing. Failure/cancellation preserves the previous
  profile; access does not transfer to the new instance.

## Stop or revoke access

| Control | Effect |
| --- | --- |
| **AI Off** on a tab | Ends that tab's sharing for all clients |
| **Pause all / Resume** | Suspends page access; resuming does not restore Write |
| **Revoke** beside a client | Removes that client's trust and access; other clients remain connected |
| **Stop all MCP access** | Ends current sharing and connections and cancels retries |

After Revoke, old Connection IDs must no longer read pages. To reconnect, pair
again and grant tabs separately; the list should be empty before those new grants.
Stopping or revoking cannot retract data already returned to the AI app.

## Troubleshooting

- **Plugin missing or tools unavailable:** follow your app's installation guide;
  verify the correct package and local session, then restart the app if needed.
- **No tabs:** finish pairing, then grant the intended tab Read/Write again.
  An active but unshared tab is not automatically authorized.
- **Read rejected:** check Revoke, expiry, source/site permissions and current grants.
- **Write rejected:** check Read and write mode, AI: Write, current snapshot and
  browser approval. Respect denials; do not bypass them with another tool.
- **setup_status says pairing not-started:** no pairing attempt is currently in
  progress. This alone does not invalidate an already configured/trusted profile.
- **Setup timed out:** prepare a new request and review it. Never delete credentials
  or sockets blindly, approve browser pairing for the user or copy another client's profile.

## Removal and recovery

Use your app's guide to update, disable or remove its plugin. Revoke its browser
client separately. The shared bridge and private profiles may remain because
other AI apps use them; do not remove them as part of one plugin's cleanup.
For manual installation, diagnostics, protocol details, organization policy and
release checks, see the [developer and maintenance reference](mcp-development.md).
