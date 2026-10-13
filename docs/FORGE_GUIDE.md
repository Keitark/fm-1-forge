# FM1 Forge

FM1 Forge **3.1.4** is the renamed private FM1 App Library plugin. Its existing plugin ID,
Site URL and local bridge remain in use. While the conversation is active, use
**Side-panel New Tab (+) → More tools… → Plugins and MCPs → FM1 Forge**.
This opens Forge's native conversation tab. The global shortcut opens a separate
app view; returning to an earlier chat selects that chat's own panel instance.

The current source resource is `ui://fm1/forge-panel-v14.html`; older resource aliases
remain available. Reopen the native conversation tab after an update.
The [native extensions guide](MCP_EXTENSIONS.md) describes the official SDK,
settings, drafts, file editing, mentions, forms and chat handoff. Dated
deployment and actual native-host checks are in [verification](VERIFICATION.md).

Connection status refreshes automatically while the normal panel is visible,
and checks again when you return to it. **Bench connected**
means the local relay is running; the separate FM1 status reports USB, MIDI or
UBOOT presence. The last confirmed label stays steady during checks; a small
blinking circle indicates an update. Inventory older than 15 seconds disables
firmware actions and shows its age separately. Hidden panels pause
polling. **Refresh** also reloads package metadata before reviewing a transfer.
These checks use passive inventory and do not open or program the device.

**Apps library → Add local set** opens the laptop's importer. Select a folder
or exported app bundle JSON files, name the set and review it before adding.
Saved sets filter the app variants in the panel. Package files stay local;
importing does not transfer firmware. See [local app sets](LOCAL_APP_SETS.md)
for supported formats, validation and connection requirements.

A ready protected helper and separately confirmed transfer are required for
custom diagnostics. Build/package checks do not qualify the candidate or
hardware; consult the dated verification receipt for completed bench tests.

## First firmware

1. Refresh connection and packages. The local protected helper must be ready.
2. Choose **Review diagnostics install**, review the selected `factory-diag` package
   digest and automatic serial/UBOOT route, then confirm the displayed operation.
3. Follow the original saved job. Write, full readback and serial startup are
   recorded separately; reconnecting never resubmits the write.
4. Test the LCD, all 41 buttons/keys, seven encoders, master volume and audible
   key tones at FM1. UAC playback/capture and long-run stability need real tests.
5. After the service records the exact completed diagnostic baseline, select
   **New firmware project**, configure the graphical modules and **Ask Codex**.

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
hardware. The UBOOT helper and CDC serial are protected enabled defaults.

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
01–04 guide. The main panel omits saved-request history and manual job-ID entry;
an active transfer shows progress and a resume action if delivery is interrupted.
Authoritative receipts and exact-ID recovery remain stored by the service.

Download the configuration as `<project-slug>.fm1-forge.json`; the generator
writes it as `forge.json` inside the new project. **Ask Codex** sends that reviewed
configuration and your brief through the host's supported message action. If
the host does not support it, the same prompt remains available to copy. The
action requests coding; it does not report a completed build or flash a device.

For this example, set **Project folder** to `first-synth` before downloading.
In the FM1 source checkout:

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

## Transfer methods and recovery

- **Auto/serial:** identify the normal CDC firmware and explicitly quiesce its
  runtime before entering UBOOT; the protected UBOOT writer installs the package.
- **Already UBOOT:** use the same protected application writer directly.
- **Stock firmware via SysEx:** review the locally pinned official V15 `.fwsc`
  package and fresh exact MIDI pair, then confirm once. A local Node 22 worker
  using native MIDI handles stock SysEx/OTA transfer and reboot identity checks.
  New updates start from normal stock MIDI mode. Already-OTA mode requires
  local recovery of the original attempt rather than a new approval.
- **Vendor updater:** the separate option under connection details opens the
  locally pinned M-UPGRADE GUI for its manufacturer workflow.

Custom Forge packages are stock-layout application containers, not vendor
`.fwsc` files. Direct CDC COMMIT remains blocked. A vendor updater opening is
not a verified firmware update. Preserve unknown jobs, stopped snapshots and
verified rollback receipts; resume their original operation before another
write. The stock action needs a recognized stock MIDI interface: custom CDC
firmware first needs a separate reviewed stock restore. Generic MIDI names are
not enabled in the panel by guessing which device is FM1.

The stock package is fixed to `FM-1_015`, 699,956 bytes and SHA256
`db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a`.
Package paths and the Node runtime are configured locally, never supplied by
the hosted page. Stock updating is disabled unless the local relay explicitly
enables it. Completion reports **transfer finished** and **reboot identity
verified**; it does not claim full flash readback. A successful stock update
invalidates the old protected baseline and diagnostic proof. Establish a fresh
verified baseline before custom firmware writes. An uncertain outcome blocks
further writes and has no automatic retry.

The native MCP panel runs JavaScript for its UI. Its sandbox does not itself
provide the Windows USB/MIDI driver connection: stock transfer uses the local
JavaScript worker, while Python retains bridge/relay orchestration and the
existing protected serial/UBOOT workflow.

The current module action unlocks from authoritative saved diagnostic transfer
proof, not a browser preference, app card or simulated preview. Physical control,
sound and screen acceptance remains a device observation.

## Connection status

The status text shows the last confirmed connection. Automatic checks use a
small blinking circle beside that text; they do not replace the heading with
“Checking connection.” A fresh observation updates the text when FM1 connects,
disconnects, changes port or enters a different mode.

The observation age appears in the connection details. Expired observations
disable firmware actions while the last confirmed label remains visible.
An old initial response cannot establish a confirmed port. Hidden or offline
panels stop the blinking indicator. Reduced-motion settings disable its
animation.

The firmware-dependent Hardware activity dashboard has been removed from the
panel. Automatic connection detection remains passive PnP inventory and does
not open serial or send firmware telemetry commands.
