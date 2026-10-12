# FM1 Forge

The private FM1 App Library plugin is now **FM1 Forge 3.1.3**: install an asset-free
diagnostic baseline, test hardware, configure USB/HAL/user modules graphically,
then ask Codex to create and build a firmware project. It preserves the existing
plugin ID, hosted MCP endpoint, local protected writer and saved-job history.
The panel defaults to a plain, opaque black background. It uses the official
OpenAI MCP Extensions SDK for native settings, project file editing, composer
mentions, configuration forms, deep links and chat context/message actions.

Read the current [Forge guide](docs/FORGE_GUIDE.md). The owner-private Site's
final Forge release is deployed with MCP enabled at the existing endpoint. Its
resource is `ui://fm1/forge-panel-v4.html`. The same private
[FM1 Forge plugin](https://chatgpt.com/plugins/plugins_6ac9ad3fc1c8819195580a4747c50052)
was updated in place.

Read [the extension guide](docs/MCP_EXTENSIONS.md) for the exact official SDK
source, implemented surfaces and host capability checks. Dated test/deployment
and native-host evidence lives in [verification](docs/VERIFICATION.md).
Diagnostics installation and physical acceptance remain pending. Runtime
elevation was canceled: no new protected helper was started and no firmware
write occurred. Older expanded cards can retain a previous UI; inspect the
newest Forge card for the current extension controls. A package release does
not establish device qualification.

The experimental `sdk-320` clock supports stock DMA only. Its SDK table supplies
a 53 MHz LSB, incompatible with the 15/30 MHz RGB444 LCD presets' required 60 MHz LSB;
choose the SDK-default CPU clock for those LCD presets.

The records below describe earlier App Library releases. Use the Forge guide
and dated verification entries for the current workflow.

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

The latest installed-host calls are unavailable despite active v6: native
**Refresh** rejects `open_fm1_library` as outside its trusted tool scope, and a
repeated assistant open returned **Unknown tool**. The cause and recovery are
unconfirmed; reopening is not a verified fix. See
[host availability issue #6](https://github.com/Keitark/fm1-marketplace-plugin/issues/6).

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

## Source layout

- `tools/jieli-wl82/remote_store.html`: app library, package selection, write confirmation, and job progress.
- `remote_bridge.py`: loopback HTTP service, authenticated fixed operations, durable jobs, and uncertainty handling.
- `remote_backend.py` and `flash-session-client.ps1`: adapter to an existing protected Windows flashing session.
- `update_mode.py`: passive serial/disk/MIDI classification without opening an endpoint or transmitting SysEx.
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

## Offline verification

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

## Local operation

The bridge binds to `127.0.0.1:9770`. The store and `/v1/` API share the same origin. The store token is held in page memory; every data/operation request requires authentication.

Windows device operations require a separately prepared, verified protected flashing session and its reviewed USB dependencies. This repository includes the pipe client, but does not create that session, install Python, supply firmware, or supply the vendor loader. Use the established bench workflow for those prerequisites.

Do not start a duplicate bridge over an existing listener or redirect its state folder to this repository. Preserve the existing job state and unknown-outcome latch. Tailscale Serve can provide private HTTPS for the same-origin store. See the remote-debug reference before changing a running setup.

## Site and plugin operation

The Site offers catalog and inventory refresh, offline app plans, saved
request/job inspection, automatic app-switch review, and official SysEx updater
review. The latter opens the pinned manufacturer's tool for an official `.fwsc`
package; it does not report a completed update from a GUI launch. The MCP panel uses server tools
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
above; current host-tool availability is limited by issue #6. The tested UI
preserves the original job ID across metadata refresh and a lost
confirmation reply. Its tested automatic progress following uses only
`get_fm1_job` and `get_fm1_request`; it never repeats a submission. Following
stops on a terminal outcome, cancellation or its inspection limit;
**Inspect job** resumes that exact ID. Relay metadata is bounded to 58,000
serialized bytes, with durable
receipt recovery for proven oversize rejections. Device writes and
physical screen/audio/control acceptance require
the established bench prerequisites and an explicitly confirmed operation.
