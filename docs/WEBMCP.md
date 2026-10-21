# Native MCP App panel and browser tools

The installed FM1 plugin and native MCP App panel are the user's primary
interface. Site v6 is privately deployed with resource
`ui://fm1/device-panel-v6.html` and v1-v5 compatibility aliases. Native v6
rendering is accepted: a newly opened installed panel showed the actual FM1 on
COM10 and visibly applied Mint Light / Circuit Grid, reporting **Appearance
saved on this browser**.
During the earlier v5 check, the host loaded cached v4: its script was 14,957
characters, lacked `selectedWork` and `followJob`, and **Refresh** cleared
progress asynchronously. That cache finding is historical. The published and
tested
UI follows the exact original job through bounded, cancellable read-only
inspection; its **Refresh** updates metadata while preserving selected progress.

Current host-tool availability is limited despite active v6: native
**Refresh** fails with **MCP app cannot call tool outside its trusted tool scope:
open_fm1_library**, and a repeated assistant open returned **Unknown tool**.
The cause is unconfirmed and reopening is not a verified remedy. See
[issue #6](https://github.com/Keitark/fm-1-forge/issues/6). The local
Appearance controls remain usable; current metadata/progress calls depend on
restored host-tool availability.

The v6 Appearance controls were published on 2026-10-10 at 11:27 JST with MCP
enabled; native Mint Light / Circuit Grid rendering is verified. Server version
is
**2.2.0**, with unchanged SDK versions. The **Appearance**
expander adds 12 palettes and five patterns (60 combinations), custom RGB
background/accent colors and hex input, derived foreground/surface contrast,
and **Reset to FM1 Mint**. These controls use local preferences only, saved where
host `localStorage` is available; otherwise the visible status says the choice
applies to this panel only. They add no WebMCP tool or external, server or
hardware call. See the [Appearance guide](USER_GUIDE.md#appearance).

The [native Mint Light screenshot](images/fm1-native-appearance-mint-light.png)
records that installed-panel selection. Native custom background `#f8f4ee`,
accent `#007ca8` and Dots passed; Reset restored FM1 Mint / Solid. The previous
FM1 Mint / Circuit Grid selection was then restored, as shown in the
[final native screenshot](images/fm1-native-appearance-final.png), which exposes
all 12 choices. Native persistence after reopening and every palette combination
are not claimed; reload persistence remains synthetic-preview evidence.

Actual browser checks against an embedded mock host verified Mint Light /
Circuit Grid, Royal Violet / Scanlines, custom RGB / Dots, preset persistence
after reload, and reset to FM1 Mint. At a 420-pixel viewport, the iframe and
its scroll width were both 390 pixels, with no horizontal overflow. The
[Mint Light preview](images/fm1-appearance-mint-light-preview.png) and
[Royal Violet preview](images/fm1-appearance-violet-preview.png) are synthetic
embedded-host previews, not actual native bench evidence.

The user-confirmed NES switch completed on 2026-10-10 at 10:38 JST under job
`9067aa03ef7f4826b9f143722cb5635e`, with 96/96 sectors, full readback and serial
startup verified. Subsequent inventory reported COM10 in normal serial mode
and the protected session idle/unblocked. The
[saved switch response](evidence/fm1-nes-switch-20261010.json) retains the
authoritative result. Physical screen/audio/control acceptance remains pending
(`physical_acceptance:false`), and official MIDI/SysEx transfer is untested.
The earlier v4 UBOOT rendering, canceled review and offline plan are dated
evidence in [VERIFICATION.md](VERIFICATION.md).
The full website's WebMCP tools are an additional interface; native plugin use
requires no Chrome extension.

The top-level FM1 Site registers seven tools through
`document.modelContext.registerTool` when the in-app browser supports WebMCP.
They share the visible library's actions and state. Unsupported browsers keep
the ordinary controls. Registration uses an `AbortSignal` and is removed when
the page closes.

## Browser tool contract

Every input is an object with exactly the fields below; required fields,
unexpected fields, types, patterns, and enum values are checked before action.
`catalog_id` matches `^[a-z0-9][a-z0-9_-]{0,63}$`. Saved `request_id` and `job_id`
match `^[a-f0-9]{32}$`.

| Tool | Required input | Behavior |
|---|---|---|
| `view_fm1_library` | `{}` | Read saved library, catalog, connection, and requests. |
| `refresh_fm1_library` | `{}` | Refresh inventory and catalog metadata through the relay; no device I/O. |
| `plan_fm1_app` | `{catalog_id}` | Submit an offline plan and show its saved outcome. |
| `inspect_fm1_request` | `{request_id}` | Read the original request's saved delivery and job outcome. |
| `inspect_fm1_job` | `{job_id}` | Inspect the original bridge job and display its result; never resubmit it. |
| `start_fm1_switch_review` | `{catalog_id,entry_method}` | Open human review; `entry_method` is `auto`, `serial` or `already_uboot`. Automatic selection is rechecked locally before device operations. No device write is submitted. |
| `start_fm1_official_update_review` | `{}` | Review the pinned official Windows SysEx updater. No updater launch or firmware transfer is submitted. |

There is no WebMCP confirmation tool. Review returns package identity and
SHA-256 but never the approval nonce. Cancel or Escape clears the displayed
approval. Final confirmation requires a trusted click on the visible control,
the server's owner-bound one-use approval, and deliberate local switching
enablement. Official updater review uses a separate local capability and binds
the executable SHA-256. Its human confirmation opens the vendor tool; completion
remains in that tool. See [the relay contract](SITE_RELAY.md) for delivery, digest, expiry,
and uncertainty handling.

## Native panel and SDK migration

The iframe uses native MCP Apps, not the top-level WebMCP registry. The panel
contract sends
`ui/initialize`, receives host capabilities/context, then sends
`ui/notifications/initialized`. The host's initial library tool result renders
without a duplicate library request. If that result is absent, a bounded
fallback reads the library only when the host advertises `serverTools`.

New requests use host-proxied `tools/call` and require `serverTools`; an initial
result can still render without that capability. The iframe acknowledges
`ui/resource-teardown`, aborts its lifecycle, clears approval state, and rejects
pending requests. Page closure performs the same cleanup.

The Site pins **ext-apps 2.0.3** and official server SDK **2.3.1**.
The current resource is `ui://fm1/device-panel-v6.html`; v1-v5 aliases
serve the same current panel. The ten MCP tools include two app-only confirmation
tools. See [VERIFICATION.md](VERIFICATION.md) for dated deployment evidence.
The v6 release displays server version **2.2.0** and published source
`0ea345a93554ab5f65b5c2c38c77fa03a2d4e8d0`. Deployment
`appgdep_6ac9a27c4a388191a7656970d906f770` succeeded with MCP enabled and
environment revision 1. It passed **100 Site tests** (40 server, 52 UI, 4 SDK,
4 appearance engine), typechecking and production build.
Actual SDK Client 2.3.1 negotiated **2026-07-28** and legacy
**2025-11-25** protocols in memory. Both protocol variants verify the current
resource and compatibility reads with identical HTML, metadata and CSP.
The historical v5 release used `ui://fm1/device-panel-v5.html`, server version
2.1.1 and source `7c2a46dd4719db0b415a2645db65e5f7b1288a3d`; it passed
84 Site tests, but the native host check still loaded cached v4.
The historical v4 release used `ui://fm1/device-panel-v4.html` and passed
69 Site tests; its initial native acceptance remains in the verification guide.
The historical v3 release used `ui://fm1/device-panel-v3.html` and passed
45 Site tests; its dated acceptance remains in the verification guide.

The native v4 Codex panel rendered the black/mint UI; the v5 check loaded an
older cached resource as recorded above, and the later native v6 Appearance
check succeeded. The
published UI
preserves the original job ID across
metadata refresh and a lost confirmation reply. Automatic following uses only
`get_fm1_job` and `get_fm1_request`, checks the returned job identity, and stops
on terminal outcomes, cancellation, offline/error conditions or its inspection limit.
Teardown cancels pending reads, and a superseding inspection cannot display an
older job's late response. **Inspect job** resumes the saved original ID without
resubmitting a plan or switch. An earlier direct
deployed SDK Client probe using the relay service credential returned HTTP 401;
that probe did not verify remote modern-protocol negotiation.

## Historical verification recorded on 2026-10-09

The installed native plugin's open/status/catalog/job calls succeeded, and
Refresh worked in the actual native MCP App iframe. Live Site WebMCP Refresh
also worked through the local bridge/relay with switching disabled. Inventory
reported COM4 and CDC/audio interfaces; all six validated private packages were
blocked (`ready:false`) because no protected session or verified baseline was
configured. The tested MDX plan was delivered but its bridge job failed with
**Start a protected session on the laptop first**. No helper was created and
no device I/O occurred. These live results verify metadata transport and
prerequisite handling, not a successful plan or hardware acceptance.

After the v3 deployment, native Refresh succeeded and preserved the original
job ID in the recovery field. After restarting the relay with its existing
state, native **Inspect job** returned the same original MDX job with its
authoritative protected-session prerequisite failure. These checks establish
that release's native rendering and host-proxied calls without resubmitting the job.
Exact request IDs and deployment receipts are in
[VERIFICATION.md](VERIFICATION.md).

Earlier synthetic browser validation covered the complete six-tool contract:

In a supported in-app browser, all six tools were discovered and called with
valid input against the local HTTP synthetic relay. Library read/refresh,
offline planning, saved-request inspection, saved-job inspection, and staged
review updated the visible interface. The synthetic job showed 2 of 4 verified
sectors. Review returned the package digest without approval data; Cancel
closed the modal. Malformed input was rejected for all six tools. The actual
browser's Confirm control was not clicked. A local SQLite read after stopping
the fixture confirmed zero queued `switch_app` tasks; no device writes were
performed.

## Current contract checks (2026-10-10)

The current **52 formal UI tests** in `site/test/ui.test.mjs` passed. They cover initial
render without duplicate requests, initial render without `serverTools`,
fallback, teardown, registry abort, nonce-free review, untrusted confirmation
rejection, Cancel/Escape, one-use trusted confirmation, awaited job inspection,
malformed input rejection, and the native device-controls view with a detected
port and no duplicate refresh. Additional recovery checks preserve the job ID
through refresh and a lost confirmation reply, and select the exact job ID
for WebMCP inspection without resubmission. The trusted-click test is a VM fixture, not a
physical browser or hardware operation.
The v4 additions cover auto routing, official updater review, engine latches,
capability availability and preservation of the original official handoff ID.
The v5 additions cover automatic plan/switch progress, exact-ID recovery,
metadata Refresh preserving progress, failed/unknown outcomes, indeterminate
totals, offline and lost delivery, bounded follow loops, shared repeated
inspection, superseding results, teardown, identity mismatch and vendor
handoff without a transfer-completion claim.
The v6 additions cover appearance presets and patterns, custom colors, local
storage persistence and rejection fallback, reset, and isolated preference
changes; four separate engine tests cover color derivation and validation.

## Repeat the local fixture

Use a disposable local database and run from `site/` with the repository's
installed dependencies. Do not use a deployed Site or real bridge credentials.

1. In the ignored local `.dev.vars`, set this fixture-only value:

   ```dotenv
   FM1_RELAY_TOKEN=test-only-browser-fixture-token-0000
   ```

2. Apply the checked-in `drizzle/` migration to the disposable local `DB`
   binding using an ignored local Wrangler configuration. Start the Worker
   development preview on `http://127.0.0.1:3000` with that same database
   configuration. In the browser, complete the bundled local preview's mock
   sign-in at `http://127.0.0.1:3000/signin-with-chatgpt?return_to=/`. This is the
   local test identity flow; hosted identity continues to come from Sites.
3. In another terminal, start the fixture:

   ```powershell
   node test/browser-fixture.mjs http://127.0.0.1:3000
   ```

4. Open the local URL in an in-app browser that exposes WebMCP. Discover the seven
   tools, exercise the valid and malformed cases above, and read back the UI
   state. Use the synthetic `nes-test` package for planning/review and Cancel
   the review. Stop the fixture and local Worker afterward.
5. Run the formal UI checks separately:

   ```powershell
   node --test test/ui.test.mjs
   ```

The fixture accepts only the literal loopback origin on port 3000, imports no
bridge or device backend, and returns synthetic metadata. These results do
not establish actual native resource rendering, remote modern negotiation, or hardware
write/readback/startup, sound, screen, keys, or physical acceptance. Live native
plugin rendering and metadata relay evidence are recorded separately above
and in [VERIFICATION.md](VERIFICATION.md).
