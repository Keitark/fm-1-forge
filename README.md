# FM-1 Forge

FM-1 Forge is a Codex plugin workspace for FM-1 device connections, graphical
firmware configuration, local app sets and Codex project builds.

Repository: [Keitark/fm-1-forge](https://github.com/Keitark/fm-1-forge).
Firmware and HAL sources live separately in
[Keitark/fm1-tracker](https://github.com/Keitark/fm1-tracker).

## Windows desktop preview

**FM-1 Forge Windows 3.4.0-alpha.7** packages its own runtime and native MIDI
component. Its Codex panel and stock V15 identity/status connection were verified
on 2026-10-19 without browser MIDI permission. The Windows edition supports reviewed stock V15 restoration and a separate
V15-to-custom FWSC SysEx path with exact Forge build verification. Both require
explicit confirmation and retain original-attempt recovery records. Physical
update acceptance is pending. Subsequent common-firmware self-updates, compiler
distribution and macOS/Linux qualification remain pending.
See [the Windows package guide](desktop/README.md) and
[native panel evidence](docs/WINDOWS_MCP_ROUTING_20261019.md).

The public repository name does not change existing installed plugin IDs,
marketplace IDs, hosted Site URLs or saved settings.

## Hosted edition

**Recorded native-host limitation (2026-10-13):** Codex `26.1007.2314.0` exposes
Web Serial but does not display a device chooser. A real connection attempt
failed before opening FM-1. The JavaScript transport is implemented; this host's
device access is blocked. See [the connection evidence](docs/DIRECT_DEVICE_ACCESS_20261013.md).

**FM-1 Forge 3.3.0** opens a native Codex plugin panel for graphical firmware
configuration, browser-local app sets and direct FM-1 connections. Its default
device path runs JavaScript inside the panel through Web Serial and Web MIDI.
No separate JavaScript installation, Python/Node helper, local relay or startup
process is required for this flow. The existing plugin ID and owner-private
Site remain in use. The panel owns its opaque black background and retains the
official OpenAI MCP Extensions SDK for settings, drafts, project files, composer
mentions, native forms and chat actions.

Read the current [Forge guide](docs/FORGE_GUIDE.md). The owner-private Site hosts
the UI and MCP endpoint. The current source resource is
`ui://fm1/forge-panel-v21.html`. The same private
[FM-1 Forge plugin](https://chatgpt.com/plugins/plugins_6ac9ad3fc1c8819195580a4747c50052)
was updated in place.

Read [the extension guide](docs/MCP_EXTENSIONS.md) for the exact official SDK
source, implemented surfaces and host capability checks. Dated test/deployment
and native-host evidence lives in [verification](docs/VERIFICATION.md).
Use those dated receipts for actual deployment and hardware acceptance.
Older expanded cards can retain a previous UI; open a fresh native Forge tab
to check the updated controls. A package release does not qualify hardware.

Use **Connect USB serial** for known custom firmware diagnostics or **Connect
stock MIDI** for the official update route. Device permission and connection
require an explicit user action. Serial opens only the FM-1 diagnostics USB IDs,
verifies a known firmware identity and sends its read-only status command on
refresh. MIDI selects an exact FM-1 pair and verifies its identity. Presence
changes use the authorized connection's events; startup never opens a device.
The confirmed status stays steady during refresh, with a small blinking circle.
The panel has no hardware-activity dashboard, request-history table or manual
job-ID inspector.

**Apps library → Add local set** imports existing catalog bundle JSON files
directly into browser IndexedDB. Images are bounded and SHA256-checked before
the complete set is saved. Firmware Blobs stay in the browser; only metadata
is rendered. Import does not verify a device baseline or enable custom flashing.
Custom package cards remain imported/unverified and use a separate manual
UBOOT workflow. Browser storage belongs to this origin/profile and is subject
to host retention; unavailable storage has no in-memory substitute.

The graphical editor opens by default, and **Getting started** is collapsed.
CDC/UBOOT recovery and all five user HALs default enabled. Optional UVC selects
256×240 YUY2 / 5 fps using the transport physically confirmed in ProTracker;
the new Forge combination remains unflashed and needs its own capture test.
Canonical schema v3 imports earlier v1/v2 drafts with UVC disabled. **Ask Codex**
hands off the reviewed configuration for project creation and a local compiler
build; preparing or building a project does not authorize flashing.

New projects preserve `sdk-default`, measured at 360 MHz on the tested unit.
The panel shows that CPU setting as read-only and offers no new 320 MHz choice.
Imported `sdk-320` drafts retain their original configuration and stock-DMA
restriction; they are compatibility data, not a recommended speed increase.

**Stock firmware · V15 SysEx update** accepts the user-selected, exact official
V15 `.fwsc` package in the panel. Connect stock MIDI, review its digest and
selected pair, then explicitly confirm **Install stock firmware**. Transfer
runs through Web MIDI, with an IndexedDB attempt journal and exclusive Web Lock;
missing durable storage or locks disables writing. An uncertain attempt blocks
new updates and requires explicit recovery of that original attempt in verified
OTA mode. Completion verifies `FM-1_015` after reboot, not full flash readback.

The 2026-10-13 device check found CDC on COM4 and no stock MIDI interface;
the physical stock/SysEx test remains pending. Browser API presence and offline
tests do not establish permission or hardware acceptance. See
[direct-device evidence](docs/DIRECT_DEVICE_ACCESS_20261013.md) and
[stock update evidence](docs/STOCK_SYSEX_20261013.md) for the actual checks.
UBOOT's vendor mass-storage protocol is outside standard Web Serial/Web MIDI;
custom flashing and the retained protected writer/vendor GUI are separate,
explicitly authorized legacy operations. The old helper startup entry is
disabled reversibly; Forge's normal flow does not launch it.

The experimental **Connect firmware MIDI** path is integrated into the native panel. Its separately reviewed local manifest and package target firmware with the common update interface. Normal candidate firmware advertises installation unavailable until the OTA loader/layout/preservation path is bench-qualified. This does not add common MIDI support to previously installed firmware. See [common update status and portability](docs/COMMON_MIDI_20261018.md).

## Current source and development checks

- `site/lib/fm1-browser-serial.mjs`: explicit, bounded read-only CDC diagnostics.
- `site/lib/browser-stock/`: browser SysEx protocol, package validation, Web MIDI,
  strict IndexedDB journal and cross-tab device lock.
- `site/lib/fm1-browser-library.mjs`: browser-local catalog imports and firmware Blobs.
- `site/lib/fm1-browser-devices-ui.mjs`: trusted connection, review and confirmation controls.
- `site/lib/fm1-module-graph.mjs`: drag/drop modules and validated schema-v3 configuration.
- `site/lib/fm1-app-host.mjs` and `fm1-extension-host.mjs`: native host and extension actions.
- `site/lib/fm1-server.mjs`: owner-private hosted MCP, settings, drafts and resources.

From `site`, development checks use Node; users do not install Node to use the panel:

```powershell
node --test test/*.test.mjs
npx --no-install tsc --noEmit
npm run build
```

The final 3.2.0 source passed 418 Site tests with no skips, TypeScript checking
and the production build. Live permission, storage partition and device results
are recorded separately in the dated evidence. Legacy Python tests remain for
the retained optional bench implementation, rather than the normal panel path.

The records below describe earlier App Library releases and their helper-based
architecture. They are historical receipts, not current setup instructions.

## Earlier App Library implementation

FM1 app library integration for ChatGPT and Codex through a private Site,
MCP App panel, plugin extension entrypoints, and top-level WebMCP tools.

The implementation includes the existing browser store/bridge, a Sites Worker
with HTTP MCP at `/mcp`, a durable D1 request queue, an MCP App library panel,
global/thread extension metadata, WebMCP registration, and an outbound Windows
relay. The relay keeps the existing authenticated bridge and protected writer
local. Version 6 is privately deployed, displays server version 2.2.0, and pins
server SDK 2.3.1 and ext-apps 2.0.3. It detects serial, UBOOT and official
MIDI/SysEx modes, selects
the protected app route automatically, and provides a reviewed handoff to the
pinned official Windows updater. Firmware writes still require human confirmation.
Local tests/build, protected runtime setup, verified readback adoption and the
native offline plan passed. The user-confirmed NES switch completed on
2026-10-10 at 10:38 JST with 96/96 sectors, full readback and serial startup
verified. Subsequent inventory reported COM10 in normal serial mode and the
session idle/unblocked. Physical screen/audio/control acceptance remains
pending (`physical_acceptance:false`); official MIDI/SysEx transfer is untested.
The [saved switch response](docs/evidence/fm1-nes-switch-20261010.json) retains
the original job `9067aa03ef7f4826b9f143722cb5635e`.
See [VERIFICATION.md](docs/VERIFICATION.md).

The owner-private [FM1 App Library](https://fm1-app-library.keitark.chatgpt.site)
is deployed and MCP-ready, and its plugin is installed. The native Codex panel
shows connection, detected mode, packages and saved
jobs. Its current resource is `ui://fm1/device-panel-v6.html`; the v1-v5
aliases serve the published v6 UI. Native v6 rendering is accepted: a newly
opened installed panel showed the actual FM1 on COM10 and applied Mint Light /
Circuit Grid, reporting **Appearance saved on this browser**. The earlier v5 check loaded cached v4,
whose **Refresh** cleared progress asynchronously; that is historical evidence.
The published and tested UI follows
the original job through bounded, cancellable saved job and request reads when
host tools are available;
its **Refresh** updates metadata and preserves selected progress.
Read the dated verification record for the currently attached session and
hardware acceptance; saved inventory does not prove current physical state.
The app and panel icon use an original black/mint
FM-1 silhouette based on the physical front-panel arrangement.

At the historical v6 check, installed-host calls were unavailable: native
**Refresh** rejects `open_fm1_library` as outside its trusted tool scope, and a
repeated assistant open returned **Unknown tool**. The cause and recovery were
unconfirmed at that check; reopening was not a verified fix. See
[host availability issue #6](https://github.com/Keitark/fm-1-forge/issues/6).

The v6 Appearance controls were published on 2026-10-10 at 11:27 JST; native
Mint Light / Circuit Grid rendering is verified in the
[installed-panel screenshot](docs/images/fm1-native-appearance-mint-light.png).
Native custom RGB / Dots and Reset also passed; the final
[FM1 Mint / Circuit Grid screenshot](docs/images/fm1-native-appearance-final.png)
shows the restored selection and all 12 choices. Persistence after reopening
was tested only in the synthetic preview.
SDK versions remain unchanged. The
**Appearance** expander
offers 12 palettes, five patterns (60 combinations), custom RGB background and
accent colors, derived foreground/surface contrast, and **Reset to FM1 Mint**.
Preferences are local, saved where host `localStorage` is allowed, with a
visible fallback applying to this panel only. Changing appearance makes no
external, server or hardware calls. See the
[Appearance guide](docs/USER_GUIDE.md#appearance).

Start with the [user guide](docs/USER_GUIDE.md) for plugin installation, browsing
the connected metadata panel, planning, saved-job recovery, and progress interpretation.

`ChatGPT/Codex → private Site Worker → D1 queue ← outbound Windows relay → existing FM1 bridge → established protected session → FM1`

### Legacy source layout

- `tools/jieli-wl82/remote_store.html`: app library, package selection, write confirmation, and job progress.
- `remote_bridge.py`: loopback HTTP service, authenticated fixed operations, durable jobs, and uncertainty handling.
- `remote_backend.py` and `flash-session-client.ps1`: adapter to an existing protected Windows flashing session.
- `update_mode.py`: passive serial/disk/MIDI classification without opening an endpoint or transmitting SysEx.
- `tools/jieli-wl82/stock-sysex/`: fixed-package JavaScript SysEx/OTA worker, native MIDI adapter and durable attempt journal.
- `remote_catalog.py`: immutable private package validation and device-baseline matching.
- `remote_client.py`: CLI with credential origin restrictions and no automatic job resubmission.
- `job_progress.py`: progress from persisted job/session metadata.
- `site/lib/fm1-server.mjs`: authenticated MCP, user-owned requests, relay routes, and expiring app-switch approvals.
- `site/lib/fm1-ui.mjs`: MCP App host bridge and top-level WebMCP library interface.
- `site/lib/fm1-app-host.mjs`: native panel integration with the pinned MCP Apps SDK.
- `site/lib/fm1-contract.mjs`: narrow tool schemas, extension metadata, and metadata projection.
- `site/db/schema.ts` and `site/drizzle/`: durable D1 queue and approval schema.
- `site_relay.py` and `start-site-relay.ps1`: outbound client, private local journal, and hidden unelevated launcher.
- `docs/SITE_RELAY.md`: relay credentials, launch prerequisites, and recovery contract.
- `docs/INTEGRATION_HANDOFF.md`: architecture, current implementation, and acceptance boundaries.
- `docs/REMOTE_DEBUG_REFERENCE.md`: remote-debug setup reference maintained with the setup chat.
- `source-snapshot.json`: historical hashes and provenance for the initial imported source.

The initial snapshot came from the active `progress-kit/fm1-remote` source on
the Windows bench. Its manifest records that import rather than the later
integration changes. Private packages, ROMs, songs, firmware images,
credentials, session descriptors, job receipts, bundled Python, and vendor
USB tooling are excluded.

### Legacy offline verification

Use Python 3.11 or newer and a Node.js runtime with `node:test`. The tests use synthetic data, temporary directories, mocked subprocesses, and loopback HTTP. They do not open the FM1 device.

```powershell
python -m unittest discover -s tools/jieli-wl82 -p 'test_*.py'
node --test tools/jieli-wl82/test_remote_store.cjs
```

The 3.1.0 release passed **171 Site tests**, TypeScript checking and the production
build, plus **190 Python integration tests**. The official upstream SDK's
**41 tests** passed before packaging. Native context attachment/clearing and
local file opening succeeded. New server-tool actions still require the
host's trusted metadata to be refreshed; see the current
[verification receipt](docs/VERIFICATION.md).

The historical v6 checks passed **189 Python tests**, **62 focused relay tests**,
**10 browser-store JavaScript tests**, and **100 Site tests**: 40 server, 52 UI,
4 SDK, and 4 appearance-engine tests. See
[VERIFICATION.md](docs/VERIFICATION.md) for the dated
results, PowerShell checks, and live validation receipts.
The Python suite includes relay validation, durable
same-ID recovery, switch digest/expiry checks, credential filtering, and the
offline exception fix: failed planning no longer creates an unknown device
outcome that blocks later device operations.

Site typechecking and the v6 production build passed; the published source is
`0ea345a93554ab5f65b5c2c38c77fa03a2d4e8d0`. Actual SDK Client 2.3.1
negotiated modern `2026-07-28` and legacy `2025-11-25` protocols in memory.
An earlier direct deployed client probe returned HTTP 401 and did not establish
remote modern-protocol acceptance. The seven WebMCP tool contracts are covered
by the Site tests; the earlier six-tool release was also checked in a supported
browser against a synthetic HTTP relay. See [WEBMCP.md](docs/WEBMCP.md).

### Legacy local operation

The bridge binds to `127.0.0.1:9770`. The store and `/v1/` API share the same origin. The store token is held in page memory; every data/operation request requires authentication.

Windows device operations require a separately prepared, verified protected flashing session and its reviewed USB dependencies. This repository includes the pipe client, but does not create that session, install Python, supply firmware, or supply the vendor loader. Use the established bench workflow for those prerequisites.

Do not start a duplicate bridge over an existing listener or redirect its state folder to this repository. Preserve the existing job state and unknown-outcome latch. Tailscale Serve can provide private HTTPS for the same-origin store. See the remote-debug reference before changing a running setup.

### Legacy Site and plugin operation

The Site offers catalog and inventory refresh, offline app plans, exact-ID
recovery tools, automatic app-switch review and stock SysEx review. The native
stock action runs the locally configured Node 22 worker with `@julusian/midi`
3.8.1 for the pinned official V15 package. The separate vendor-updater review
opens the pinned manufacturer's GUI and does not claim transfer completion.
The MCP panel uses server tools
through its host bridge. The full website separately feature-detects
`document.modelContext.registerTool`; normal library controls remain available
when WebMCP is unavailable. The panel does not embed the loopback store.

The hosted server receives sanitized metadata through an outbound relay; it
does not directly reach laptop loopback or provide USB access by itself.
Relay setup requires distinct private Site relay and platform service
credentials plus the existing local bridge token. See
[SITE_RELAY.md](docs/SITE_RELAY.md) before preparing or starting it. Starting a
relay process does not verify a hosted connection or authorize a device write.

App switching is disabled by default on the relay. An enabled bench capability
still requires explicit human confirmation of an expiring one-use approval
bound to the signed-in user, catalog ID, package digest, and entry method.
The relay checks the digest and expiry before submitting to the existing
protected writer. Transport delivery and bridge job outcome remain distinct:
a delivered response can contain a failed or unknown job, and interrupted
submissions are inspected by their saved ID without resubmission.

Native appearance rendering and earlier metadata round trips are recorded
above; issue #6 records a historical host-tool scope failure. The tested UI
preserves the original job ID across metadata refresh and a lost
confirmation reply. Its tested automatic progress following uses only
`get_fm1_job` and `get_fm1_request`; it never repeats a submission. Following
stops on a terminal outcome, cancellation or its inspection limit;
the active **Resume progress** action resumes that exact ID. There is no
everyday request-history table or manual job inspector. Relay metadata is bounded to 58,000
serialized bytes, with durable
receipt recovery for proven oversize rejections. Device writes and
physical screen/audio/control acceptance require
the established bench prerequisites and an explicitly confirmed operation.
