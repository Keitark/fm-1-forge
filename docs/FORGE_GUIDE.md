# FM1 Forge

FM1 Forge **3.1.3** is the renamed private FM1 App Library plugin. Its existing plugin ID,
Site URL and local bridge remain in use. While the conversation is active, use
**Side-panel New Tab (+) → More tools… → Plugins and MCPs → FM1 Forge**.
This opens Forge's native conversation tab. The global shortcut opens a separate
app view; returning to an earlier chat selects that chat's own panel instance.

The current resource is `ui://fm1/forge-panel-v7.html`; older resource aliases
remain available. Reopen the native conversation tab after an update.
The [native extensions guide](MCP_EXTENSIONS.md) describes the official SDK,
settings, drafts, file editing, mentions, forms and chat handoff. Dated
deployment and actual native-host checks are in [verification](VERIFICATION.md).

Connection status refreshes automatically every five seconds while the normal
panel is visible, and checks again when you return to it. **Bench connected**
means the local relay is running; the separate FM1 status reports USB, MIDI or
UBOOT presence. Failed checks and inventory older than 15 seconds show an
unavailable/stale status rather than a current COM port. Hidden panels pause
polling. **Refresh** also reloads package metadata before reviewing a transfer.
These checks use passive inventory and do not open or program the device.

**Apps library → Add local set** opens the laptop's importer. Select a folder
or exported app bundle JSON files, name the set and review it before adding.
Saved sets filter the app variants in the panel. Package files stay local;
importing does not transfer firmware. See [local app sets](LOCAL_APP_SETS.md)
for supported formats, validation and connection requirements.

Diagnostics installation is still pending. Runtime elevation was canceled;
no new protected helper or firmware write resulted. A ready protected helper
and separately confirmed transfer are required before installing diagnostics.
Build/package checks do not qualify the candidate or hardware.

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

New exports and saved drafts use strict configuration schema v2 with five HAL
booleans. Existing v1 files/drafts import with all HAL access enabled. Native
forms, files, context restore and the local firmware generator share this
contract. Selecting CPU 320 MHz still requires a separate explicit opt-in.

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

`sdk-default` preserves boot clocks. `sdk-320` is experimental and requires exact
clock/bus readback before USB or DMA starts. It is not proven faster than the
default clock. No unsupported 396/480 MHz setter is offered. Test each nondefault
profile on the device before relying on timing or claiming higher FPS.

The pinned SDK's real setter is `system_clock_set`; `clk_set` is a stub. The
320 MHz table reports a 53 MHz LSB. The panel and generator therefore reject
320 MHz combined with the 15/30 MHz LCD presets, which require a 60 MHz LSB.
Use stock DMA with 320 MHz, or SDK-default CPU with the faster LCD choices.

## Transfer methods and recovery

- **Auto/serial:** identify the normal CDC firmware and explicitly quiesce its
  runtime before entering UBOOT; the protected UBOOT writer installs the package.
- **Already UBOOT:** use the same protected application writer directly.
- **Official SysEx:** review a handoff to the locally pinned vendor updater,
  which accepts official `.fwsc` packages and handles MIDI/OTA transitions.

Custom Forge packages are stock-layout application containers, not vendor
`.fwsc` files. Direct CDC COMMIT remains blocked. A vendor updater opening is
not a verified firmware update. Preserve unknown jobs, stopped snapshots and
verified rollback receipts; inspect their exact IDs before another operation.

The current module action unlocks from authoritative saved diagnostic transfer
proof, not a browser preference, app card or simulated preview. Physical control,
sound and screen acceptance remains a device observation.
