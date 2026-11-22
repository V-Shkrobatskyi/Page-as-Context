# Firefox Android verification

Build and temporarily install the shared Firefox package on a connected Android
device, then use the checklist below to verify Copy, Preview, element selection, settings and popup usability.
Record the browser and Android versions, device model, build revision and results
in the release PR or a separate verification report.

## Supported behavior

Firefox Android supports whole-page and selected-element capture, Preview/edit and Copy; Save is unavailable because its downloads API
is unsupported. Platform setup and compatibility are described in Mozilla's
[Android development guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/).

The shared Firefox package lists downloads only as an optional permission for
Desktop Save. Android never requests that permission or calls downloads APIs.
The popup explicitly detects Android and keeps Save unavailable even if a
browser exposes a downloads stub. Copy, formats, compression and privacy settings
use the same pipeline as Desktop.

Verify **Select** by tapping a block, adjusting with **Select parent** or **Back**,
then opening **Preview & edit** or using **Copy context**. Confirm that only the
selected block is exported and picker Save stays disabled without permission
prompts. The desktop-only **Connect MCP** button remains visible but disabled.

## Shared popup layout

The Firefox package uses `entrypoints/popup/firefox.css`, which imports the base
styles. Local platform detection adds `data-platform="android"` to the popup body
on Android. Only that platform gets responsive width, wrapped feedback, and 44px
touch targets; Desktop retains its original 376px popup and 18px range control.
Hover styles apply only to fine pointers with hover support. Android Save
preferences uses explicit touch press/release feedback, without a post-click
timer, to avoid suppressed native active styling after slider changes.

An optional Desktop Gecko supporting layout probe is:

```sh
npm run check:desktop-runtime -- --targets firefox --popup-layout android
```

It uses shared Firefox CSS in Android mode inside fixture iframes, not a physical
Android browser. Device testing remains necessary.

## Device setup and probe

Install Android Platform Tools using the official Google distribution and put
`adb` in PATH. On a physical Android device, enable USB debugging, authorize this
computer, install Firefox and enable Firefox Remote debugging via USB. See the
Mozilla guide above for exact version-specific setup. Record browser version,
Android version, device model, date and build revision in a local report; device
serial numbers and exported page text are not needed in tracked reports.

```sh
adb devices
npm run build:firefox
```

Follow the [web-ext command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
to run the temporary installation of the Android build on the connected device:

```sh
npx --no-install web-ext run --target firefox-android --source-dir .output/firefox-mv3 --android-device YOUR_DEVICE --firefox-apk org.mozilla.firefox
```

If ADB is downloaded but not in PATH, pass its executable explicitly, for example
`--adb-bin "$HOME/Downloads/platform-tools/adb"`. Replace that path with the actual
location. After code or style changes, rebuild with `npm run build:firefox`;
web-ext watches the built directory. Reopen the popup, or restart web-ext if the
installed extension has not refreshed.

Use `org.mozilla.firefox_beta` or `org.mozilla.fenix` only when testing the installed
Beta or Nightly application respectively. Confirm the actual installed package
with ADB. This command starts/reloads a development extension and requires an
authorized connected device; it does not sign or publish an add-on.

Serve the synthetic fixtures on the computer and forward the port:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
adb reverse tcp:8765 tcp:8765
```

On the device, open `http://127.0.0.1:8765/tests/fixtures/quality/desktop-holdout.html`
and `http://127.0.0.1:8765/tests/manual/firefox-dom-quality.html`. Use the extension
from Firefox's action menu. Run all four profiles and both formats with privacy on
and off, pasting into a local text editor. Check live states, Unicode, mixed
checkboxes, tabs/details, password omission, API-key/Bearer redaction, open shadow
slots, scope warnings and clear errors on restricted pages. Save must be shown as
unavailable rather than reporting a nonexistent saved file.

Test portrait/landscape, large system fonts, touch selection of every Compression
stop, then immediately press Save preferences. Check that feedback begins on
contact and ends on release without sticking or a delayed flash. Also check
scroll, focus, keyboard, popup dismissal, double taps, navigation/tab closure,
app switch and reopening after background/low-memory termination. Record actual
Copy destination bytes and latency; Desktop headless results do not substitute.
Stop the server and remove the port mapping afterwards:

```sh
adb reverse --remove tcp:8765
```

## Packaging

Desktop and Android use one Firefox ZIP, one matching source ZIP and one AMO
listing. Follow [BUILDING.md](../BUILDING.md) for packaging and
[the Firefox publication guide](firefox-release.md) for AMO submission.

## Embedded documents

The Firefox package uses the same iframe coordinator on Desktop and Android.
Device verification remains manual. Serve the iframe fixture with
`node scripts/probe-firefox-iframes.mjs --serve`, note the printed port, and use
`adb reverse tcp:PORT tcp:PORT`. On the device, visit the printed fixture URL
using `127.0.0.1` as the main host and `localhost` for the embedded cross-origin
host; both names use the forwarded port. Replace PORT with the actual port.

Check nested frames, srcdoc, blank and sandbox documents; below-viewport content;
hidden/transparent/1×1 exclusions; password omission with privacy on and off;
all four profiles and both formats. Same-origin capture should work without a
site prompt. Include frames from other sites must start unchecked, just as on
Desktop. Enable it and check one prompt for all HTTP/HTTPS websites, deny/cancel,
popup dismissal and reopening, redirects and repeated copies without another host
prompt. No Save preferences click is required. Disable it and check that all site
grants are removed and a fresh copy excludes other-site frames. Re-enabling should
request consent again. Revoke access in browser settings and reopen the popup.
Access persists across tabs and browser restarts while enabled. Save must
remain unavailable. Check app switching, low-memory termination and repeated taps.
Remove the port mapping and stop the server after testing.
