# Common USB-MIDI update status — 2026-10-18

FM-1 Forge 3.3.0 includes the new common updater in the native Codex plugin panel. The private Site supplies the MCP server and bundled panel UI; firmware bytes and device communication stay in the foreground panel JavaScript. No Python/Node device helper is started.

> Native host result, 2026-10-19: Codex explicitly blocks `midiSysex` in its
> MCP App sandbox before device enumeration. Windows detects stock FM-1 MIDI/audio.
> These controls being present does not establish a working native MIDI connection.
> See [connection diagnosis](CONNECTION_DIAGNOSIS_20261019.md).

## Controls and scope

- **Connect stock MIDI** retains the exact official V15 update route and its existing recovery journal.
- **Connect firmware MIDI** selects an unambiguous FM-1 Forge MIDI pair, verifies `FM1_FORGE_001`, reads its build identity/capabilities, and displays installation unavailable when the backend is disabled.
- **Custom firmware · common SysEx update** accepts a local JSON manifest and its matching `.fwsc`. Package size, hashes, loader, fixed target identity and target build digest are validated before an explicit review and confirmation. Files are not uploaded.
- Stock and common writers use the same same-origin Web Lock. Unresolved attempts block new transfers. There is no automatic retry, force or different-attempt resume. This lock does not exclude other origins or native applications.

The independently authored firmware module exposes class-compliant USB-MIDI, bounded SysEx framing and a pinned SDK active-update adapter. Before arming, firmware hashes its full current 1 MiB flash and compares the reviewed per-unit baseline. The normal build deliberately sets `FM1_MIDI_LOADER_COMPATIBLE=0`: the OTA loader, stock flash layout and preservation of calibration/protected ranges have not been physically qualified. Do not enable the gate or flash this candidate merely because its host tests and static link pass. Existing installed firmware needs that interface before it can use this path; the panel cannot add it remotely.

### Configuration source after the 3.3.0 release

The graphical editor and native form now prepare strict schema v4 with explicit
`usb.uacCapture` and `usb.midiUpdate` selections. New projects enable CDC,
UBOOT recovery, audio playback, audio capture and firmware MIDI; UVC defaults
off. Existing v1–v3 configurations migrate with MIDI off and audio capture equal
to their previous audio setting, retaining their original intent. All v4 USB
fields are required booleans; capture cannot remain enabled when audio is off.

The USB0 IN endpoint budget is four. CDC notification and CDC data use two;
audio capture, MIDI and UVC each use one. Audio playback does not use another
IN endpoint. Any combination within this budget can be selected: keeping MIDI
and video together requires explicitly disabling capture. Removing MIDI or
video instead retains duplex audio. An overbudget fifth-IN selection is
reported and blocks configuration export/build requests; it never silently
changes the chosen modules. Playback-only audio is an explicit capture choice,
not a side effect of enabling MIDI or video.

The experimental MIDI/UVC composite implementation assigns their endpoint
addresses according to the selected profile instead of retaining the previous
fixed IN4 collision. The installation gate remains disabled. Configuration,
descriptor and build checks are separate from enumeration, streaming, OTA
loader/layout qualification and protected-range acceptance on a real FM-1.
These source changes follow the 3.3.0 receipt below; that historical publication
and its 436-test result do not establish their deployment or hardware results.
Opening the new panel also cannot add MIDI to firmware already installed on
the device.

## Portability and evidence

The JavaScript updater uses Web MIDI/SysEx, WebCrypto, strict IndexedDB durability and Web Locks rather than Windows COM or filesystem access. It is designed for Windows, macOS and Linux where the native plugin host exposes those APIs and grants MIDI/SysEx permission. This is architecture portability, not a claim of successful updates on all three operating systems. Mac/Linux hardware acceptance and this common path's physical update test are pending. Firmware compilation currently uses the existing Windows Jieli toolchain.

The inherited UBOOT mass-storage recovery path remains manual. Standard WebUSB protects that interface class. Firmware transfer completion plus the expected reboot identity/build digest does not establish full flash readback, LCD/audio/control acceptance or long-run stability.

## Source and licenses

`site/lib/browser-common/` is an exact copy of the independently authored Apache-2.0 browser core under `firmware/usb-midi/web/` in the private firmware workspace, with scoped license, notice and origin metadata. `fm1-browser-common-ui.mjs` supplies the native-panel adapter. Existing stock, server and firmware code retains its own licensing; no blanket relicensing is implied. The firmware workspace's public-source export is a reviewed-scope preparation candidate, not a published complete firmware SDK or a public release of private history.

## Validation and publication

The full real-checkout Site/browser/UI/SDK/server suite passed 436 tests with zero failures or skips. TypeScript and the production build passed. Focused native common UI/cross-engine checks passed 27 tests, existing stock checks passed 25, and the independent common core passed 37.

Both native writers re-read the opposite engine's durable journal inside their shared exclusive Web Lock before preparing intent or sending a device command. Prepared, active or unknown opposite attempts and storage errors refuse a write. Common Refresh now performs a bounded live read-only identity/capability probe, including disconnect-during-close regressions; it does not merely redraw cached status.

The existing owner-private Site deployed source `ccfe0aa8af1540e0426d53f75bb0a13bc0170b41` successfully with MCP enabled. The same private plugin was updated to 3.3.0, release `pluginrel_6ad4b37739048191b7e07d0880c541ae`; canonical resource is `ui://fm1/forge-panel-v21.html`, with v20 and prior aliases retained. No audience or connection binding changed. Git attributes preserve the copied common-core bytes and recorded origin hashes across checkouts.

The two native tabs available immediately after publication still rendered the previous controls. A fresh native 3.3.0 panel requires separate host-render verification; publication, local UI tests and the old tabs do not prove that host rendering. No permission request, MIDI device open, firmware transfer or clock change was performed during this release.

The companion firmware candidate is tracked in [private draft PR 17](https://github.com/Keitark/fm1-tracker/pull/17). Its current source-only public-preparation snapshot contains 39 scoped Apache-2.0 files, with all current/export hashes matching. Public release and physical installation remain separate gates.
