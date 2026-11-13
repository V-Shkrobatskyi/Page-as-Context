# Local HTTP (HFS)

Connect a local AI app supporting Streamable HTTP MCP with a bearer token.
Cloud-hosted and stdio-only clients cannot connect directly. Native helper can
stay enabled alongside HTTP.

## Setup

1. **Download [HFS 3.3.4](https://github.com/rejetto/hfs/releases/tag/v3.3.4).**
   Under **Assets**, choose your OS/CPU archive and extract it.
   [Recorded checksums](../integrations/hfs/compatibility.json) cover macOS ARM64.
2. **Create a private local folder**, for example **Page as Context HFS**.
   On macOS: Finder → Go → Home → Documents → File → New Folder.
   On Windows: File Explorer → Documents → New → Folder. On Linux, use your file
   manager. Avoid cloud-synced locations. Move the extracted `hfs` (`hfs.exe` on
   Windows) and `plugins` folder here. Use a separate folder from existing HFS installations.
3. **Download setup files.** Open extension **Settings → MCP integration**.
   Enable **Local HTTP (HFS)**, keep `http://127.0.0.1:39861`, and **Apply settings**.
   Approve browser permissions if asked. Choose **Download HFS setup files** and
   save `config.yaml` and the OS launcher in your HFS folder. The button is enabled
   when **Enable Local HTTP (HFS)** is checked. **Show configuration in folder** reveals the YAML.

   Example on macOS:

   ```text
   Page as Context HFS/
   ├── hfs
   ├── plugins/
   ├── config.yaml
   └── Start HFS.command
   ```

   Setup downloads do not create clients. You can download them again without
   changing existing client keys. Keep `config.yaml` private.
4. **Start the launcher for your OS:**

   - macOS: `Start HFS.command`.
   - Windows: `Start HFS.cmd`, beside `hfs.exe`.
   - Linux: `start-hfs.sh`.

   **macOS/Linux need execute permission for each newly downloaded launcher.**
   Open Terminal in the HFS folder and run `chmod u+x "Start HFS.command"`
   (Linux: `chmod u+x start-hfs.sh`), then open the launcher.
   macOS **Open Anyway** is a separate security approval; it does not grant execute
   permission. See [first-use instructions](hfs-launchers.md).
   The launcher selects the correct config folder. Keep its Terminal/console open,
   then choose **Retry HFS** in the extension; expect **HFS: ready**.
   This dedicated config blocks file sharing and HFS's browser administration UI.
5. **Add and connect an AI client.** Under **HTTP clients**, enter the app's name
   and choose **Add client**. This authorizes its key immediately, without downloading
   files or code pairing. Use **Copy URL** and **Copy Authorization**
   buttons to fill its HTTP MCP settings, or use **Export config** for a JSON file;
   see [other AI apps and local models](#other-ai-apps-and-local-models).
   Refresh/reconnect the app's MCP server after changing credentials.
   Older unapproved profiles use **Authorize & export** once before copying.
6. **Test reading.** On a harmless page, open the extension popup and choose
   **AI Read**. Ask the assistant to discover and read shared tabs. Disable the old
   native plugin temporarily for an HTTP-only test. Test Write later on a disposable
   form with **Ask before each action**. Read ↔ Write needs no app restart.

## Other AI apps and local models

The app must support **Streamable HTTP MCP**, custom **Authorization headers**
and the [supported protocol](../integrations/hfs/PROTOCOL.md). Its MCP client must
run on the same computer as HFS: `127.0.0.1` refers to the client's own machine
(or container). A model's tool-calling support alone is not an MCP connection.

Use a separate HTTP client for each AI app to manage sharing and revocation
independently. **Add client** creates only a client: no files or HFS restart are
needed. The extension synchronizes client IDs and key hashes with the running HFS.
Use the copy buttons or optionally **Export config** to save its client JSON.
Anyone with a client's bearer credential can act as that client.

Use **Copy URL** and **Copy Authorization** on the client's row, or copy values
from `page-as-context-hfs-client.json` into the app's MCP settings:

| Exported field | App setting |
| --- | --- |
| `url` | Full server URL, including `/pac/v1/mcp/.../...` |
| `http_headers.Authorization` | Authorization header, including `Bearer ` |

Connection details are not displayed on the page. **Copy Authorization** places
the full bearer credential on your clipboard; keep it private. **Revoke** removes
the client's access. Managed settings can disable copying.

Field names vary by app; the exported JSON is not a universal import format.
Refresh/reconnect its MCP server, then share a tab with that client using **AI Read**.
Test with: “Use only page-as-context-hfs: call list_shared_tabs, then
read_page_context for one returned connectionId. Describe the page without changing it.”
For actions, explicitly enable **Write** and approve requests as configured.

### Google Antigravity

Read and a theme-change click were manually verified through HFS in Antigravity.
Open its custom `mcp_config.json` (not the server store), preserve existing entries,
and add this under `mcpServers`, replacing both placeholder values from your export:

```json
{
  "mcpServers": {
    "page-as-context-hfs": {
      "serverUrl": "PASTE_COPY_URL_VALUE",
      "headers": {
        "Authorization": "PASTE_COPY_AUTHORIZATION_VALUE"
      }
    }
  }
}
```

Use `serverUrl` instead of `url`, and `headers` instead of `http_headers`.
Copy Authorization as a whole; do not add a second `Bearer` prefix. Save and
refresh the server. Config navigation varies by version; see
[Antigravity's MCP instructions](https://antigravity.google/docs/mcp).

### Ollama and local LLMs

Use an **MCP-capable local chat app or agent** connected to your local model runtime,
such as Ollama. Configure HFS in that app's MCP settings, not as the model's API URL.
For a custom agent, its MCP client discovers/calls HFS tools and passes their results
back to the model; see [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture)
and [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling).
Choose a model with tool-calling support. A manual test using **Goose Desktop +
Ollama + `llama3.2:3b`** successfully listed Firefox tabs and read Web form through
HFS. Reading required explicitly supplying the returned connection ID after the
model used a placeholder; reliable automatic tool chaining and Write were not
verified for this combination. Check actual tool outputs: small models may invent
page details or misreport errors. Other local apps/models remain unverified.

## Recovery and removal

- **Disconnected:** check HFS and the endpoint. After a crash, wait up to 45 seconds
  before retrying. Settings shows the remaining lease wait in seconds; refreshing
  the page does not restart the countdown. At zero, status refreshes automatically;
  Automatic mode follows the background retry until its result is available.
  After a browser restart, reconnect and
  share the tab again.
- **Stop:** disable Local HTTP and apply; Control-C stops HFS. **Revoke**
  invalidates one client's key. Delete private files and any startup entry separately.
- **Partial save:** if the launcher save is cancelled after YAML succeeds, retry
  **Download HFS setup files** on the same settings page to save only the launcher.
  A later successful download can be repeated for both files. Downloads do not
  add clients; cancelling optional JSON export does not undo **Add client**.

## Manual launch / administrator fallback

Start HFS directly from a terminal instead of using the launcher. Replace both
paths with your actual executable and private configuration folder:

macOS / Linux:

```sh
"/path/to/hfs" --cwd "/path/to/Page as Context HFS" --no-central
```

Windows (PowerShell):

```powershell
& "C:\path\to\hfs.exe" --cwd "C:\path\to\Page as Context HFS" --no-central
```

`--cwd` must point to the folder containing `config.yaml`; placing it beside the
executable alone does not select it. Keep the terminal open; Control-C stops HFS.
Direct launch still requires OS permission to run the HFS executable.

## Support and technical details

HFS runs with your OS account's privileges. Manual checks covered macOS ARM64
startup with explicit OS approval, Chrome/Firefox HTTP reads and actions, and
Antigravity reads and actions. Goose/Ollama reading was verified with explicit
connection IDs as described above. User-run Windows 10 x64 checks also covered
startup and Chrome/Firefox HTTP reads and actions (Firefox 159.0). Linux startup,
automatic startup and broader sleep/crash recovery still require live acceptance.
The optional [LaunchAgent template](../integrations/hfs/launch-agent.plist.template)
is not installed automatically.

See the [protocol](../integrations/hfs/PROTOCOL.md) and
[architecture decision](adr/0002-hfs-http-transport.md) for security/recovery details.
Developers: `npm run check:hfs`; synthetic live check:
`npm run check:hfs:live -- --binary /path/to/hfs`.


### Compact post-fill responses

Native plugins and HTTP share the same scoped fill behavior: a bounded response
can fall back to full context, while full internal capture and privacy controls
still apply. Applied confirms dispatch, not persistence; read after an unknown
result instead of replaying a write. See the transport-independent
[scoped fill contract](mcp-development.md#scoped-post-fill-responses),
[grouped writes](mcp-development.md#grouped-native-writes) and
[targeted reads](mcp-development.md#exact-targeted-reads).
