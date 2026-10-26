# Page as Context installation check

This is a content-free **phase A test**, not the finished browser integration.
It contains Node.js 24.10.0 for macOS arm64, the pinned MCP SDK and license notices.
It requires no global Node, npm, development checkout or manually running broker
for `package_probe`. Nothing is downloaded or registered at server startup.

After installing from the local marketplace, open a new **local** ChatGPT desktop
conversation, select this plugin, and ask:

> Call package_probe with nonce pac_chatgpt_install_001. Return the tool result.

Expected: `ok`, `bundledRuntime` and `installedCache` are true; `pageAccess` is
false. `transport_probe` is reserved for an explicitly provisioned synthetic
browser fixture. It reports unavailable until that fixture is ready. Neither
tool can grant access, install a native host, or read a real page.

The current chat's tools may not refresh until a new conversation or app restart.
Do not restart the app while an agent is editing files. Removing the plugin
removes its cached files; this spike creates no persistent setup itself.

This private test is not an OpenAI directory publication and does not establish
runtime sandbox permissions for the final installer. Production packaging starts
only after the installed-plugin/browser round trip is verified.
