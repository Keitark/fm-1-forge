# FM1 Codex integration handoff

## Drag-and-drop module configuration (2026-10-12)

Current UI resource: `ui://fm1/forge-panel-v6.html`; v5 and all earlier aliases
remain served. The installed plugin package stays at 3.1.3; this Site update
adds real drag/drop into USB, HAL, User module and Tweaks, with accessible
Add/Remove/Replace controls. CDC and UBOOT helper are protected enabled defaults.
Five user HAL access flags default true and round-trip through exports, drafts,
native forms/files and context; strict v1 imports normalize into schema v2.
The local firmware builder translates the flags into actual callback/input
access controls while fixed diagnostics, recovery and master gain remain.
Reopen an already loaded panel to obtain the graph; no device write is involved.


## Native background contrast correction (2026-10-12)

The current UI resource is `ui://fm1/forge-panel-v5.html`. An app-owned,
full-viewport shell paints the selected opaque palette and pattern even when
Codex makes html/body transparent. Standalone headings, Refresh, card gaps and
footer use this surface. All 13 palettes and five patterns were checked against
a white transparent-host fixture; package identity/version stays 3.1.3.
Reopen an existing tab to load the updated UI; if registered entrypoints still
select an older resource, refresh the existing connection metadata.
The published model-tool native MCP App was checked with Codex's light host
theme and an opaque black shell covering the viewport; see verification.

## Native timer correction 3.1.3 (2026-10-12)

The first real 3.1.2 native opening exposed **Illegal invocation** in the
monitor's default clock. Native timer wrappers now preserve the Window receiver;
the receiver-sensitive regression reproduces and checks this exact failure.
The current release is 3.1.3. Codex still loaded cached 3.1.2 scripts after a
reopen, so the canonical resource is now `ui://fm1/forge-panel-v4.html` while v3
and older aliases remain available. Refresh the existing connection metadata
if a new panel still selects v3. Native acceptance requires observing the new
scripts and repeated automatic status checks, not just reopening a tab.
The newly opened model-tool MCP App loaded the corrected scripts and refreshed
to **FM1 disconnected** without a manual click; its checked age renewed on a
later cycle. The existing native thread tab can still need reopening after its
metadata refresh. Exact evidence is recorded in [verification](VERIFICATION.md).

## Automatic connection refresh 3.1.2 (2026-10-12)

The normal panel now refreshes passive FM1 presence while visible, on opening
and on return/network recovery. Relay heartbeat and actual FM1 presence are
separate. Inventory expires after 15 seconds; failed checks, old snapshots and
delayed journal results cannot keep a COM port displayed as current. Hidden
panels pause polling, teardown disposes it, and unresolved status requests are
shared instead of resubmitted. Drafts, selected packages, approvals and progress
remain intact. **Refresh** still reloads package metadata before a transfer.

Reopen an already loaded native conversation tab once to load this release's
code. Thereafter connection checks are automatic. See [the verification receipt](VERIFICATION.md)
for exact publication and test evidence. The earlier native settings trusted-tool
scope limitation and tab-icon acceptance remain separate outstanding items.
No firmware write, official updater launch or helper elevation was performed.

## Native panel patch 3.1.1 (2026-10-12)

The current private account release is 3.1.1. ProTracker's special last-card
span was removed and actual native DOM measurement confirmed all six cards
equal. Native tab metadata now selects the existing 128×128 PNG explicitly;
SVG remains in panel/logo assets. See the newest [verification receipt](VERIFICATION.md)
for exact Site/plugin IDs and hashes, and [the opening guide](MCP_EXTENSIONS.md#conversation-tabs-and-icons).

Use the conversation's New Tab → More tools… → Plugins and MCPs → FM1 Forge
entrypoint to keep the plugin beside this chat. The global shortcut opens its
own app view; expanded app-card tabs use another host icon path. The user
confirmed that the native conversation tab stays open, but its icon still
needed verification after the PNG patch. The trusted catalog still rejected
`settings.read` in the settled native check. The initial snapshot label is not
RPC acceptance. Refresh connection metadata and verify these before claiming
complete native functionality. No transfer or helper elevation was performed.

## FM1 Forge official SDK release 3.1.0 (2026-10-11)

The current source integrates the official OpenAI MCP Extensions SDK 0.2.0,
packaged from immutable upstream revision
`0d606217705e0e71eb21fff009619b67b80611dc`. See [the extension guide](MCP_EXTENSIONS.md)
and [package provenance](../site/vendor/openai-mcp-extensions.ORIGIN.md).
The canonical resource is now `ui://fm1/forge-panel-v3.html`; all earlier aliases
remain. The same plugin identity, private Site, bridge and saved transfers are
retained. New migration `0003_equal_sage.sql` adds owner-scoped settings and
configuration draft tables without changing existing job or proof data.

Native settings, mentions, resources, extended forms, deep links, file editing,
model context, current/new messages and drafts, file opening and onboarding are
implemented with capability checks. Configuration drafts may be saved before
hardware qualification; the existing firmware project handoff still requires
the authoritative diagnostic baseline. No extension action bypasses the
protected writer, approves a transfer or performs a hardware operation.

Current release/deployment IDs, complete check results and actual native-host
observations are recorded in the dated 3.1.0 entry in [VERIFICATION.md](VERIFICATION.md).
The previous entries below are historical evidence.

## FM1 Forge final release 3.0.1 (2026-10-11)

The same owner-private plugin remains
`plugins_6ac9ad3fc1c8819195580a4747c50052`, displayed as **FM1 Forge**.
Final release `pluginrel_6acb15fe4ce88191bb211830c3425552` is version **3.0.1**.
The Site URL and MCP endpoint remain
`https://fm1-app-library.keitark.chatgpt.site/` and its `/mcp` endpoint.
Final Site source `3e97b09eaa41515deda1401cd46d42397ee479ed` deployed as
`appgdep_6acb15fa58908191bf74baadb8ab0b70`; deployment succeeded with MCP enabled.

The current resource is `ui://fm1/forge-panel-v2.html`, retaining earlier
aliases. It supplies the black/plain default, diagnostic onboarding,
USB/system → HAL → user module designer, strict versioned project configuration
and supported host message/copy fallback. Project creation uses durable
per-owner diagnostic write/full-readback/startup proof; it remains available
after recent-request history rotates. No browser preference or delivery
snapshot can invent that proof, and uncertain jobs retain their original IDs.

The final correction rejects `sdk-320` with either RGB444 LCD preset. The real
SDK setter is `system_clock_set`; its 320 MHz table gives a 53 MHz LSB, while
the 15/30 MHz RGB444 paths require 60 MHz. Stock DMA remains selectable with
`sdk-320`; all LCD presets remain selectable with `sdk-default`.

Full final Site tests, typechecking and production build passed. Integration
verification passed 181 tests. The primary immutable-runtime suite ran 51
tests with five skipped; its backend suite passed 35 tests. These checks do
not qualify the firmware candidate or physical hardware.

The newest native card has not yet been expanded; older expanded instances
remain cached App Library UI. Native rendering and panel-to-conversation
acceptance remain separate from publication. Runtime elevation was canceled:
no new protected helper was started, no diagnostic installation occurred and
no firmware write was performed. The ready protected-helper prerequisite and
explicit transfer confirmation remain pending. See [VERIFICATION.md](VERIFICATION.md)
and the current [Forge guide](FORGE_GUIDE.md).

## Initial FM1 Forge 3.0.0 release (2026-10-11, historical)

The existing private plugin was updated in place to **3.0.0**, displayed as FM1
Forge. ID `plugins_6ac9ad3fc1c8819195580a4747c50052`, endpoint and privacy remain
unchanged. Release `pluginrel_6acb135969b08191aafc2078dcbbc09f` was read back;
the Codex plugin cache has version 3.0.0. The owner-private Site deployment
`appgdep_6acb132eb06c8191b4dfc59c0b83ac18` succeeded with MCP enabled from pushed
source `090cb049f4ad9c76d9484da7a162ef48d161f8d9`.

Resource `ui://fm1/forge-panel-v1.html` adds opaque black/plain appearance,
diagnostics onboarding, a graphical fixed USB/system → HAL → user module
configuration and supported native message action/copy fallback. Previous
resource aliases remain available. D1 records only exact terminal diagnostic
write/full-readback/startup proof as a durable per-owner project gate.

The live installed tool returns six profiles and `forge.diagnostic_baseline:null`;
no diagnostic installation has been performed. Existing expanded App Library
instances remain cached older UI, so native Forge rendering still needs the
newest card expanded. This is distinct from the saved release and live service.
The guide is [FORGE_GUIDE.md](FORGE_GUIDE.md).

## Historical v6 implementation

Site v6 is now published owner-private with MCP enabled. The installed Codex
panel has loaded its **Appearance** controls and accepted Mint Light/Circuit
Grid, custom hex colours/Dots and reset. Twelve palettes, five patterns, custom
RGB colours and local preference fallback are implemented; all 100 Site tests,
typecheck and build passed. A later native Refresh is currently rejected by
the host's trusted tool scope, and FM1 connector tools are absent from the
current inventory despite Sites reporting an active MCP-ready v6. The cause
is unconfirmed. The loaded Appearance controls still work; native reopening
and current device tool availability require revalidation
([issue #6](https://github.com/Keitark/fm1-marketplace-plugin/issues/6)). See the latest acceptance
in [VERIFICATION.md](VERIFICATION.md) and controls in [USER_GUIDE.md](USER_GUIDE.md).

This repository now includes the FM1 Site adapter, MCP App panel, top-level
WebMCP tools and outbound Windows relay alongside the original store/bridge
source. The initial publication at `b024784` established the source foundation;
the integration extends that work rather than replacing the protected writer.
The owner-private [FM1 App Library](https://fm1-app-library.keitark.chatgpt.site)
is deployed and MCP-ready. The plugin is installed: library, status, catalog,
and saved-job tools have succeeded. Refresh worked in the actual native MCP
App iframe, and live Site WebMCP Refresh worked through the authenticated
local relay. The native plugin/panel is the user's selected primary interface;
it does not require a Chrome extension.

## Subsequent NES operation and progress correction (2026-10-10)

The later NES switch `9067aa03ef7f4826b9f143722cb5635e` succeeded with 96/96
verified sectors, matching full readback and serial startup. Fresh inventory
then reported COM10 in normal serial mode and an idle/unblocked session. The
UI correction automatically follows the original saved job using read-only
inspection; v5 Refresh preserves its progress. Site v5 is published, but the
newly opened native panel still received cached v4, so live v5 automatic
tracking acceptance awaits host metadata/resource-cache refresh and reopening.
See [VERIFICATION.md](VERIFICATION.md) for the actual switch
response, progress regressions and publication evidence. Physical screen,
audio and controls, and vendor SysEx transfer, remain separate bench checks.

## Initial v4 setup acceptance (2026-10-10)

Site **v4** is deployed owner-private with MCP enabled. Deployment
`appgdep_6ac9903cd9e08191b5df920575373d1e` uses source
`bd87d14a039b8ef5233a6b3c60291c3642ee7f98`. The resource is
`ui://fm1/device-panel-v4.html`; v1, v2 and v3 aliases serve the current panel.
The actual native MCP App panel renders the dark interface (`rgb(16,26,24)`),
and **Refresh** succeeds. It shows **FM1 in UBOOT**, six ready catalog packages,
app switching **Enabled**, and the configured official updater as
**Needs FM1 MIDI connection**. A NES review displayed **auto → already_uboot**
and the reviewed package digest; it was canceled without submitting a switch.

The native NES **View plan** succeeded with original request/bridge job
`427b240eda7c4867b403aee8f8838682`. Inspection request
`ea27707a4bb04f428aef9d4729b21f1e` and the installed `get_fm1_request` tool
returned that same original job with authoritative `status:succeeded`,
`result.ok:true`, `device_io:false`, `blocked:false`, and **96 planned sectors**.
Its candidate SHA-256 is
`4d4da3ab34b643034ea91ddb670fd3556b737a05835ed77fced687eae6ad345c`.
`write_complete`, `full_readback_verified` and `boot_verified` remain false:
this accepts offline planning, not a candidate write or startup. The
[saved native plan response](evidence/fm1-v4-native-plan-20261010.json) records
the installed tool result. Three historical failed `plan_app` jobs remain
preserved alongside this successful job.

The current protected helper is
`C:\Program Files\FM1FlashSession-53b32bdc8a444cdda6c838934831e49c`
(recorded PID **240396**). It uses the frozen Python runtime with
`trusted_local:false`; state is idle/unblocked with no running loader or reset
pending, including after the offline plan. Two actual matching 1 MiB device
reads established baseline SHA-256
`c719cad560ddcbc05a795cb77e11d65eeb108e1dfdb76afb508d71533437bf1f`.
Original read evidence is preserved under `readback-source`. The adopted
baseline retains its local target identity guard; physical identifiers and
firmware bytes are not published through the Site.

The bridge is on loopback port **9770**, recorded PID **262496**, retaining
`C:\Users\keita\AppData\Local\FM1RemoteBridge`. The outbound relay is recorded
PID **223876**, retaining
`C:\Users\keita\AppData\Local\FM1SiteRelay\fm1-app-library`. Both
`AllowSwitch` and `AllowOfficialUpdate` were intentionally enabled after session
validation. These are dated process observations; inspect current processes
before a future launch. Existing tokens remain private and were retained.

The pinned vendor closure is the full directory containing
`F:\dev\fm1\references\downloads\M-UPGRADE-20261010\M-UPGRADE\M-UPGRADE.exe`;
its executable SHA-256 is
`cbda7a95e506cdeefbe39e9718106586147f2ee9857a83e0509644e349591e3b`.
The device is currently in UBOOT and its official MIDI interface is absent.
Vendor GUI transfer, a candidate flash, and physical candidate startup,
screen/audio/control acceptance remain pending. No actual flash was submitted.

Validation passed **99 focused runtime tests**, **189 integration Python
tests**, **10 JavaScript tests**, and **69 Site tests**, plus Site typechecking,
production build and PowerShell parsing. One absent private profile fixture was
excluded from the runtime scope; broad private writer fixture acceptance is
not claimed. The 69 Site tests comprise 40 server, 25 UI and 4 actual SDK tests.

![Native v4 dark panel showing UBOOT and ready packages](images/fm1-native-panel-v4-live.png)

## Historical metadata acceptance (2026-10-09)

At the recorded 2026-10-09 metadata check, the local bridge had no configured
protected session or official updater. Inventory reported COM4 and CDC/audio interfaces, and six validated
private packages all remained `ready:false`. An MDX plan reached the bridge
but correctly failed on the protected-session prerequisite. No helper was
created and no device I/O, firmware write, or physical acceptance occurred.
The browser's six WebMCP tools also passed earlier synthetic execution and
invalid-input checks.

## Historical v3 SDK deployment and native panel (2026-10-09)

Site version **3** pins official server SDK **2.3.1** and **ext-apps 2.0.3**.
The then-current Site suite passed **45 tests** (26 server, 15 UI, 4 SDK), typechecking
and the production build passed, and deployment
`appgdep_6ac8fc0660648191a2521acd37271e3c` succeeded with runtime revision 1
and MCP-ready status. Its source SHA is
`0e76fa6923d74ca96f71312a77d033b4c4935723`. Actual SDK Client 2.3.1 negotiated
current **2026-07-28** and legacy **2025-11-25** protocols in memory.

The v3 native Codex panel rendered the black/mint **FM1 plugin** interface
with **FM1 on COM4**. Its then-current descriptor pointed to
`ui://fm1/device-panel-v3.html`; the v1 and v2 resource URLs also served that
UI, preserving older installed registrations. A read-only Codex
app-server metadata refresh reported the installed app callable and its new
**FM1 device panel** tool title. Compatibility resource reads resolved the
previous stale native UI without reinstalling the plugin. The existing
panel-tab title can still reflect its earlier registration.

The historical direct deployed SDK Client probe using the existing relay
service credential returned **HTTP 401**. That credential-specific probe did
not establish remote modern-protocol negotiation. See
[VERIFICATION.md](VERIFICATION.md) for the exact evidence and remaining boundaries.

## Architecture

`ChatGPT/Codex -> private Site Worker -> durable D1 queue <- outbound Windows relay -> existing loopback FM1 bridge -> established protected session -> FM1`

- The Site Worker handles HTTP MCP at `/mcp`, including tool discovery and MCP
  UI resources. The app library advertises global and thread entrypoints. Its
  panel uses the MCP App host bridge; the full website separately feature-detects
  `document.modelContext.registerTool` and offers WebMCP in the top-level page.
  The ordinary library controls remain available when WebMCP is unavailable.
- D1 holds user-owned requests, delivery outcomes and expiring approvals. The
  relay polls outbound; the hosted server does not connect directly to laptop
  loopback or assume private-tailnet reachability.
- The relay authenticates to the private Site with a Sites service token
  (`OAI-Sites-Authorization`) and a separate scoped relay bearer token. The
  existing bridge bearer credential stays on the Windows side. These are
  distinct credentials; none belongs in catalog data, tool results or browser
  storage.
- The local store remains same-origin with its HTTP API and retains
  `frame-ancestors 'none'`. The native panel serves its own UI resource instead
  of embedding that loopback page.

## Operations and approval

| Capability | Local API reused | Boundary |
|---|---|---|
| Inventory and writer state | `GET /v1/status` | Inventory/persisted state; preserve blocked and unknown outcomes. |
| App library | `GET /v1/catalog` | Variant metadata, digest and baseline readiness; no firmware bytes. |
| Offline plan | `POST /v1/jobs`, `plan_app` | Existing catalog ID and verified baseline; no device I/O. |
| Saved job inspection | `GET /v1/jobs/<id>` | Resume the original ID without resubmission. |
| App switching | `POST /v1/jobs`, `switch_app` | Approved `auto`, `serial` or `already_uboot` entry, package digest and protected writer checks. |
| Official firmware | `POST /v1/jobs`, `official_updater` | Separate human approval and local enable flag; exact updater executable digest; fixed vendor GUI handoff. |

Relay switching is disabled by default. Enabling its local capability is a
deliberate bench configuration step, not permission for a particular write.
The Site stages a review without submitting a write. Human confirmation consumes
an expiring, one-use approval bound to the signed-in user, catalog ID, package
digest and entry method; queue insertion and approval consumption are atomic.
The approval ID becomes the durable bridge job ID. The confirmation tool is
app-visible rather than a model-visible shortcut. The local bridge still has
no per-write consent field; the adapter owns this approval boundary.

Official handoff has its own disabled-by-default local
`-AllowOfficialUpdate`/`--allow-official-update` capability and expiring one-use
approval bound to the reviewed updater SHA-256. Its strict bridge request has
only `id`, `operation` and `expected_sha256`; paths, commands, arguments and
firmware payloads cannot be supplied remotely. The backend rechecks the pinned
updater and fresh mode before GUI launch; the relay preserves the same ID on uncertainty.

Passive inventory chooses one protected CDC or UBOOT route for `auto`; exact
stock/OTA MIDI names select the official GUI route. Inventory errors, duplicate
or conflicting candidates, incomplete MIDI pairs and changed mode prevent
automatic selection. WinMM capability queries open no MIDI endpoint. MIDI
names establish a routing candidate, not unique-unit provenance. The selected
custom app still uses the existing protected writer and catalog digest.

The generic manufacturer M-UPGRADE GUI accepts official `.fwsc` selection;
the operator completes that flow locally. Preserve its full Qt dependency
directory. The older FM1-specific GUI embeds V14; the separately published
official package is V15. See the [manufacturer downloads and instructions](https://www.m-vave.com/download).
The adapter does not implement a direct SysEx sender or convert app bundles to
`.fwsc`. A saved successful GUI handoff reports `written_verified:false` and
persistently blocks device jobs. After official completion, establish a fresh
protected session and verified current-unit baseline; retain prior evidence.

Auto routing and official handoff have offline contract coverage. The dated
v4 deployment, native review, successful offline plan and verified baseline
acceptance are recorded above. Actual vendor transfer, a candidate write and
physical screen/audio/control acceptance remain separate pending checks.

Only metadata crosses the relay. Keep private catalog bundle JSON, firmware,
ROM/music inputs, baseline images, session descriptors, receipts, device paths
and tokens local. Low-level recovery/helper management remains a bench operation.
Serial numbers, PnP unit identifiers, and related physical identity fields are
also filtered before Site results and local relay result journals are saved.
`serial_status` and `read_firmware` are device operations, not passive metadata
reads; firmware read setup can alter loader/protection state.

## Durable outcomes and deployment boundaries

Requests are saved before delivery and journaled locally before bridge
submission. A lost POST response is inspected using its existing ID; it is not
replaced by a new write request. Delivery state and authoritative bridge job
status are separate: successful transport can return a failed or unknown job.
Preserve the saved outcome and verified progress even after a transport failure.
The native panel retains the original job ID across metadata refresh and
inspection. It saves the approval/job ID before confirmation; a lost reply
directs the user to inspect that ID rather than submit another switch.

Relay metadata is bounded to 58,000 encoded bytes to leave room beneath the
Site's request/result limits. Legacy completed receipts replay unchanged until
an explicit size rejection proves they were not accepted. Only HTTP 413 or
local `request_too_large` permits compaction, which is persisted before retry.
Timeouts and immutable-result conflicts never replace a receipt or repeat a
bridge submission. The larger existing bridge/journal limits remain intact.
Unknown device outcomes retain the bridge's persistent block and require local
inspection. Offline backend exceptions now produce `failed`, so a failed
`plan_app`, `plan` or `environment` request does not create device uncertainty.

The historical 2026-10-09 metadata rollout used the supported local bridge on loopback port 9770
(observed PID 134988) and updated relay (observed PID 422648), with switching disabled.
These process IDs are dated evidence, not future launch configuration. The
relay never launches or restarts the bridge or replaces its state.
Do not substitute a new state directory, clear latches or change a frozen helper
to bring the Site online. Inspect live launcher/session selection before any
operational change. At that check, the older protected snapshot worker was
stopped and lacked the required remote-read guard, and the remote laptop was
offline. Do not reactivate that worker or infer that its historical session is
usable locally.

The historical MDX plan request/job `d984e14543204d1e93a966099cc708d7` was delivered
successfully but has authoritative status `failed` with **Start a protected
session on the laptop first**. Historical native inspection request
`2e5b770a13ed49c69ba90f18bdca17ea` verified the original saved job. It used no
device I/O. This is historical evidence of transport and prerequisite handling,
not successful planning or device acceptance.

Maintain the verified protected session and unit-specific baseline through
the bench workflow before device operations. Separately accept any
explicitly authorized hardware operation and physical screen/audio/control behavior.

## Provenance and ownership

The initial snapshot imported the active `progress-kit/fm1-remote` store/bridge
source. `source-snapshot.json` remains its historical import record, not a hash
manifest for the subsequently modified implementation. Existing Git history
preserves that source closure. [VERIFICATION.md](VERIFICATION.md) records current
checks; [REMOTE_DEBUG_REFERENCE.md](REMOTE_DEBUG_REFERENCE.md) describes the bench
contract.

The **Set up remote debug kit** chat retains ownership of live bench setup and
private assets. Coordinate operational changes with that owner. The protected
helper, verified unit-specific baseline and full vendor directory are now
provisioned as recorded above; preserve those assets and their evidence.
Physical candidate startup and screen/audio/control acceptance remain pending.
The hosted Site does not create or replace the protected session or baseline.
