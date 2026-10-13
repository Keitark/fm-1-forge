# FM1 Forge

The current Codex build exposes Web Serial but supplies no visible chooser on
the tested connection attempt. Direct native serial connection is blocked;
API/storage checks are not device acceptance. See
[the host evidence](DIRECT_DEVICE_ACCESS_20261013.md). A plugin cannot add the
missing native chooser from its iframe, and no helper is started as a fallback.

FM1 Forge **3.2.0** is the private firmware workspace plugin. Its existing
plugin ID and Site URL remain in use. The default connection path runs inside
the panel with Web Serial and Web MIDI; it requires no separately installed
JavaScript runtime, Python/Node helper, relay or startup process.
While the conversation is active, use
**Side-panel New Tab (+) → More tools… → Plugins and MCPs → FM1 Forge**.
This opens Forge's native conversation tab. The global shortcut opens a separate
app view; returning to an earlier chat selects that chat's own panel instance.

The current source resource is `ui://fm1/forge-panel-v19.html`; older resource
aliases remain available. Open a fresh native conversation tab after an update.
Reopening alone does not prove that a host with cached descriptors selected the
new URI; check the dated native-host evidence before claiming an updated panel.
The [native extensions guide](MCP_EXTENSIONS.md) describes the official SDK,
settings, drafts, file editing, mentions, forms and chat handoff. Dated
deployment and actual native-host checks are in [verification](VERIFICATION.md).

Choose **Connect USB serial** for custom CDC firmware or **Connect stock MIDI**
for stock firmware. These explicit buttons request host permission. No device
is opened at startup. The serial path checks USB VID `3654` / PID `5155`, opens
115200 baud and verifies a known HELLO identity. It uses only that profile's
read-only status command on **Refresh**. The existing CDC firmware requires
one DTR readiness assertion; the panel never pulses it or sends STOP/UBOOT.
MIDI connection selects an exact FM1 input/output pair and verifies its model.
Unrelated, generic or ambiguous MIDI devices are refused.

Once connected, device disconnect events update the label automatically.
Reconnect through the connection button; the panel never silently chooses a
replacement. The confirmed label stays steady during refresh and a small
blinking circle shows the check. There is no Hardware activity dashboard.
Browser API presence is separate from permission and successful device access.

**Apps library → Add local set** opens a browser file chooser. Enter an optional
set name, then select exported catalog JSON files, or use **Add exported bundle
folder**. A set contains 1–8 bundles, each up to 1.5 MB, with an embedded 1 MiB
image and matching SHA256. Paths, metadata, base64 and the complete set are
validated before one IndexedDB transaction saves anything. Loose binaries,
source trees, ROMs and music files need a catalog export first.

Firmware Blobs stay in browser IndexedDB; the cards show metadata only. Imports
remain **Imported / unverified**, with no verified device baseline or custom
transfer permission. Their route is manual UBOOT. Library refresh reads the
local store and rechecks saved hashes. Storage belongs to this browser
origin/profile and is subject to host retention. If storage is unavailable,
the panel reports it and does not substitute a pretend durable library.

Preparing a configuration and asking Codex to create a project do not require
the old diagnostics-transfer proof gate. Custom firmware installation remains
a separate, explicitly authorized operation. Build/package checks do not
qualify hardware; consult the dated verification receipt for actual tests.

## First firmware

1. Open the graphical editor and choose diagnostics or your own user module.
2. Configure USB, HAL access and LCD modules, then name the project.
3. Save/download the draft or use **Ask Codex** to create and build the project.
4. Review the compiled package and verified current-unit baseline before a
   separate manual/legacy UBOOT installation. The direct panel does not flash
   custom packages or install the diagnostics baseline.
5. After an authorized diagnostics installation, test the LCD, all 41
   buttons/keys, seven encoders, master volume and audible key tones at FM1.
   UAC playback/capture, UVC capture and long-run stability need real tests.

The basic firmware is independent diagnostic software, not the vendor's stock
firmware. It contains no ROM, WAD, song or proprietary bank. The LCD displays
input states, coverage, encoder counts, volume and measured LCD frame rate.
Piano keys play a quiet triangle tone with short ramps and a two-second cap.
The source and offline LCD preview are in the FM1 repository's
`firmware/forge/README.md` and `firmware/forge/preview/diagnostics.png`.

## Module designer

Drag modules from **Available modules** into **USB**, **HAL**, **User module**
or **Tweaks**. Drag optional modules back to the shelf to remove them, or use
Add/Remove buttons and HAL checkboxes. Wrong-section drops are rejected.
Use **Replace** to switch diagnostics and the blank user-module starter.

All five HAL access modules default enabled: keys/pads/buttons, encoders,
volume telemetry, LCD drawing and user audio. Deselecting them removes access
from user callbacks; fixed diagnostics, USB audio mixing and physical master
volume protection continue. This selects API access rather than powering off
hardware. Firmware-resident UBOOT recovery and CDC serial are protected enabled
defaults; this UBOOT module is not a laptop helper process.

The graph separates fixed USB/system recovery from shared HAL and editable user
code. CDC and UBOOT recovery remain enabled. USB Audio Class can be selected;
it provides stereo playback and digital synth capture rather than analog mic
capture or a flash protocol. HAL ABI1 exposes all inputs, LCD rendering, audio
and immutable health snapshots. User code has init/update/render/audio/shutdown
callbacks, with bounded IRQ audio work and output clipping.

New exports and saved drafts use strict configuration schema v3 with five HAL
booleans and optional `usb.uvc`. Existing v1/v2 files import with UVC disabled;
v1 imports also enable all HAL access. Native
forms, files, context restore and the local firmware generator share this
contract. New projects preserve `sdk-default`; CPU is a read-only summary in
the panel. Imported legacy `sdk-320` drafts retain their original setting.

**USB video · UVC** adds 256×240 YUY2 screen output at a nominal 5 fps, using
the transport physically confirmed in the ProTracker session. The 240×240 firmware screen
has eight black pixels at either side. Video defaults off and does not remove
CDC/UBOOT or optional UAC. The new Forge combination remains unflashed and needs its own device
capture test; the ProTracker capture is evidence for the reused transport.

The module editor is expanded by default. **Getting started** holds the optional
01–04 guide. The main panel omits saved-request history and manual job-ID entry.
Only an actual stock transfer shows progress. An interrupted stock attempt is
kept in the local IndexedDB journal and requires an explicit recovery review;
refresh or reopening never starts the transfer again.

Download the configuration as `<project-slug>.fm1-forge.json`; the generator
writes it as `forge.json` inside the new project. **Ask Codex** sends that reviewed
configuration and your brief through the host's supported message action. If
the host does not support it, the same prompt remains available to copy. The
action requests coding; it does not report a completed build or flash a device.

### Local development tools

The panel hands design data to Codex; the C firmware compiler runs in the
developer's source checkout. These finite build tools are separate from device
connections and do not require a background bridge. For example, set **Project
folder** to `first-synth` before downloading. In the FM1 source checkout:

```powershell
python firmware/forge/create_project.py --base projects --slug first-synth --config first-synth.fm1-forge.json
python firmware/forge/build_project.py --project projects/first-synth --dry-run
python firmware/forge/build_project.py --project projects/first-synth
```

Creation refuses an existing project directory. Edit the generated `user.c`
and choose `module: "user"`. The build honors the selected module, user HAL access, USB audio,
clock and LCD presets and creates a new output folder. Packaging and an exact
offline transfer review follow a successful audited build.

## Display and clock settings

The panel defaults to opaque `#000000` with a plain background. Older version-1
appearance preferences migrate to that requested default once. Later selections
retain 13 palettes, five patterns and custom colours; they are local preferences
and send no device command.

LCD choices are maintained stock DMA, nominal 15 MHz packed RGB444 and nominal
30 MHz packed RGB444. Faster presets require the expected bus clock, retain
async DMA ownership, and expose actual frame rate and error counters.

`sdk-default` preserves boot clocks, measured as 360 MHz on the tested unit.
On 2026-10-12 both that profile and `sdk-320` completed three matching-checksum
workloads, with duplex UAC in each final run. 320 MHz was slower than the measured
360 MHz default. The panel therefore offers no CPU tweak module or new 320 MHz
selection; the default appears as a read-only summary. These measurements apply
to the tested unit and do not establish prolonged stability or faster LCD FPS.

The pinned SDK's real setter is `system_clock_set`; `clk_set` is a stub. The
320 MHz table reports a 53 MHz LSB. The panel and generator therefore reject
legacy 320 MHz configurations combined with the 15/30 MHz LCD presets, which
require a 60 MHz LSB. Importing an older draft preserves its original clock
intent rather than silently changing it; stock DMA remains its valid LCD option.

## Stock transfer and recovery

1. Click **Connect stock MIDI** and grant SysEx access. The panel verifies a
   unique exact `FM-1` / `FM-1 MIDI` pair and its firmware identity.
2. Expand **Stock firmware · V15 SysEx update** and select the official V15
   `.fwsc` file. The browser validates it locally; nothing is uploaded.
3. Click **Review stock update** and check the identity, package digest and
   exact MIDI input/output names. Review does not write firmware.
4. Click **Install stock firmware** yourself. The panel records the original
   attempt before the first upgrade command, transfers through Web MIDI and
   checks the reboot identity. Keep USB connected and the panel open.

The transfer requires IndexedDB with strict durability and an exclusive Web
Lock shared by this origin's panels. Missing storage or locks disables writing;
there is no memory/localStorage fallback. An uncertain attempt blocks a new
update. Recovery uses the same original IDs and official package, a freshly
verified `ota-FM-1` loader identity and a separate **Review original transfer
recovery** / **Resume original transfer** confirmation. There is no automatic
retry or new-update approval in OTA mode.

The stock package is fixed to `FM-1_015`, 699,956 bytes and SHA256
`db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a`.
No Node binary or local helper configuration is part of this browser path.
Completion reports **transfer finished** and **reboot identity verified**; it
does not claim full flash readback. A stock update makes a prior custom-writer
baseline obsolete. Establish a fresh verified current-unit baseline before any
later custom write. Physical control, sound and screen acceptance remains a
device observation.

The current custom firmware exposes COM4 CDC without stock MIDI, so the actual
stock/SysEx test is pending. Reaching stock MIDI first requires a separately
authorized stock restore; the panel does not convert or force custom firmware
into that route. See [stock evidence](STOCK_SYSEX_20261013.md) and
[direct access evidence](DIRECT_DEVICE_ACCESS_20261013.md) for current results.

### Manual and legacy custom transfers

CDC COMMIT remains blocked. UBOOT is a vendor mass-storage protocol outside
standard browser Web Serial/Web MIDI, so the helper-free panel does not provide
custom flashing. The retained protected serial → UBOOT and already-UBOOT writer,
Node stock worker and M-UPGRADE GUI are optional legacy bench operations,
separately configured and explicitly authorized. Their old receipts and
unknown-outcome latches remain intact. Opening a vendor GUI is not a verified
update. The previous helper Startup entry is disabled reversibly and is not a
normal Forge prerequisite. Read [legacy relay setup](SITE_RELAY.md) only when
deliberately using that separate bench path.

## Connection status

The status text shows the last confirmed connection. Automatic checks use a
small blinking circle beside that text; they do not replace the heading with
“Checking connection.” A fresh observation updates the text when FM1 connects,
disconnects, changes port or enters a different mode.

The default path uses the confirmed browser connection, not old relay
inventory or a saved COM-port string. Serial refresh reads only the recognized
firmware's status; stock MIDI refresh uses already-authorized endpoint metadata
without reopening endpoints or sending another identity query. Unplugging the
selected device invalidates the connection. Reduced-motion settings disable
the check animation.

The firmware-dependent Hardware activity dashboard is removed. Read-only
diagnostic frame/error counters do not establish key activity, LCD output or
audible playback. Closing the panel releases the serial connection. A stock
write is a foreground operation; do not close the panel or disconnect USB
during it. No refresh, startup hook or reconnect automatically writes firmware.
