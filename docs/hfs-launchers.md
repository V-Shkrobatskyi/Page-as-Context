# HFS launchers — first use

After enabling **Local HTTP (HFS)**, **Download HFS setup files** downloads
`config.yaml` and a launcher for the browser's OS. Save both beside the HFS
executable. Repeat the download whenever needed; client keys stay unchanged.
The launcher starts only that executable with `--cwd` set to its folder
and `--no-central`. It contains no credentials, downloads nothing and installs no
startup service. Keep the Terminal/console window open; Control-C stops HFS.

Once HFS is ready, see [connecting AI apps and local models](hfs-integration.md#other-ai-apps-and-local-models),
including Antigravity and Ollama-based clients.

## macOS

The HFS archive contains `hfs`, not a native `.app`. The launcher is
`Start HFS.command`. Browser downloads do not grant execute permission. Open
Terminal, type `cd `, drag your HFS folder from Finder into Terminal, then press
Return. Run for each newly downloaded copy:

```sh
chmod u+x "Start HFS.command"
```

You can then double-click the launcher. macOS may separately block the downloaded
`hfs` or launcher. If you trust its source, follow Apple's
[Privacy & Security / Open Anyway procedure](https://support.apple.com/en-euro/guide/mac-help/mh40617/27/mac/27)
and personally confirm the system prompt. A successful test of a locally created
executable launcher does not establish browser-download permission/quarantine behavior.

**“Could not be executed because you do not have appropriate access privileges”**
can mean the launcher lacks execute permission. **Open Anyway** does not add that
permission; use the `chmod` command above. Downloading a replacement creates a new
file that may need it again. To start HFS without the launcher, use the
[manual launch commands](hfs-integration.md#manual-launch--administrator-fallback).

## Windows

Double-click `Start HFS.cmd` beside `hfs.exe` and the configs. Your browser or OS
may require confirmation for a script download or launch. The script does not
request administrator privileges. User-run Windows 10 x64 checks covered startup
and Chrome/Firefox HTTP reads and actions; other Windows versions remain unverified.

## Linux

Choose the official HFS archive matching your CPU. Put `start-hfs.sh` beside `hfs`
and the configs. Open a terminal in that folder and run:

```sh
chmod u+x start-hfs.sh
./start-hfs.sh
```

File managers vary in how they open shell scripts; terminal launch is the documented
path. Shell behavior is tested with a fake executable; real Linux startup, browser
permissions and desktop environments still require live acceptance.

## Partial downloads and clients

If YAML saving is cancelled, retry to download both setup files. If YAML succeeds
but the launcher is cancelled, the same button on the same settings page resumes
only the launcher. Closing the page or changing the generated configuration starts
both downloads again. After a successful pair, another click downloads both again.

**Add client** is separate: it authorizes a new key without downloading anything.
Use **Copy URL** and **Copy Authorization**, or **Export config** for an optional
`page-as-context-hfs-client.json`. The JSON can be kept separately from HFS. Cancelling
its export does not revoke an existing client; **Revoke** removes access.
Setup downloads never create clients. The browser never automatically executes files.
