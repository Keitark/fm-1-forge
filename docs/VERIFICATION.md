# Integration verification

## Drag-and-drop module graph, 2026-10-12

The current Site resource is `ui://fm1/forge-panel-v6.html`; v5 and all earlier
aliases remain available. The existing installed plugin package stays 3.1.3.
USB, HAL, User module and Tweaks are real drop targets. Optional modules return
to the shelf; Add/Remove/Replace buttons and HAL checkboxes provide keyboard
alternatives. CDC and UBOOT helper stay enabled. All five user HAL access flags
default true. Schema v2 is shared by export, prompt, saved drafts, native forms,
files and context; strict legacy v1 imports acquire all-enabled flags.

All **230 Site tests** passed, with the final two UI regressions rerun after
review corrections; TypeScript checking and production build passed. Coverage
includes every HAL toggle, wrong-section/protected-module drops, native
roundtrips and legacy migration, pending old forms, dirty-file preservation,
refresh preservation, required clock opt-in and preserving a 30 MHz LCD preset
when its existing module is dropped back into Tweaks. No dependencies changed.

Browser QA performed actual pointer drags to remove/restore a HAL and replace
diagnostics with a user starter, verifying the emitted JSON. Actual shelf-to-
Tweaks drag acceptance is not claimed: several automated gestures ended without
a drop; its Add button and the same drop controller pass their checks. The
760 px panel-width preview had no horizontal overflow. A fresh published native
MCP App loaded the graph, schema v2 and opaque black background. Native Add/
Remove/Replace and checkbox actions changed the real configuration for HAL,
user module and Fast LCD; defaults were restored without saving a draft or
sending a chat/build/transfer request. Screenshot:
`F:\dev\fm1\tmp\fm1-forge-native-module-graph.png`. The existing thread tab
can retain older HTML and needs reopening; this acceptance covers the newly
opened model-tool native MCP App.

Pushed Site source `eedf0f98d4961ab5d5dda995782af5a9bb5ceecd` deployed privately
with MCP enabled and environment revision 1; terminal status **succeeded**.
Deployment `appgdep_6acc55eac76c8191a74e7a20daec05d1`; saved version
`appgprj_6ac85b74d57c81918be6c3db6e09efdb~appgver_2be8c7e4aac48191b5f4d7d03d5a261c`.
Archive SHA256:
`5c14f3e42744fdf35a6636759cf73c45790b06534f5797b43a5ec51c637a4381`.

Firmware implementation and offline build/ELF/source-closure evidence are in
Keitark/fm1-tracker, `docs/FM1_FORGE_GRAPH_HAL_20261012.md`. Selections govern
trusted user callback/input access; fixed diagnostics, recovery, UAC mixing
and physical master gain continue. Physical hardware acceptance remains pending.
No helper elevation, official updater or device write occurred.


## Native background contrast correction, 2026-10-12

The user-provided native thread-panel screenshot showed white host background
behind dark-palette headings, summary, Refresh button and gaps. The loaded
native document uses `backgroundMode=transparent`; the app previously relied
on body/canvas painting while cards had their own opaque backgrounds.

`#fm1-shell` now owns the full-width, minimum-viewport-height opaque background
for header, main, gaps, footer and dialog. Palette variables still inherit from
body; all non-solid pattern rules paint the shell. Host styling, safe-area
padding, selected appearance, drafts and confirmation gates remain intact.
The canonical resource is v5; v4 and all earlier aliases remain served. This is
a Site UI correction; the installed plugin package stays at 3.1.3.

All 212 Site tests, TypeScript checking and the production build passed. Actual
browser QA used a white outer iframe with html/body forced transparent via
`!important`: the shell remained opaque and covered viewport width/height.
Heading, summary, Refresh and footer were measured across all 13 palettes;
their minimum actual text contrast was 5.76:1. All five patterns painted the
shell as selected. Reset returned to Forge Black/Solid.

Pushed Site source `931c1a0977c89ceb6870f59cb91277896d05e414` deployed privately
with MCP enabled, environment revision 1, terminal status **succeeded**:
deployment `appgdep_6acc4e4f2c3c81919566b0bf3fbe0ea1`, saved version
`appgprj_6ac85b74d57c81918be6c3db6e09efdb~appgver_b5d54beaea508191b694f5b2db360b59`.
Archive SHA256:
`08ba5328d8729db639b3ca159fe272c93e9c0c781eddfaa12d013afc9d654d04`.

A newly opened model-tool native MCP App loaded `#fm1-shell` in Codex with
`data-host-theme:light` and Forge Black/Solid selected. Its computed background
was opaque `rgb(0,0,0)`; width equaled the 966 px viewport and content height
3354 px exceeded the 1143 px viewport. Heading and summary used the expected
light/muted Forge foregrounds, and footer remained within the shell. Screenshot:
`F:\dev\fm1\tmp\fm1-forge-native-owned-background.png`. The previously opened
native thread tab still contains older HTML and needs reopening. This check
covers the model-tool native MCP App route; no Codex theme setting was changed.

## Native timer correction 3.1.3, 2026-10-12

The first actual 3.1.2 MCP App opening displayed **Illegal invocation** and
did not start polling. The default injected clock invoked unbound browser
timers as methods of a plain clock object; the native Window receiver check
rejected that call. This was a real host failure despite the passing VM suite,
and native acceptance for 3.1.2 is not claimed.

Version 3.1.3 wraps calls through `globalThis.setTimeout/clearTimeout`, preserving
the browser receiver. A regression executes the injected browser runtime with
receiver-sensitive timers and covers polling, pending IDs, pause/wake and
teardown. The freshness and passive-transfer boundaries remain unchanged.

The installed plugin cache updated to 3.1.3, but a newly opened MCP App still
contained the 3.1.2 SDK version and old unbound timer runtime, and displayed
**Illegal invocation**. This proves stale native resource content; it does not
establish a failure of the corrected 3.1.3 runtime. The canonical resource moved
to `ui://fm1/forge-panel-v4.html`, with all three UI-bound descriptors updated
and the v3 alias retained. Both protocol-era SDK tests check this exact binding
and identical content through every old alias. OpenAI documents the resource URI
as a cache key; refreshing registered host metadata may still be necessary.

Final v4-source checks passed: all 212 Site tests, TypeScript checking and the
production build. Source commit `56f85d9c71e2facf584465422898defc36047f7b` was
pushed and deployed privately with MCP enabled: deployment
`appgdep_6acc4b432ba08191a6f6bfc479a1b882`, saved version
`appgprj_6ac85b74d57c81918be6c3db6e09efdb~appgver_d8557cfb41108191a45a749fcaf5ab6b`,
terminal state **succeeded**, environment revision 1. Archive SHA256:
`c350868e026594630daa2896bd84de0a15ed7304a65f39d14278276c856707c2`.
The same private plugin ID `plugins_6ac9ad3fc1c8819195580a4747c50052` was updated
in place to 3.1.3, release `pluginrel_6acc48baecc081919db4c7acf69b9f70`; the
installed local cache is 3.1.3. Only the two existing manifest version fields
changed in the account package. Plugin overlay ZIP SHA256:
`35966ffbcc21ed9e32ceffcd321f227615cd5fcc4f460f5c5801749bfe16515e`.

After the final deployment, a newly opened `open_fm1_library` MCP App in Codex
loaded the 3.1.3 SDK script and the `globalThis.setTimeout` runtime. Without
clicking Refresh, its heading changed from unavailable to **FM1 disconnected**.
Two later DOM observations showed **Checked 13s ago**, then **Checked 12s ago**
with the same disconnected heading and no error, demonstrating a later automatic
observation rather than a frozen opening snapshot. The app document was visible.
Screenshot: `F:\dev\fm1\tmp\fm1-forge-3.1.3-auto-disconnected.png`.
This acceptance is for the model-opened native MCP App route; the separate
New Tab native thread entrypoint and its icon still need user confirmation.

## Automatic connection refresh 3.1.2, 2026-10-12

The opening panel consumed saved inventory without an automatic status request.
A fresh relay heartbeat was incorrectly enough to display cached COM ports as
current. A passive live check at the start of this correction, request
`8f535a1dc6c14baba97c8db6e26ff9cc`, completed with no serial ports, MIDI endpoints
or UBOOT disks and `update_mode.mode:disconnected`. It performed no device I/O.

Normal panels now check passive device inventory on a five-second visible
schedule, shortly after opening and on visibility/focus/network recovery.
Hidden/offline panels pause checks and teardown clears timers and listeners.
One unresolved status ID is reused across ticks and manual refresh; the server
also coalesces concurrent panels per owner. Background refresh only renders
connection fields and availability, preserving package selection, open approval,
project/appearance edits and selected job progress. File/form-only entrypoints
do not start polling.

The server adds an explicit 15-second freshness contract. Receipt timestamps
cannot be supplied by the caller or renewed by duplicate ACKs. Original request
age bounds delayed relay journal delivery; cached initial/tool payloads also
expire by both server age and elapsed/wall time in the panel. New failed/unknown
observations invalidate older success. Enumeration failures and RPC timeouts
show unavailable/stale status rather than physical disconnection. Old ports
remain only as clearly labeled last-seen history. No D1 schema, relay setup,
permissions or hardware transport changes were needed.

Validation: **211 final Site tests passed**, with zero failures/skips; TypeScript
checking and the final production build passed. Focused tests cover COM10
disconnection/reconnection, delayed/cached observations, enumeration failure,
owner isolation, duplicate ACKs, multiple panels, pending request reuse,
manual/automatic overlap, visibility/offline/teardown and preservation of
drafts, themes, package variants, approvals and saved progress. Offline backend
safety tests confirm passive inventory opens no device transport or helper.
Logs: `F:/dev/fm1/tmp/fm1-forge-autorefresh-3.1.2-tests.tap`,
`F:/dev/fm1/tmp/fm1-forge-autorefresh-3.1.2-typecheck.log`, and
`F:/dev/fm1/tmp/fm1-forge-autorefresh-3.1.2-build.log`.

Private Site source `014d98e65b6db8e36bc46623e41f5570b950043f` deployed as
`appgdep_6acc466e05c88191b89cd6befa5089e8`, succeeded with MCP enabled and
environment revision 1. Its saved version is
`appgprj_6ac85b74d57c81918be6c3db6e09efdb~appgver_6fe7c835c63081919530000f67c92017`.
Site archive SHA256:
`71f30676bb1b82321156638738c1bd8a2563e288f8b829d0cb62c1476064e111`.

The same private plugin was updated to **3.1.2**, release
`pluginrel_6acc4699b57481919edaab8351426ddc`. Readback verifies both manifest
versions and every other field is unchanged. The two-file manifest overlay
SHA256 is `23464a5ba55b5db6870875d0e89349ecf0f9cc238d7d9de89bb8bc0553cc27f2`.
Post-deployment passive request `5954313f4aec405182328604af3ac0bb` succeeded
with no device interfaces. A subsequent saved snapshot aged correctly to
`inventory_status.state:stale` after 21 seconds despite a connected relay.

The already loaded native tab needs reopening once to load the new code.
Actual native automatic polling acceptance is recorded separately from the
passing VM tests and live server checks; at publication it remains pending
that reopen. The earlier settings trusted-tool scope and native tab icon are
separate outstanding checks. No physical unplug/replug was requested for
this release, and no firmware transfer was performed.

## FM1 Forge native panel patch 3.1.1, 2026-10-12

The ProTracker width was caused by `.card:last-child` spanning `1/-1` across
both library columns. The obsolete desktop span/min-height and mobile reset
were removed. Before the fix, the original native panel measured **777 px**
for ProTracker and **380.5 px** for the other cards. After publication, all six
cards measured **309.5 px** at the newly opened panel's narrower viewport,
with `grid-column:auto` for each. This is actual native DOM geometry.

The first layout-only private deployment
`appgdep_6acc34fad34c8191bea825ee3956cf79` succeeded with MCP enabled from
source `f3a7772a1b44f6d717a72beac251626efe57054d`. Its archive SHA256 is
`28eeb9f4e6eb7ee734d624b332fe4f0ebd5e2272961cea23290399eba35687a7`.
The 90 affected UI/extension UI tests, TypeScript and production build passed.

The subsequent icon patch uses the existing **128×128 PNG only** in opening
tool, server, form and mention icon metadata. The SVG constant, HTML artwork,
favicon and packaged composer/logo assets remain intact. The Codex host selects
the largest declared icon, so the previous SVG `sizes:["any"]` took precedence
over PNG. Its native tab mask loads that image through `Image.decode()`;
decode/render failure falls back to the generic icon. No explicit SVG rejection
was found, so the precise cause remains SVG rendering or stale/null exported
entrypoint metadata. The PNG-only change is a bounded compatibility correction.
Codex owns monochrome tab tint; black/mint colour is not promised in tab chrome.

Private Site source `eed95fc4fb986a13e33316bb5e75ea221feb1f33` deployed as
`appgdep_6acc3a966d3c8191b5c7f17aab7ed6ca`, succeeded with MCP enabled and
environment revision 1. Its saved version is
`appgprj_6ac85b74d57c81918be6c3db6e09efdb~appgver_011863a3d1c48191809829be83195f1e`.
The archive SHA256 is
`c9282f862981da0c7336cbbe08ca9f4863d2368cff9e0a84404b91d1915199a0`.
All **171 final Site tests**, TypeScript checking and production build passed.
The SDK remains the same official 0.2.0 package; no dependency/runtime change.

The same private plugin ID was updated to account release **3.1.1**,
`pluginrel_6acc3b8aace4819196d12adb15208a46`. Readback confirms both versions
and preserves every other manifest field. The version-only manifest overlay
archive SHA256 is
`03f95e39367e140540eeea7be682c880c53bd449c2a0320d28cf961bac1b7b99`.
Installed cache synchronization and the new native icon are checked separately
from successful account publication.

The user confirmed that the global shortcut leaves the app view when returning
to this original chat. Opening **Side-panel New Tab → More tools… → Plugins
and MCPs → FM1 Forge** then stayed beside the chat, but still showed a generic
icon before the PNG patch. Its native tab title was **FM1 device panel** rather
than the current advertised title. The user was asked to reopen that native
conversation tab after the patch; final icon acceptance remains pending.

A settled settings reload in the native conversation tab returned
`MCP app cannot call tool outside its trusted tool scope: settings.read`
(code `-32000`). The earlier immediate **Owner defaults loaded** label came
from the initial snapshot and was not proof of RPC completion; this was
corrected explicitly. Refresh of the trusted connection/catalog remains
outstanding. No new tool-scope acceptance, native forms or file-editor acceptance
is claimed from rendering the new panel alone. No hardware transfer, updater
launch or protected-helper elevation occurred.

## FM1 Forge official SDK release 3.1.0, 2026-10-11

The owner-private Site source `010f44ac2e2baac5495a5afcdf6ce08ec8869d69`
was pushed and packaged from the validated build. Private deployment
`appgdep_6acb96d71d4c81919523e3309a7aa184` succeeded with MCP enabled and
environment revision 1. Its saved version is
`appgprj_6ac85b74d57c81918be6c3db6e09efdb~appgver_55ee6bb025008191a6f805b9fa3213f2`.
The Site archive SHA256 is
`b0bae1aba3c0d3859b92a3ddd0afe196e6130f27ca8ff9cdfbb6e1eddbfe42c2`.

The existing private plugin `plugins_6ac9ad3fc1c8819195580a4747c50052`
was updated to **3.1.0**, release
`pluginrel_6acb96f97b648191bda9f413986e1d6f`. Account readback and the local
installed cache both confirm 3.1.0. The setup skill exists and is referenced
through `extensions.com.openai.onboardingSkill`; the account normalizer mirrors
this reference into the compatibility manifest. Original presentation,
default prompt, account attribution, MCP connection and assets remain intact.
No plugin was deleted, recreated or uninstalled.

The unmodified official OpenAI MCP Extensions SDK is **0.2.0**, source
`0d606217705e0e71eb21fff009619b67b80611dc`; npm still supplied 0.1.0 when checked.
The vendored package SHA256 is
`79a1cc9e6832f557ea9f46c8925fdbeb82ba80247a60824666b14cf90cf1b755`.
See [provenance](../site/vendor/openai-mcp-extensions.ORIGIN.md) for packaging
and the upstream declaration-export correction. No SDK runtime was modified.

| Check | Result |
| --- | --- |
| Upstream official SDK | 41 tests passed |
| Final Site suites | 171 tests passed; none skipped |
| TypeScript and production build | Passed |
| Backend, relay, recovery and updater integration | 190 Python tests passed |
| Browser store | 10 JavaScript tests passed |
| Real SDK modern/legacy discovery | In-memory transports pass; 18 tools, settings and mentions advertised |
| Private Site deployment | Succeeded; MCP enabled |
| Account release and installed cache | 3.1.0, same private plugin identity |
| Native panel rendering | Forge v3 controls, COM10, connected relay; HTML/body both black |
| Native model context | Attach and clear both succeeded; original draft retained |
| Native local file opening | Host opened the existing extension guide |
| New server tools in this chat's native panel | Host rejected `settings.read` as outside its trusted tool scope |
| Other native entrypoints, forms, mentions and file editing | Implemented and tested; end-to-end host acceptance remains pending metadata refresh/platform support |
| Real send/new-chat/draft actions | Capability and regression tests passed; no real message or new chat submitted |
| Hardware transfer/qualification | Not performed by this release |

The native panel's settings initially load from the opening tool's server
snapshot. That proves storage and rendering, but not a subsequent settings RPC:
**Reload defaults** produced `MCP app cannot call tool outside its trusted tool
scope: settings.read`. This turn's available connector catalog still contains
the earlier FM1 tool set. Inspection of the installed Codex host implementation
locates this exact rejection in its trusted connector/target catalog lookup,
before a server call; it does not inspect `_meta.ui.visibility` there. The
official specification already defaults omitted visibility to model and app.
Stale discovery is a supported explanation, not a confirmed refresh outcome.

The [official connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)
documents refreshing directly connected custom MCP metadata and rerunning
affected tests in a new conversation. Its
[review guide](https://developers.openai.com/plugins/deploy/app-review)
also distinguishes newly approved tools from live/cached UI resources. No
permission was broadened or host restriction bypassed. The user was asked to
refresh the existing connection; that final native acceptance is outstanding.
The [actual native screenshot](evidence/fm1-forge-native-3.1.0-20261011.jpg)
shows the new black panel controls and the host's settings-tool rejection.
An authenticated direct SDK probe also received an HTTP authentication
rejection, so it does not establish live modern-protocol discovery acceptance.

The canonical resource is `ui://fm1/forge-panel-v3.html`, with previous aliases
retained. Configuration drafts, settings and mention resources are owner-scoped
in D1. File writes require the exact opened opaque resource, advertised
writability and ETag, and preserve unsaved text on conflict. Tests include
cancelled forms, invalid data, no automatic relay calls when file/form results
open a panel, and rejection of a forged project gate without persisted proof.

Native status still reports no accepted diagnostic baseline and both relay
write flags disabled. No protected helper was elevated, no updater was launched
and no device was flashed. The previous unqualified diagnostics candidate and
physical LCD/input/audio/UAC/clock acceptance boundaries remain unchanged.

## FM1 Forge final release 3.0.1, 2026-10-11

Final Site source `3e97b09eaa41515deda1401cd46d42397ee479ed` deployed privately
as `appgdep_6acb15fa58908191bf74baadb8ab0b70`; deployment succeeded with MCP
enabled. Resource `ui://fm1/forge-panel-v2.html` retains the earlier aliases.
The same private plugin ID `plugins_6ac9ad3fc1c8819195580a4747c50052` was updated
to release `pluginrel_6acb15fe4ce88191bb211830c3425552`, version **3.0.1**.
The Site URL, `/mcp` endpoint and owner-private access remain unchanged.

| Final check | Result |
|---|---|
| Full final Site test suites | Passed |
| Site typechecking | Passed |
| Site production build | Passed |
| Integration test suite | 181 tests passed |
| Primary immutable-runtime suite | 51 tests run; five skipped |
| Primary backend suite | 35 tests passed |
| Private Site publication | Succeeded; MCP enabled |
| Private plugin update | Same ID; release 3.0.1 |
| Native Forge card | Verified in Codex: Forge branding/onboarding, diagnostic catalog, COM10 and black HTML/body background |
| New protected helper | Not started; runtime elevation canceled |
| Diagnostics transfer / candidate qualification | Not accepted; no firmware write occurred |
| Physical LCD, inputs, audio, USB and stability | Pending device tests |

The native panel defaults to opaque black/plain, retains optional appearances,
and separates fixed USB/system recovery, shared HAL and user modules. The
project configuration rejects unknown fields, unsafe folders and incompatible
presets. User text remains in text controls and host text messages. Tests cover
native messaging support/rejection, standalone copy fallback and retention of
the exact original job and uncertain transfer outcome while editing a project.
A DB-backed regression rotated 32 newer requests and retained the original
per-owner diagnostics proof, independent of the twelve visible recent requests.

Compiler evidence established the real setter as `system_clock_set`; `clk_set`
is a stub. The 320 MHz SDK table supplies a 53 MHz LSB, while the 15/30 MHz
RGB444 LCD presets require 60 MHz. The panel, Python validator and schema now
reject that combination. `sdk-320` with stock DMA and `sdk-default` with each
LCD preset remain selectable. Higher FPS and clock stability are not accepted
from compilation or offline tests.

The current native Forge card was subsequently inspected in Codex. Its DOM
contains diagnostic onboarding, module options and the exact diagnostic catalog;
the HTML and body backgrounds both compute to `rgb(0, 0, 0)`. FM1 is detected
on COM10 and transfer actions remain disabled. An actual native screenshot
confirmed the black cards and mint accents. This does not establish firmware
or physical hardware acceptance. The hosted service title was also renamed from
FM1 App Library to FM1 Forge, preserving its project, URL and private audience.
Runtime elevation was canceled, leaving no new protected helper and no writes.
Existing snapshots, receipts and saved job IDs are preserved. The diagnostics
baseline and physical tests remain separate prerequisites; no firmware
candidate or hardware qualification is claimed.

The local bridge and outbound relay were then restarted through their supported
launchers, with 53 completed/reported relay journals retained. Current bridge
PID is 154724 and relay PID is 209572. Both relay write permissions remain off;
catalog inventory recognizes all six profiles. These are metadata connections,
with no device operation requested. The old session's `stopped:false` field
reflects the absence of its stop marker; its recorded helper PID 240396 is dead.
The old verified baseline is usable for offline packaging, but that status field
alone does not establish an available protected helper.

The validated default diagnostic bundle was subsequently installed through the
authenticated local catalog endpoint as `factory-diag` / `diagnostics`, SHA256
`e52573f32d27a68e016d7aa36ac65ff254a6a8bada9c5f0fd70c4365f4f60a8c`.
Its 1 MiB container changes 53 application sectors (`0x4000` through `0x38000`,
directory written last) against rollback SHA256
`4d4da3ab34b643034ea91ddb670fd3556b737a05835ed77fced687eae6ad345c`.
The protected-worker pure candidate validator independently confirmed protected
boot/config/reserved bytes are identical. No device I/O or firmware write was
requested; catalog readiness establishes compatibility only.

## FM1 appearance update, 2026-10-10

Site v6 adds twelve prepared palettes and five independently selectable
patterns, plus custom background/accent RGB pickers and hexadecimal entry.
The palette engine derives readable foregrounds, surfaces, focus indicators and
button text. Preferences stay in local storage when supported; blocked storage
keeps the current panel usable and reports that the setting cannot be retained.
No appearance control calls MCP services or operates the device.

All **100 Site tests passed** (52 UI, 40 server, 4 SDK, 4 appearance engine).
These cover restored/custom/reset preferences, blocked/corrupt storage, input
validation, unchanged relay tasks, palette/custom contrast and resource aliases.
Typechecking and the production build passed. Source
`0ea345a93554ab5f65b5c2c38c77fa03a2d4e8d0` was pushed and packaged by the source
workflow. Private deployment `appgdep_6ac9a27c4a388191a7656970d906f770`
succeeded at **11:27 JST**, with MCP enabled and environment revision 1.
The server advertises `2.2.0`, resource `ui://fm1/device-panel-v6.html`, and
v1/v2/v3/v4/v5 aliases. Official SDK pins remain unchanged.

Browser QA used the actual UI in a local synthetic MCP host with device actions
disabled. It verified Mint Light/Circuit Grid, Royal Violet/Scanlines, custom
RGB/Dots, persistence after reload and reset. At a 420-pixel viewport the iframe
had equal client/scroll widths of 390 pixels, confirming no horizontal overflow.

The installed native Codex panel subsequently loaded **Appearance**, reporting
the actual FM1 on COM10. Selecting **Mint Light** and **Circuit Grid** changed
the visible UI and reported **Appearance saved on this browser**. The native
screenshot below records this selection. This resolves the earlier stale-v4
resource observation for the newly opened panel. Native custom hex colours
(`#f8f4ee` background, `#007ca8` accent) and Dots also applied, with the body
reporting custom/light and `rgb(248,244,238)`. Native reset restored FM1
Mint/Solid; the earlier FM1 Mint/Circuit Grid preference was then restored.
Persistence across reopening was verified in the synthetic host only.

A later read-only native Refresh failed with **MCP app cannot call tool outside
its trusted tool scope: open_fm1_library**. A second assistant library call had
returned **Unknown tool**, and FM1 tools are absent from the current tool
inventory. Sites still reports an active v6, no disabling authority and the
same MCP endpoint/plugin ID. Plugin metadata lookup returned 404. The cause
is unconfirmed; the loaded panel's local Appearance controls remain usable,
but current remote tool availability and native reopening are not accepted.
No firmware operation was attempted during this check. Follow-up is tracked in
[issue #6](https://github.com/Keitark/fm1-marketplace-plugin/issues/6).

![Installed native FM1 panel with Mint Light and Circuit Grid](images/fm1-native-appearance-mint-light.png)

![Installed native Appearance controls restored to FM1 Mint and Circuit Grid](images/fm1-native-appearance-final.png)

![Synthetic Royal Violet and Scanlines preview](images/fm1-appearance-violet-preview.png)

## Subsequent NES programming and progress correction, 2026-10-10

The saved switch job `9067aa03ef7f4826b9f143722cb5635e` completed at
10:38 JST. Installed-tool inspection request
`096c7f619cc44de69e1bc3c00d0f9d07` returned authoritative `status:succeeded`,
`result.ok:true`, 96/96 verified sectors, `write_complete:true`,
`full_readback_verified:true` and `boot_verified:true`. Its full-image readback
SHA-256 matches NES candidate
`4d4da3ab34b643034ea91ddb670fd3556b737a05835ed77fced687eae6ad345c`.
The retained [actual switch response](evidence/fm1-nes-switch-20261010.json)
distinguishes the physical write from the earlier offline plan. Startup evidence
is serial identification and advancing counters; `physical_acceptance:false`
and the display/audio/control bench boundary remain explicit.

Fresh status request `af69f2586c3647d89153631e511d6eee` reported normal serial
mode on COM10, an idle/unblocked protected session without a running loader or
pending reset, and two succeeded jobs alongside the three retained failed plans.
No write was repeated while inspecting or correcting the UI.

The previous UI stopped after delivery succeeded, leaving the submitted job's
queued snapshot on screen. The correction follows the exact saved bridge job
with read-only inspection until its authoritative terminal state. It preserves
progress during Refresh, cancels obsolete/teardown work, bounds polling, and
stops on delivery or connection uncertainty. Missing counts do not invent a
percentage. Plans, writes and confirmations are never automatically resubmitted.
All **84 Site tests passed** (40 server, 40 UI, 4 SDK), including 15 new progress
regressions and both protocol variants with v1/v2/v3/v4 resource compatibility.

Typechecking and the production build passed. The source workflow packaged
and pushed `7c2a46dd4719db0b415a2645db65e5f7b1288a3d`; private deployment
`appgdep_6ac99af9c4f08191b1207fe174a0fa88` succeeded at 10:56 JST with MCP enabled
and environment revision 1. Site v5 advertises server version `2.1.1` and
`ui://fm1/device-panel-v5.html`, retaining v1/v2/v3/v4 aliases. SDK pins remain
server `2.3.1` and ext-apps `2.0.3`.

The newly opened native panel still loaded the prior v4 application script:
14,957 characters without `selectedWork` or `followJob`, rather than v5's
18,502-character script containing both. A separate background check of the
live Site confirmed that it serves the new 18,502-character application script
with automatic tracking and the metadata-preservation guard. Native **Inspect job** displayed the
actual NES result and 96/96 sector bar, but the old UI hid it after metadata
Refresh completed. This accepts saved-job inspection, not the v5 automatic
progress loop in the live native host. Native v5 acceptance remains pending
resource-cache refresh. OpenAI documents [UI resources as cache keys](https://developers.openai.com/plugins/build/chatgpt-ui)
and [continuous tool review and resource caching](https://developers.openai.com/plugins/deploy/app-review);
ChatGPT may retain compatible resource contents for up to an hour. Reopening
alone did not bypass the cache in this observed Codex panel.

![Cached native panel displaying the actual completed NES job and sector bar](images/fm1-native-panel-cached-progress-20261010.png)

## Initial setup update, 2026-10-10

- 189 Python tests passed in 36.368 seconds; these include 62 relay tests,
  passive mode detection, route/identity revalidation, pinned updater handoff,
  and durable recovery with the original job ID.
- 10 store JavaScript tests and 69 Site tests passed (40 server, 25 UI, 4 SDK).
  The Site tests include native confirmation, engine latches, official approval
  digest/expiry/atomicity, automatic routes and v1/v2/v3 resource aliases.
- All three integration PowerShell launchers/clients parse. Typechecking and
  the production build passed with the pinned SDKs.
- Site v4 source `bd87d14a039b8ef5233a6b3c60291c3642ee7f98` was packaged by
  the source workflow and privately deployed as
  `appgdep_6ac9903cd9e08191b5df920575373d1e`; deployment succeeded with MCP enabled.
  The installed plugin's library read succeeded after deployment.
- The separately prepared protected helper passed its live frozen-runtime
  parent/child proof. Serial identified MDX Karaoke; a guarded UBOOT transition
  and two identical complete 1 MiB readbacks completed. No flash-array program
  or erase command was sent. The readback matches the MDX RayForce catalog image
  and differs from the historical seed baseline. The source protected receipt
  and both images are preserved. The stopped source was then migrated into a
  new protected frozen-runtime session; its fresh double-read baseline and
  original evidence remain separate, with the target identity guard retained.
  After the user's power cycle, the supported serial-to-UBOOT transition passed.
  The replacement helper is idle and unblocked, without a running RAM loader or
  pending reset. The bridge and relay now use this session and retain their
  existing credentials and saved job history.
- The actual native MCP App panel renders the black/mint v4 UI. Refresh returned
  `FM1 in UBOOT`, switching enabled, and all six packages ready. NES review
  selected `auto -> already_uboot`; it was cancelled without submitting a write.
  The official updater is configured, while its review control correctly says
  `Needs FM1 MIDI connection` in this UBOOT state.
- Native `View plan` created NES job `427b240eda7c4867b403aee8f8838682`.
  `Inspect job` reused that exact ID through request
  `ea27707a4bb04f428aef9d4729b21f1e`. Both the native panel and installed plugin
  request tool returned authoritative `status:succeeded`, `result.ok:true`,
  `device_io:false`, `blocked:false`, 96 planned sectors, and the reviewed
  package SHA-256
  `4d4da3ab34b643034ea91ddb670fd3556b737a05835ed77fced687eae6ad345c`.
  Write, full-readback and boot-verification progress remained false. This
  resolves the historical missing-session plan prerequisite without claiming
  firmware programming or physical startup acceptance.
  The installed tool's saved response is retained in
  [the native plan evidence](evidence/fm1-v4-native-plan-20261010.json).
- Integration GitHub CI passed both the offline bridge/store and Site contract
  build jobs on source checkpoint `123c492` (run `38012265242`). The separate
  runtime checkpoint `47a43f2` passed 99 focused tests, including the actual
  copied interpreter and named pipes. One absent private profile fixture was
  excluded, and the full private writer fixture suite was not run.
- Generic M-UPGRADE was downloaded from the manufacturer; its executable hash
  and external `.fwsc` chooser were checked statically with its full Qt closure.
  The official MIDI/SysEx transfer and physical write/startup acceptance remain
  untested on this device. GUI handoff is never treated as verified programming.

![Native v4 plugin, current UBOOT route and ready packages](images/fm1-native-panel-v4-live.png)

## Historical release, 2026-10-09

The checks below were recorded on 2026-10-09 using Python 3.11.0 and
Node.js v22.22.2 on Windows. Site version 3, that release's final offline suite,
and actual native-panel acceptance are recorded below. Earlier import and
version 2 observations remain historical evidence.
Offline checks started no live bridge,
relay, protected helper, USB device, or tunnel.

| Check | Result |
|---|---|
| Current `python -m unittest discover -s tools/jieli-wl82 -p 'test_*.py'` | 150 tests passed in 35.329 seconds |
| Latest focused `python -m unittest test_site_relay` from `tools/jieli-wl82/` | 51 tests passed in 6.578 seconds |
| `node --test tools/jieli-wl82/test_remote_store.cjs` | 10 tests passed |
| PowerShell syntax parsing | All 3 scripts passed: `flash-session-client.ps1`, `start-remote-bridge.ps1`, and `start-site-relay.ps1` |
| Current `node --test site/test/*.test.mjs` | 45 tests passed: 26 server/SQLite, 15 UI, and 4 SDK tests |
| Current `node node_modules/typescript/bin/tsc --noEmit` from `site/` | Passed for the current SDK implementation |
| Current production build via installed npm CLI and `npm run build` | Passed; version 3 Cloudflare Worker output generated |
| Actual SDK Client 2.3.1 in-memory transport | Modern `2026-07-28` and legacy `2025-11-25` negotiation passed |
| Earlier synthetic browser UI verification | Passed in Codex in-app browser against a local synthetic HTTP relay; historical disconnected screenshot below |
| Private Sites deployment | Version 3 succeeded, runtime revision 1; MCP-ready |
| Installed hosted plugin tools | Library, status, catalog, and saved-job calls succeeded through the installed plugin |
| Actual native MCP App iframe | Current black/mint panel rendered; Refresh and saved-job inspection succeeded and retained the original job ID |
| Top-level WebMCP | All 6 tools passed earlier valid/malformed synthetic cases; live Site Refresh succeeded through the metadata relay |
| Authenticated live bench relay round trip | Passed for inventory, catalog, plan prerequisite failure, and saved-job inspection; switching disabled |
| Pinned official server SDK 2.3.1 + ext-apps 2.0.3 | Tests/typecheck/build/deployment passed; current native Apps SDK render and host tool calls accepted |
| Direct deployed SDK Client probe with existing relay service credential | HTTP 401; remote modern-protocol negotiation was not accepted by this probe |
| Hardware write/readback/startup and physical acceptance | Pending; no protected session/helper or physical I/O was used |

Tests use mocked device operations, synthetic data, temporary state, and
loopback HTTP. The current 150-test aggregate includes 51 outbound relay
tests plus the bridge, backend, client, and progress tests. They verify strict task/origin
validation, distinct credentials, redirect and oversized/nonfinite JSON
rejection, metadata filtering, per-state process exclusion, durable task/batch
journaling, duplicate result handling, lost submission/result recovery, and
switch enablement/digest/expiry checks. An interrupted plan/switch uses only
the original bridge job ID on recovery; it never repeats the submission.

Bridge regression coverage verifies that exceptions in offline `plan`,
`plan_app`, and `environment` requests produce `failed`, including restart
handling, while uncertain device operations retain `unknown` and their
persistent device-operation block. Transport success does not replace an
authoritative bridge job's failed/unknown status.

The 10 local-store JavaScript tests verify accessible progress, authoritative
job outcome handling, incomplete readback/startup state, and network-loss
polling without resubmission. They are source-contract tests and do not prove
native panel rendering or real WebMCP discovery.

## Historical import evidence

At the original source-snapshot verification, 97 Python tests and 10
local-store JavaScript tests passed, all 14 imported files matched the recorded
hashes/sizes, both copied PowerShell scripts parsed, and the publication scan
found no embedded private inputs or credentials. `source-snapshot.json` is
that historical import record. It is not a current hash manifest for files
changed by this integration.

The protected writer/bootstrap, private packages, and vendor USB dependencies
remain outside this repository. Python bytecode generated during verification
is ignored by Git. Local SDK and deployment acceptance remain distinct from
remote modern-protocol acceptance and hardware
acceptance.

## Published Site and browser evidence

Owner-private Site: [FM1 App Library](https://fm1-app-library.keitark.chatgpt.site).
The initial successful native deployment was `appgdep_6ac86547ba848191bf7b1e4fb6adb1ce`,
with pushed Site source `599d6ef7a7586a24c14d66181e006603e3415b5c`. The native
connection metadata reports `/mcp` as its HTTP endpoint and OAuth resource.
The plugin was subsequently installed and its open/status/catalog/job tools
were verified. Refresh worked in the actual native MCP App iframe, and live
Site WebMCP Refresh worked through the authenticated metadata relay. These
results were initially recorded before the SDK migration. After v2 deployment,
the cached v1 panel continued to work through the new server, as recorded below. The
website and MCP metadata carry
the original black/mint FM-1 mark as SVG and lossless PNG.

The local browser fixture used `/relay/heartbeat`, `/relay/poll`, and
`/relay/result`, exercising the real Worker/D1 routes without importing a
bridge or device backend. Valid calls displayed synthetic catalog, plan and
saved-job progress. Switch review returned no approval nonce, Cancel closed
the dialog, and a local readback counted zero `switch_app` tasks. The VM tests
separately verify untrusted-click rejection and one-use trusted confirmation.
See [WEBMCP.md](WEBMCP.md) for the exact boundary and repeatable fixture.

The historical local screenshot uses an empty, disconnected database after fixture
cleanup. No test credentials, production relay token, or local mock identity
were embedded in the production Worker. Runtime secrets are held in Sites;
owner-only credential files remain outside Git. No live bench relay was
started during those fixture checks. The subsequent live metadata connection
is recorded separately below.

![Historical disconnected local library with FM-1 icon](images/fm1-library.jpg)

## Verified live metadata connection

The supported local bridge was observed as PID **134988** on loopback port
**9770**, launched without `SessionRoot` or an official updater. The relay was
observed as PID **411680**, with switching disabled. These process IDs are
dated observations; future operations must inspect the actual current process.
Inventory reported COM4 and CDC/audio interfaces. The catalog contained six
validated private packages, all `ready:false` because no verified protected
session/baseline was configured.

The MDX plan request and bridge job
`d984e14543204d1e93a966099cc708d7` had successful delivery and authoritative
bridge status `failed`, with **Start a protected session on the laptop first**.
Saved-job inspection used delivery request
`68060f826e704d2d8075321d4461577d` and confirmed that original outcome. No device
I/O or protected-helper creation occurred. A successful transport result is
not a successful plan or hardware operation.

The older snapshot worker is stopped and lacks the required remote-read
guard. The remote laptop is offline. Neither is current evidence of a usable
local protected session; no frozen helper was replaced or reactivated.

## Historical version 2 deployment and acceptance boundaries

Version **2** pins official server SDK **2.3.1** and native-panel **ext-apps
2.0.3**. Its **41 tests** (25 server, 12 UI, 4 SDK), type check, and production
build passed. Actual SDK Client 2.3.1 passed in-memory modern **2026-07-28** and
legacy **2025-11-25** protocol negotiation. The earlier 36-test Site result is
historical; the 41-test suite was that version's offline record. These client
tests do not establish remote modern negotiation.

Native deployment `appgdep_6ac8f089484881919b4e10b89ef4f608` succeeded as Site
version **2**, runtime revision **1**, with MCP-ready status. Source SHA:
`5d32bd0c023d4a3d7ef77fb454164844131a29d0`. The new UI resource is
`ui://fm1/device-panel-v2.html`.

After v2 deployment, the cached v1 native panel successfully refreshed
inventory with request `f5384b7e6f9e41e8b29073a3e93daed4` and catalog with
request `7cd30350d95d4cb6b780586043649cf6`. It still reported COM4 and six
blocked packages. Saved-job inspection delivery
`6767e0f9833d4826a480b12210aa09e0` preserved the original bridge job
`d984e14543204d1e93a966099cc708d7` and its `failed` protected-session prerequisite
outcome. No device I/O or protected session/helper creation occurred.

![Cached v1 native panel connected after v2 deployment](images/fm1-native-panel-v1-live.png)

During version 2 acceptance, newly opened panels retained **Choose what plays
next.** and the older tool title. Version 3 compatibility resources resolved
that stale UI; current rendering and host calls are recorded below.

A direct deployed SDK Client probe using the existing relay service credential
returned **HTTP 401**. It did not establish modern remote protocol negotiation.
No raw secrets or private physical identifiers were persisted. Physical
write/readback/startup, screen, audio, and controls remain unaccepted.

## Current version 3 deployment and native acceptance

Owner-private version **3** deployed successfully as
`appgdep_6ac8fc0660648191a2521acd37271e3c`, runtime revision **1**, MCP-ready.
Its pushed source is `0e76fa6923d74ca96f71312a77d033b4c4935723`.
The current descriptor uses `ui://fm1/device-panel-v3.html`; the earlier
`ui://fm1/app-library-v1.html` and `ui://fm1/device-panel-v2.html` also return
the current UI. Modern and legacy SDK tests verify identical content and CSP
for all three resources.

The actual Codex native MCP App now renders the black/mint **FM1 plugin**
panel with **FM1 on COM4**. This supersedes the earlier stale-rendering blocker.
The read-only app-server `app/installed` refresh reported FM1 installed,
enabled and callable; `app/list` refetch and `app/read` reported the new
**FM1 device panel** tool title. The existing native tab title still reflects
the older registration; compatibility resource reads made its UI current.
No plugin uninstall/reinstall or replacement app was used.

Native **Refresh** succeeded with status request
`f8fcd7c963f64b2caf8ee67aa89114a5` and catalog request
`3b61f8abdef742f6a7f9bd196819e821`, retaining the original bridge job ID in
the recovery field. The relay was then restarted from the updated source,
preserving its existing state/configuration/credential files, with switching
disabled. Its new observed PID is **422648**; bridge PID **134988** was not
restarted or reconfigured. No unfinished relay deliveries existed at the
restart check.

The updated relay delivered native saved-job inspection
`2e5b770a13ed49c69ba90f18bdca17ea`, preserving original bridge job
`d984e14543204d1e93a966099cc708d7` and its authoritative `failed` outcome:
**Start a protected session on the laptop first**. A further native Refresh
succeeded with status `7107aa1ea63c491ebdf8f2ce208f9fab` and catalog
`81b6d583e38c4c1cae5a8053ad488299`. The job ID remained unchanged, the
panel showed five app cards/six package variants, and no UI error appeared.

![Current native plugin panel with connected FM1 and preserved job ID](images/fm1-native-panel-v3-live.png)

Final offline checks passed **150 Python tests** (including **51 relay**),
**10 local-store JavaScript tests**, and **45 Site tests** (26 server, 15 UI,
4 SDK), plus typechecking and the production build. New coverage includes:

- Exact 65,536-byte request acceptance and 65,537-byte rejection for headerless
  multibyte JSON, without committing the rejected result.
- Metadata compaction that preserves authoritative outcome/progress and keeps
  later relay tasks moving under actual Site request/result limits.
- Legacy journals above 64 KiB, including already-reported records, startup,
  explicit size rejection and accepted-result ACK loss without another bridge POST.
- Immutable replay after timeout/conflict; only definite size rejection permits
  an atomically persisted compact replacement before retry.
- Saved job ID retention across refresh/inspection and confirmation reply loss,
  with inspection of the exact committed ID and no duplicate switch submission.

The protected session and verified unit-specific baseline remain external
bench prerequisites. All six packages remain `ready:false`; switching is
disabled. These checks performed no device I/O, helper creation, firmware
write, readback, reset or physical acceptance. Standalone remote modern
protocol negotiation remains unverified by the earlier service-token probe;
current native Apps SDK rendering and tool calls are verified separately.
