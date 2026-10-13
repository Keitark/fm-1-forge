# FM1 Forge native extensions

Forge 3.1.4 uses the official OpenAI MCP Extensions TypeScript SDK on both the
hosted MCP server and the native MCP App. ChatGPT Sites still hosts the server
and UI. The local relay continues to connect saved requests to the FM1 bridge.
Browser WebMCP is a separate interface and does not discover the native panel.

The panel build freezes its browser runtime strings before production server
minification. Changes to those source runtimes require `npm run build:panel`;
contract tests reject stale generated strings and execute the minified UI.
The canonical source UI resource is `ui://fm1/forge-panel-v14.html`, with prior
resource aliases retained.

## Official SDK source

The exact unmodified SDK is version 0.2.0 at OpenAI revision
`0d606217705e0e71eb21fff009619b67b80611dc`. On 2026-10-11 npm still published
0.1.0; the checked-in package is built from the current official source.
[Package provenance](../site/vendor/openai-mcp-extensions.ORIGIN.md) records the
license, build procedure and hash. MCP Server 2.3.1, MCP Apps 1.7.5 and MCP SDK
1.29.0 satisfy its peer ranges. No forced dependency overrides are used.

## Extension surfaces

| Surface | Forge behavior |
| --- | --- |
| Global sidebar | Open Forge, with a quick action for configuration setup. |
| Conversation panel | Open the native Forge interface alongside the chat. |
| Plugin settings | Persist owner-specific appearance, transfer-route preference and project defaults. |
| Project files | View and edit `.fm1-forge.json` through host-managed resources. |
| Display modes | Support inline/fullscreen presentation when the host permits it. |
| Deep links | Navigate to project, catalog, job and supported panel sections. |
| Model context | Attach a reviewed configuration, restore it on remount, and clear it explicitly. |
| Messages | Send to the active/new conversation or prepare an editable draft. |
| Local files | Open a real user-selected file through the host's file API. |
| Composer mentions | Find and reference the owner's saved project, package and job resources. |
| Extended forms | Configure a firmware draft with native choices and validated MRTR continuation. |
| Onboarding | Run the packaged Forge setup skill after installation. |

The current SDK specification is
[OpenAI MCP Extensions](https://github.com/openai/mcp-extensions/blob/0d606217705e0e71eb21fff009619b67b80611dc/docs/spec.md).
Host/platform availability is independent of server implementation. The panel
checks advertised capabilities and keeps manual alternatives when needed.
An unsupported draft action never falls back to immediately sending a message.

## Conversation tabs and icons

For Forge beside an existing Codex chat, use **Side-panel New Tab (+) → More
tools… → Plugins and MCPs → FM1 Forge**. This selects the native thread
entrypoint. The global shortcut opens its own app view and conversation
instance. Expanding a model-generated app card uses another host rendering
route; its tab icon may be supplied by Codex rather than the tool's icons.

Forge 3.1.4 supplies a separate FM1 tab outline with an LCD, knobs, pads and
keys. Its transparent interior preserves these features when Codex masks the
icon. Light and dark 128×128 PNGs are advertised on opening tools, quick actions
and server metadata; matching packaged composer/logo assets use the same mark.
The original detailed panel-header artwork and favicon are retained. Codex
controls the native tab tint. A favicon change alone cannot change that icon.

On local Codex App entrypoints, the host reads the connected service's exported
entrypoint icons, rather than the live tool or server icons. These exports inherit
the opening tool's title and icons at discovery; the official SDK's thread
entrypoint accepts only `type: "thread"`. Adding unsupported icon fields to that
descriptor does not repair stale exports. Publishing the Site or the standalone
plugin package is separate from refreshing the service's registered metadata.

Tool definitions and exported entrypoint metadata may lag the live HTML. The
new icon must be checked in a fresh native tab; initial settings from the opening
snapshot do not prove that a later settings RPC completed. An unavailable tool
scope requires refreshing the existing connection metadata, not weakening
permissions or recreating the plugin.

## Connection freshness

The current source panel is `ui://fm1/forge-panel-v14.html`; older resource aliases
remain served for installed descriptors. OpenAI treats UI resource URIs as cache
keys. A host with old registered descriptors may require refreshing the existing
connection metadata before a newly opened panel selects v14. Reopening alone does
not prove that updated scripts loaded. See [OpenAI UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui).

Forge paints its selected background and pattern on an app-owned full-viewport
shell. Native hosts may make the document canvas transparent; headings, controls,
gaps and footer remain on the Forge surface. Host chrome retains the Codex theme.

Normal Forge panels refresh passive inventory while visible,
share one unresolved status request, and check immediately on return or network
recovery. Hidden panels pause network checks; closing the panel cancels timers
and subscriptions. File and native-form entrypoints do not start device polling.
The monitor preserves selected packages, project edits, approvals and saved-job
progress, and does not fetch the package catalog every five seconds.

`relay.connected` describes the local service heartbeat, not FM1 presence.
`inventory_status` reports freshness separately, with a 15-second maximum age.
Successful status results receive a Site-controlled receipt timestamp; freshness
also considers original request creation, so journaled results first delivered
after an outage cannot become current simply by arriving late. Failed/unknown
newer observations invalidate an older success. Legacy results without a receipt
timestamp remain saved history. RPC failures show unavailable/stale status, not
proof that the physical device was unplugged. Automatic routing and official
updater and stock SysEx review require fresh inventory; confirmation and device-side checks
remain necessary.

## Stock SysEx and local JavaScript

The MCP App UI executes JavaScript in its host sandbox. Stock firmware transfer
uses a separate local Node 22 worker with `@julusian/midi` 3.8.1; JavaScript in
the rendered panel does not itself acquire the Windows MIDI/USB driver path.
Python continues to serve the authenticated bridge/relay and existing protected
serial/UBOOT workflow for custom firmware.

`prepare_fm1_stock_update` stages the locally pinned official V15 package and
fresh exact indexed MIDI pair. `confirm_fm1_stock_update` is app-only, consumes
the displayed one-use approval and queues the original durable job ID. Remote
arguments cannot supply paths, executable names, MIDI bytes or a package URL.
The relay's independent `allow_stock_update` capability defaults disabled.
Local configuration selects the Node binary and V15 package; the worker
revalidates the fixed size/hash and model handshake before transfer.
New-update readiness requires normal `sysex` mode. Already-OTA inventory
disables new review and directs recovery to the original local attempt;
explicit CLI resume is separate and retains the original journal identity.

Passive status enumeration never opens MIDI endpoints or sends identity queries.
The worker's `probe` operation means enumeration only and reports
`identity_verified:false`. Active transfer reports compact phase/progress metadata
and restores its original ID when the panel reopens; a lost response never causes
resubmission. Successful stock transfer reports `transfer_finished:true`,
`boot_identity_verified:true` and `readback_verified:false`. It invalidates the
protected baseline and cached diagnostics proof; unknown outcomes block later
writes. The vendor M-UPGRADE GUI review/handoff remains a separate compatibility
flow and cannot consume a stock approval.

The everyday panel opens the module graph, collapses the optional 01–04 guide,
and omits request-history tables and manual job-ID inspection. New projects
preserve `sdk-default`, measured at 360 MHz on the tested unit, with a read-only
CPU summary. Legacy `sdk-320` drafts retain their configuration; no new 320 MHz
selection is offered. Schema v3 adds optional 256×240 YUY2 / 5 fps UVC using the
physically confirmed ProTracker transport. Earlier v1/v2 drafts import with UVC
disabled, and the new Forge firmware combination remains unflashed pending its
own capture test.

## Drafts and file editing

A saved configuration draft is owner-scoped design data. It is not a local
project directory, compiled firmware or a completed device transfer. Keep the
existing diagnostic proof gate before requesting the normal firmware project
handoff. The protected transfer still reviews an exact package digest and
requires human confirmation separately.

File handlers receive an opaque resource URI. Only the opened resource can be
saved, only when the host marks it writable, and only after an explicit Save.
ETags detect stale content; conflicts and external updates retain unsaved text.
Subscriptions are cleaned up on file changes and panel teardown. Configuration
data is validated and rendered as text, never executed.

Native settings and saved drafts persist per owner in D1. Settings updates
merge only the supplied allowed fields. Composer search returns readable
resources rather than private credentials or local filesystem paths.

## Native forms and chat handoff

Modern forms use MCP 2026-07-28 multi-round-trip requests with both required
elicitation capabilities. The keyed response is validated again on acceptance;
declined/canceled forms do not save a draft. Older negotiated connections may
use the official legacy form API. Hosts without either form capability retain
the panel's configuration controls.

Attaching context replaces this panel's prior context. Sending and drafting
are explicit user actions, and neither approves a firmware write. Deep links
only select a view. File opening uses a real local path selected by the user,
never a fabricated path derived from a cloud project ID.

## Verification

The target suites exercise the real official SDK on modern and legacy MCP
transports, owner isolation, durable settings/drafts/resources, form
continuations, native message/context/file capability checks, conflict handling
and teardown. Deployment and actual native-host evidence are recorded in
[VERIFICATION.md](VERIFICATION.md). Some host surfaces require user interaction
and platform support; passing a mocked host test is reported separately from
a successful action in Codex. No extension test authorizes or performs a
firmware flash.

The panel no longer mounts a Hardware activity dashboard or submits input
sampling requests. Passive `get_fm1_status` refreshes keep the last confirmed
label and show a small blinking circle. Freshness still gates firmware actions;
new confirmed observations update the label. The read-only telemetry API
remains available to explicit tool calls independently of the panel.
