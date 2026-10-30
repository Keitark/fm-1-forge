# FM-1 Forge native extensions

The experimental common firmware MIDI controls are included in 3.3.0. Installation remains disabled in the normal firmware candidate pending physical loader/layout qualification. See [common update status and portability](COMMON_MIDI_20261018.md).

Forge 3.3.0 uses the official OpenAI MCP Extensions TypeScript SDK on the
hosted MCP server and native MCP App. ChatGPT Sites hosts the server and UI.
The default hardware path executes JavaScript in the panel through Web Serial
and Web MIDI; it uses no Python/Node helper, relay or Startup process. The
hosted MCP still supplies owner settings, configuration drafts and resources.
Browser WebMCP is a separate interface and does not discover the native panel.

The panel build freezes its browser runtime strings before production server
minification. Changes to those source runtimes require `npm run build:panel`;
contract tests reject stale generated strings and execute the minified UI.
The canonical source UI resource is `ui://fm1/forge-panel-v21.html`, with prior
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
| Plugin settings | Persist owner-specific appearance and project defaults; retained legacy transfer preferences do not drive direct device access. |
| Project files | View and edit `.fm1-forge.json` through host-managed resources. |
| Display modes | Support inline/fullscreen presentation when the host permits it. |
| Deep links | Navigate to projects, catalog and supported sections; legacy job resources remain compatibility data. |
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
tools… → Plugins and MCPs → FM-1 Forge**. This selects the native thread
entrypoint. The global shortcut opens its own app view and conversation
instance. Expanding a model-generated app card uses another host rendering
route; its tab icon may be supplied by Codex rather than the tool's icons.

Forge supplies a separate FM-1 tab outline with an LCD, knobs, pads and
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

## Direct connection and host permission

The current source panel is `ui://fm1/forge-panel-v21.html`; older resource aliases
remain served for installed descriptors. OpenAI treats UI resource URIs as cache
keys. A host with old registered descriptors may require refreshing the existing
connection metadata before a newly opened panel selects v20. Reopening alone does
not prove that updated scripts loaded. See [OpenAI UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui).

Forge paints its selected background and pattern on an app-owned full-viewport
shell. Native hosts may make the document canvas transparent; headings, controls,
gaps and footer remain on the Forge surface. Host chrome retains the Codex theme.

MCP Extensions settings/file/message capabilities do not themselves grant USB
or MIDI permission. The panel separately checks its secure context, actual API
presence and permissions policy. Device access begins only through a trusted
**Connect USB serial** or **Connect stock MIDI** action. Exposed APIs and passing
injected-host tests are separate from actual permission and device acceptance.

`BrowserSerial` requests only VID `3654` / PID `5155`, checks the selected USB
identity, opens 115200 baud and recognizes exact known HELLO profiles. The
existing CDC readiness gate requires one DTR assertion, with RTS false; there
are no reset pulses. Refresh sends only the selected firmware's read-only
status command. The API provides no arbitrary commands, STOP, UBOOT or custom
flash operation. Unknown firmware, malformed records and bounded read timeouts
close the connection.

Selected-device events update presence after a connection is authorized. No
device permission, open or automatic replacement occurs at startup or refresh.
The confirmed label stays steady while a small circle blinks; the full heading
does not become “Checking connection.” The panel does not mount Hardware
activity or submit input-sampling requests. Closing the panel releases its
serial connection and subscriptions. Stock MIDI refresh reads authorized
endpoint metadata rather than sending another identity query.

## Browser stock SysEx

The direct stock path is in `site/lib/browser-stock/`. Its JavaScript runs in
the panel and calls standard Web MIDI; no separate JavaScript runtime is
installed and no helper, Node module, MCP queue or local HTTP bridge performs
the transfer. **Connect stock MIDI** requests SysEx access under a trusted
gesture and exclusive Web Lock, selects an exact unique FM-1 pair and checks its
model identity. Generic USB Composite Device names are rejected because Web
MIDI does not provide trusted USB-interface correlation.

The user chooses an official V15 `.fwsc` File. WebCrypto validates the pinned
`FM-1_015` package: 699,956 bytes, SHA256
`db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a`.
Bytes stay inside the panel and are neither fetched nor uploaded by the updater.
The UI displays that digest, current identity and exact MIDI pair before a
second trusted **Install stock firmware** confirmation.

Writing requires strict IndexedDB durability and an exclusive cross-tab Web
Lock within the same browser origin/storage scope. The immutable reviewed
request and active phase commit before an UPGRADE send. Missing locks, storage
or durability blocks writing; there is no memory/localStorage fallback. The
storage report contains the actual origin and persisted UUID sentinel. Native
cross-tab/reopen acceptance must verify this real scope; a facade test cannot
prove the host's partitioning or retention.

An active or unknown journal record blocks a new update. Explicit recovery
requires the same original job/review IDs and package, with a fresh exact
`ota-FM-1` identity. Reopening, refreshing and endpoint events never resume or
retry a write. Successful protocol completion reports `transfer_finished:true`,
`boot_identity_verified:true` and `readback_verified:false` after confirming
`FM-1_015`. This is separate from physical LCD/sound/control acceptance and a
full flash readback. A prior custom-writer baseline must be re-established
before another custom write.

The current CFW exposes COM4 CDC without stock MIDI; the physical stock/SysEx
test remains pending. Actual native permissions, storage and device evidence
are recorded in [direct access](DIRECT_DEVICE_ACCESS_20261013.md) and
[stock update](STOCK_SYSEX_20261013.md).

## Browser-local app sets

`createBrowserLibrary` imports the existing catalog JSON export format directly
from explicitly selected browser Files. Sets contain 1–8 bundles up to 1.5 MB
each, with a canonical base64 1 MiB image and exact image SHA256. The complete
set is validated before an atomic IndexedDB save. Safe relative paths,
immutable IDs, bounded metadata and baseline-hash syntax are enforced. Listing
rechecks stored Blob hashes; removal affects only browser copies and keeps
shared packages and original source files.

Firmware Blobs never enter a host resource, server tool call or network request.
The UI renders only metadata, with `ready:false`, `imported_unverified`,
`manual_uboot` and `device_baseline_verified:false`. Image hash validation does
not prove that a package matches the connected unit. Storage belongs to the
browser origin/profile; unavailable IndexedDB does not fall back to memory.

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
project directory, compiled firmware or a completed device transfer. Direct
drafting and **Ask Codex** do not require the former diagnostics proof gate.
The host action hands configuration to Codex for finite local build work; it
does not create a connection helper or approve a device write. Custom package
and verified current-unit baseline review remain separate from that handoff.

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

The 3.2.0 source passed 418 Site tests with no skips, TypeScript checking and
the production build. The new Forge UVC candidate remains unflashed; the
ProTracker capture and October 12 CPU benchmark are separate hardware receipts.

## Retained legacy bench APIs

The previous Python bridge/relay, protected serial/UBOOT writer, local Node
stock worker and vendor M-UPGRADE handoff remain compatibility operations.
Their saved job receipts, one-use approvals and unknown-outcome latches are
preserved. Legacy `get_fm1_status` is passive inventory and `relay.connected`
means the service heartbeat, not physical FM-1 presence. These APIs are not
the 3.3.0 panel's automatic detection or transfer path.

UBOOT uses a vendor mass-storage protocol outside standard Web Serial/Web MIDI,
and direct CDC COMMIT remains blocked. A custom flash therefore uses an
explicitly authorized manual/legacy bench workflow with its own protected
package and baseline review. The default panel neither starts those services
nor silently falls back to them. The old Windows helper Startup entry is
disabled reversibly. See [legacy relay setup](SITE_RELAY.md) and the dated
[verification receipts](VERIFICATION.md) when deliberately using that path.
