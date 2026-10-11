# FM1 Forge native extensions

Forge 3.1.0 uses the official OpenAI MCP Extensions TypeScript SDK on both the
hosted MCP server and the native MCP App. ChatGPT Sites still hosts the server
and UI. The local relay continues to connect saved requests to the FM1 bridge.
Browser WebMCP is a separate interface and does not discover the native panel.

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
