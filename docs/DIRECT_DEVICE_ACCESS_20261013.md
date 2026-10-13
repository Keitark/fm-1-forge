# Direct browser access in the native Codex panel

The actual FM1 Forge panel was checked on 2026-10-13 using JavaScript executed
inside its real document, rather than an automation DOM facade. It reported:

```json
{
  "secureContext": true,
  "permissionPolicySource": "featurePolicy",
  "midi": {"apiAvailable": true, "apiStatus": "present", "policy": "allowed"},
  "serial": {"apiAvailable": true, "apiStatus": "present", "policy": "allowed"},
  "usb": {"apiAvailable": true, "apiStatus": "present", "policy": "allowed"}
}
```

This proves API availability and document policy, not a granted device
permission, working device connection or successful firmware transfer. The
detector requests no permissions, enumerates no devices and opens no handles.

The MCP Apps SDK's declared resource permissions list camera, microphone,
geolocation and clipboard writing. Their absence of hardware declarations
does not prove that this native host blocks the browser hardware APIs; the
observed native document above permits them.

## Runtime boundary

FM1 Forge 3.2.0 now uses foreground JavaScript device communication in the
panel, without a Python or Node helper process. Web MIDI implements the stock
SysEx transport; Web Serial implements read-only custom-firmware CDC identity
and status. Permission and port selection happen through explicit trusted user
actions. Startup never opens a device.

Official V15 bytes are validated by WebCrypto and stay in the panel. Stock
writes require a strict committed IndexedDB journal before each UPGRADE and
an exclusive Web Lock. An uncertain outcome stays bound to its original job,
package and MIDI pair, with explicit OTA recovery only. Missing durable storage,
locks or a non-opaque origin disables writing; there is no in-memory fallback.
Native acceptance must additionally establish that two panels and a newly
opened panel share the actual document origin and persisted storage sentinel.

Local app sets import the existing catalog JSON exports (up to eight packages),
validate 1 MiB image hashes and store firmware Blobs atomically in IndexedDB.
List results and cards contain metadata only. Imported baselines are unverified;
custom transfer readiness is false and labeled manual UBOOT. Storage retention
belongs to the current browser origin/profile and is not promised across an
origin change or reinstall.

The existing UBOOT transport uses mass storage. Standard WebUSB protects
interface class `0x08`; the existing SCSI/raw-disk transport cannot simply be
copied to a normal WebUSB page. UBOOT requires manual recovery, host-specific
native support, or a separately designed device-side update protocol.

No firmware was written during this capability check. The newly prepared
protected helper completed startup and was stopped without any device run.
Stock transfer acceptance and the initial custom-to-stock restoration remain
pending.

The Python bridge, relay and protected session have been stopped. The old
`FM1 Forge connection.lnk` Windows Startup entry was moved reversibly to
`%LOCALAPPDATA%\\FM1RemoteBridge\\disabled-startup\\FM1 Forge connection-20261013.lnk`.
The startup entry is absent and the rollback copy remains. Passive Windows USB
inventory sees the FM1 CDC interface on COM4; this is not a live firmware identity.

## Current release and native acceptance

- Private plugin identity preserved; release `pluginrel_6ace3b6142588191a448734d46bcdc9f`
  is version 3.2.0. The desktop plugin cache refreshed to 3.2.0.
- Private Site source: `bd58ded9fe5a104f4861dbd7169a26dceda77798`.
- Canonical resource: `ui://fm1/forge-panel-v18.html`; previous aliases retained.
- Deployment: `appgdep_6ace3fa5721081918161d08996464ef4`, succeeded with MCP.
- Archive SHA-256:
  `ecbe0c39d072e7feb1bab7aebdfb57436b0073a59bb80afe534fd0c36a5a0870`.
- 417 Site/UI/SDK/browser/server tests passed with zero skips; TypeScript and
  production build passed. Browser stock tests: 25/25, serial: 19/19,
  library: 19/19.
- Three fresh native panel documents share the exact reported native origin and
  persisted IndexedDB sentinel. Each reports `originKind: native`,
  `secureContext: true`, `durableReady: true` and `locksAvailable: true`.
  Initialization uses the strict transaction and Web Lock. This establishes the
  current host's shared recovery-storage scope; restart/reinstall retention and
  a simultaneous physical transfer were not tested.
- Native screenshots confirm the black surface, direct connection controls,
  graphical module workspace and enabled project handoff. Startup requests no
  device permission and does not turn stale cloud COM4 metadata into a connection.
- Actual serial permission/identity and stock SysEx transfer remain pending.
  No serial/MIDI port was opened or firmware written during these checks.

The native-origin predicate accepts only the observed Codex host grammar and
requires the actual secure-context flag. It checks the native origin before URL
parsing because Electron may normalize its registered scheme differently from
Node. It never translates the origin to HTTPS or relaxes journal/permission gates.

## Initial helper-free deployment

- Private Site source: `7509c420ba9b3df8e23ddd84fb8333c0d3436bce`.
- UI resource: `ui://fm1/forge-panel-v16.html`; old aliases retained.
- Deployment: `appgdep_6ace3a45a0bc8191a4a97b24be59b922`, succeeded with MCP.
- Archive SHA-256:
  `e9d9d3e62e6afcd196f89b99bcae2c1551e9c5e1535c7ca6173fd32c7fecd786`.
- 412 Site/UI/SDK/browser/server tests passed, zero skips; TypeScript and
  production build passed. Includes 19 serial, 20 browser stock and 19 browser
  library tests. Independent reviews covered durable recovery and local import.
- A fresh native panel renders the direct buttons, graphical modules, enabled
  project handoff and browser-local library against the opaque black surface.
  Stale relay COM4 metadata does not become a direct browser connection.
- The native report supplies an actual non-null `codex-sandbox://` document
  origin and Web Locks. The initial HTTP-only validator rejected that native
  origin before creating a journal; stock writing remained disabled. The next
  source revision adds narrow secure native-origin support and must verify
  shared/persistent storage with separate real panels.
- Actual device permission, direct serial identity and stock transfer remain
  untested. Native browser chooser/permission actions require a real user click;
  the available MCP Apps automation uses synthetic clicks.

## Earlier published capability check

- Private Site source: `debda6a52208bc4ce680a376715b5c212f2675ee`.
- UI resource: `ui://fm1/forge-panel-v15.html`; old aliases retained.
- Deployment: `appgdep_6ace2cf56ed481919dd6c85183224ae1`, succeeded.
- Archive SHA-256:
  `6e5745aafe73f9086b1f69f8852d2b5945a99b1bf18b304fa1a65bdd825cda36`.
- 345 Site/UI/SDK tests passed; TypeScript check and production build passed.

## Sources

- [OpenAI UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
  describes JavaScript UI resources and the host bridge.
- [MCP Apps resource permissions](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiResourcePermissions.html)
  defines the declared permission interface and host discretion.
- [WebUSB protected interfaces](https://usb.spec.whatwg.org/#has-a-protected-interface-class)
  defines the standard protected class boundary.
