# FM1 Forge user guide

For the current **3.1.3** diagnostic-to-project workflow, black default panel,
graphical module configuration and all transfer methods, read
[FORGE_GUIDE.md](FORGE_GUIDE.md). The final private service and plugin release
are updated. The current resource is `ui://fm1/forge-panel-v5.html`. Open the
native conversation tab through **New Tab (+) → More tools… → Plugins and MCPs
→ FM1 Forge** to see configuration drafts, native settings, file editing and
chat context/draft actions. Read [MCP_EXTENSIONS.md](MCP_EXTENSIONS.md)
for the complete extension surfaces and platform capability checks. Older
expanded cards can retain earlier UI.

The default is plain, opaque black with **Reset to Forge Black**; thirteen
palettes and five patterns remain available as local preferences. The module
designer preserves CDC/UBOOT recovery and lets you select UAC, the LCD preset
and diagnostics or your own user module. `sdk-320` requires stock DMA; the
RGB444 presets require SDK-default CPU because they need a 60 MHz LSB, while
the 320 MHz SDK table supplies 53 MHz.

Diagnostics transfer has not been performed. Runtime elevation was canceled,
so no new protected helper was started and no firmware was written. Install
and verify the diagnostics baseline before **New firmware project** unlocks;
then test the physical inputs, LCD and sound. **Ask Codex** requests a build
through a supported host message or provides a copyable prompt. It does not
flash the firmware or claim build/hardware acceptance.

The material below records earlier App Library behavior and dated bench checks.

## Earlier App Library guide

Use the installed **FM1 App Library** plugin in ChatGPT or Codex and ask it to
open your FM1 app library. Its native panel is the primary interface selected
for this integration. The private [FM1 App Library website](https://fm1-app-library.keitark.chatgpt.site)
is also available; sign in with the owner account when prompted. Both use the
[black/mint FM-1 mark](../site/public/fm1-icon.png).

The latest host tool calls are unavailable despite active v6. Native
**Refresh** rejects `open_fm1_library` as outside its trusted tool scope; a
repeated assistant open returned **Unknown tool**. Local Appearance controls
still work. The cause and recovery remain unconfirmed, and reopening is not a
verified fix. Follow [issue #6](https://github.com/Keitark/fm1-marketplace-plugin/issues/6).

## Appearance

The Appearance controls were published on 2026-10-10 at 11:27 JST for resource
`ui://fm1/device-panel-v6.html`, server version **2.2.0**, with v1-v5 aliases.
The newly opened installed v6 panel showed the actual FM1 on COM10 and applied
**Mint Light / Circuit Grid**, reporting **Appearance saved on this browser**.
Open the **Appearance**
expander and choose a palette, then a **Background pattern**.

The 12 palettes are **FM1 Mint**, **Mint Light**, **Midnight Blue**, **Ocean Cyan**,
**Royal Violet**, **Sakura Pink**, **Signal Red**, **Amber**, **Forest Green**,
**Graphite**, **Paper**, and **High Contrast**. The five patterns are **Solid**,
**Circuit Grid**, **Dots**, **Scanlines**, and **Diagonal Stripes**: 60 preset
combinations in total.

For custom RGB colors, use the **Background colour** and **Accent colour**
pickers or enter six-digit hex values such as `#101a18`. Foreground and surface
colors are derived from those choices to adapt contrast. **Reset to FM1 Mint**
restores the default palette and Solid pattern.

Preferences stay local and are saved only where the host permits
`localStorage`. If storage is unavailable, the status explains that the choice
applies to this panel only. Appearance changes make no external, server or
hardware calls.

The [native Mint Light / Circuit Grid screenshot](images/fm1-native-appearance-mint-light.png)
records that installed-panel check. Native custom background `#f8f4ee` and
accent `#007ca8` with Dots also passed, and native Reset restored FM1 Mint /
Solid. The prior FM1 Mint / Circuit Grid choice was then restored in the
[final native screenshot](images/fm1-native-appearance-final.png), which shows
all 12 choices. Persistence after reopening and additional palette checks were
verified only in the synthetic preview and formal tests.

The [Mint Light / Circuit Grid preview](images/fm1-appearance-mint-light-preview.png)
and [Royal Violet / Scanlines preview](images/fm1-appearance-violet-preview.png)
show synthetic embedded-host previews, rather than an actual native bench panel.

## Progress and the latest NES switch (2026-10-10)

The progress bar appears under **Saved requests & progress** when a job is
selected. With host tools available, the updated UI follows the original job automatically through sector
verification, full readback and startup. A full sector bar alone does not mean
the entire operation has finished. Tracking pauses on connection loss, an
unknown outcome, or its polling limit; **Inspect job** resumes that exact ID
without submitting the firmware operation again.

**Refresh** updates device/catalog data when host tools are available; it does
not reload the UI resource. Published v6 preserves selected progress. During the earlier v5 check,
a freshly opened native panel received cached v4; the later v6 panel loaded
the current Appearance controls successfully. This historical cache result
does not establish recovery for the current tool-scope failure. A directly
connected custom MCP plugin has a documented
[connection-level Refresh flow](https://developers.openai.com/plugins/deploy/connect-chatgpt).
That flow differs from the panel's device-data button. Older saved request
entries are delivery snapshots; use **Inspect job** for current device progress.

The later NES switch `9067aa03ef7f4826b9f143722cb5635e` completed successfully:
**96/96 sectors**, a matching full-image readback, and verified serial startup.
The [saved switch result](evidence/fm1-nes-switch-20261010.json) records the
actual operation. The device subsequently reported normal serial mode on
**COM10**, with the protected session idle and unblocked. Screen, sound and
physical controls still require bench acceptance; vendor SysEx transfer has
not been tested.

## Initial v4 setup acceptance (2026-10-10)

The installed native **v4** panel works in Codex. **Refresh** shows **FM1 in
UBOOT**, six ready app packages, and switching **Enabled**. The official updater
is configured, with **Needs FM1 MIDI connection** because the connected device
currently exposes UBOOT rather than its official MIDI interface. Both local
switching and official-update capabilities were enabled deliberately after the
protected session was validated; neither setting confirms an individual update.

A NES review showed **auto → already_uboot** and the selected package digest.
It was canceled without submitting a switch. NES **View plan** subsequently
succeeded without device I/O. Its original request/job ID is
`427b240eda7c4867b403aee8f8838682`; native inspection and the installed tool
returned that same job with **96 planned sectors**, `blocked:false`, and
candidate SHA-256
`4d4da3ab34b643034ea91ddb670fd3556b737a05835ed77fced687eae6ad345c`.
At that point, write completion, full readback and boot verification were false,
and no candidate flash had been submitted. The later NES operation is recorded
above. The
[saved native plan response](evidence/fm1-v4-native-plan-20261010.json) records
the installed tool's result.

The local protected session now uses a frozen runtime, is idle/unblocked, and
has no running loader or pending reset after the plan. Its current baseline
came from two
matching actual 1 MiB device reads; the original evidence is preserved. The
relay retains its existing private state and credentials. See
[SITE_RELAY.md](SITE_RELAY.md) for the dated paths, digests and process evidence.
Vendor GUI transfer remains pending until the required official MIDI mode is
available and its separate review is confirmed.

![Native v4 dark panel showing UBOOT and ready app packages](images/fm1-native-panel-v4-live.png)

## Install the ChatGPT/Codex plugin

Use **Install** or **Connect** on the offered **FM1 App Library** installation
card, then complete any sign-in prompts. If that offer is no longer visible,
ask to reopen the installation offer for the provisioned plugin. There is no
need to create another plugin or configure a local MCP server.

The plugin advertises a sidebar entry and a conversation panel. Historically, on 2026-10-09,
the installed plugin's library, status, catalog, and saved-job tools were
verified. The then-current Site v3 panel rendered in Codex with **FM1 on COM4** and
the black/mint interface. **Refresh** and exact saved-job inspection after
the relay restart also passed in that native panel. No Chrome
extension is required for this native plugin experience. The website can be
opened independently of plugin installation.

## Historical metadata bench state (2026-10-09, v3)

The following is the recorded metadata acceptance check. Use **Refresh** for
the current session, update mode and enable flags; later setup does not turn
these earlier observations into hardware acceptance.

Browse the five app cards: **NES, Doom, MDX, Buddha, and ProTracker**. At that
check, the local relay was connected with switching **Disabled**. It reported six
validated private package variants; all were blocked because that bridge had
no configured protected session or verified baseline at the time.

Inventory reported COM4 and CDC/audio interfaces. This verifies metadata
transport, not a device write or physical acceptance. A tested MDX **View plan**
request reached the bridge and failed with **Start a protected session on the
laptop first**. That is an expected prerequisite failure; no protected helper
was created and no device I/O occurred.

Inspection after the relay restart returned that same original job and
prerequisite failure. Refresh retained its job ID; it did not create another
plan or switch.

If the relay later disconnects, **Bench disconnected** and **Offline** are
expected. Saved responses can remain visible after a disconnect. With no
private package metadata, cards show **No package connected**; the cards
describe supported apps rather than installed firmware.

## When the bench is ready

The bridge, outbound relay, verified protected session and current baseline
are connected in the 2026-10-10 accepted setup above. Use **Refresh** before
reviewing a new operation; preserve the existing listener and its state.
If the session or current baseline is unavailable later, the bench owner must
restore the prerequisites through the established bench workflow. The Site
does not prepare that session. See [SITE_RELAY.md](SITE_RELAY.md) for connection
and recovery details.

1. The visible panel checks connection inventory automatically every five seconds
   and checks again when you return. **Bench connected** describes the relay;
   FM1 presence is shown separately. A failed/old check is marked unavailable or
   stale, with the last known port kept only as history. Click **Refresh** to also
   load package metadata before reviewing an operation.
2. Choose a package variant on its app card. Check its **Ready/Blocked** state
   and displayed **SHA256**. A blocked package needs bench-side attention.
3. Click **View plan** to check the selected package offline. This creates a
   saved request and does not write to the device.
4. Keep the original request and job IDs. Click a row under **Saved requests &
   progress** to inspect that request, or paste the original 32-character job
   ID into **Inspect a saved job** and click **Inspect job**. After a timeout or
   disconnect, resume those IDs instead of submitting another operation.
   **Refresh** preserves the job ID already entered in the recovery field.

## Review an app switch

Switching must already be enabled deliberately at the bench. **Review switch**
opens a review without writing anything. Check the exact app, variant,
SHA-256, and entry method against the package you intend to use.

Click **Confirm app switch** yourself only when that review is correct and
the bench is ready. The approval expires and can be used once. **Cancel** or
Escape closes the review and clears its approval. Browser tools can open a
review; they do not expose a confirmation tool. The panel saves the original
job ID before submitting confirmation. If the confirmation reply is lost,
use **Inspect job** with that ID before reviewing another switch; do not
submit the operation again.

## Choose the update route

The **Auto** entry method chooses the protected app route from fresh passive
inventory: one recognized CDC interface uses the existing serial entry flow;
one UBOOT disk uses the already-in-UBOOT flow. An inventory error, duplicate
devices, conflicting modes or a changed mode prevents submission. The approved
catalog ID and package SHA-256 still identify the custom app to install.
Auto does not convert an app bundle into an official firmware package.

For official firmware, open its review and confirm the displayed executable
SHA-256 yourself. The bench must separately enable official-update
handoff and expose one recognized stock or OTA MIDI input/output pair. The
confirmed action opens the locally configured M-UPGRADE GUI; select the correct
official `.fwsc` there and complete the manufacturer workflow locally. The
[manufacturer download page](https://www.m-vave.com/download) lists the generic
[M-UPGRADE package](https://yms-file-store.oss-cn-hongkong.aliyuncs.com/software/pc/M-UPGRADE.zip)
and [FM-1 V15 firmware](https://yms-file-store.oss-cn-hongkong.aliyuncs.com/software/firmware/FM-1.fwsc).
The older FM1-specific bundle embeds V14, so use the reviewed generic updater
for the external V15 package.

A saved successful handoff means the GUI started. It does not establish a
firmware transfer or verification. Keep its original job ID if any reply is
lost. Handoff persistently blocks further device jobs because the old baseline
may no longer describe the FM1. After official completion, the bench owner must
establish a fresh protected session and verified current-unit baseline while
preserving the previous state and receipts. There is no remote unblock or
automatic retry. Direct SysEx writing is not implemented by this integration.

Automatic mode selection and vendor handoff have offline contract coverage.
The current native auto review and offline plan are accepted above. Vendor
transfer and candidate physical acceptance must still be recorded separately
for the connected unit.

## Read progress correctly

**Bench connected** means the relay is responding. Package readiness means the
bench reported a usable package. A delivered request can still contain a
failed or unknown device job; inspect the saved job's own status.

Sector counts describe reported verified progress. They do not establish
successful startup, screen output, sound, or working keys. An unknown device
outcome needs inspection by the bench owner before another device operation.
Physical acceptance remains a separate bench check.

Site version 6 is deployed owner-private with MCP enabled; actual native v6
Mint Light / Circuit Grid rendering is accepted in Codex. The initial v4
native panel acceptance remains historical. The server serves its current UI
through v1-v5 aliases
for installed-plugin compatibility, but an older cached resource or tool title
can still appear. See
[VERIFICATION.md](VERIFICATION.md) for the dated deployment, native panel,
metadata, and hardware acceptance evidence.

Further detail: [relay setup](SITE_RELAY.md), [browser tools and verification](WEBMCP.md),
[integration handoff](INTEGRATION_HANDOFF.md), and [verification evidence](VERIFICATION.md).
