# GitHub Copilot app live acceptance

Status updated 9 November 2026: user-operated Chrome core flow is accepted;
Firefox live testing was explicitly skipped. This remains a reusable checklist,
not a claim that all scenarios below passed. Exact evidence and untested cases
are recorded in `integrations/github-copilot-app/ACCEPTANCE.md`.

## Record the environment

- Date, app version, macOS version/architecture:
- Browser/version, Page as Context version and exact extension ID:
- Browser instance ID (no credentials), local session type:
- Package version, ZIP SHA256, marketplace source and installation UI:
- Existing shared bridge and other active clients:

Never include tokens, credentials, private page contents or account identifiers
in shared evidence. Use a local non-sensitive fixture form.

## Loader and install

- [ ] Install the content-free probe from a private marketplace in Customize.
- [ ] Record trust/consent prompts and invoke loader_probe with a random nonce.
- [ ] Confirm it offers no browser/setup tools. Disable and remove the probe.
- [ ] Install production through Customize and record source and plugin version.
- [ ] Check there are no duplicate manual or CLI-derived Page as Context servers.
- [ ] Use a local session on the browser computer; discover both browser servers
  and the github-copilot-app-browser-setup skill.

## Repeat for Chrome and Firefox

- [ ] setup_status and prepare_browser_setup do not install or create credentials.
- [ ] Review the prepared setup changes. Confirm only after explicit user approval.
- [ ] Compare the pairing code and approve in the browser yourself.
- [ ] Before a separate tab grant, the new client cannot read the source tab.
- [ ] Grant AI: Read (Manual: Connect selected tab); discover the Connection ID.
- [ ] Read the fixture and check privacy filters and field values.
- [ ] Attempt an unshared tab: access must fail.
- [ ] Grant Write separately; read a fresh snapshot and perform one safe fixture
  input change with the required browser approval. Do not submit the form.
- [ ] Deny an action and verify no retry. Do not retry an unknown-outcome write.
- [ ] Test revoke, TTL, navigation, app restart and browser restart.
- [ ] Switch instance; cancel and deny one attempt, preserving the old profile.
  Approve a fresh attempt and confirm grants/Write/session approval do not transfer.

## Coexistence and lifecycle

- [ ] Keep an independently approved ChatGPT/Claude session active; closing one
  Copilot session must not end the other's lease or overwrite its credentials.
- [ ] Update the plugin cache using a new package version; verify executable
  permissions, stable native runtime and persistent private profiles.
- [ ] Disable and uninstall through supported app controls. Revoke the browser
  client separately; preserve the shared bridge and other clients' credentials.

Record each result as passed/failed/pending with a concise tool receipt or UI
observation. Document app/account policy and rate-limit restrictions separately
from package defects. Public marketplace submission and additional OS support
require their own qualification.
