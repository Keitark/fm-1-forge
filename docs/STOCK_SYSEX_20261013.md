# Stock SysEx implementation and acceptance — 2026-10-13

FM1 Forge now has a native-panel stock update route backed by a JavaScript
protocol engine and a local Node 22 USB-MIDI transport. The existing Python
bridge/relay still carries reviewed requests, and Python remains the protected
serial/UBOOT recovery runtime. This is not a complete removal of Python.

The MCP Apps panel itself executes JavaScript. Direct Web MIDI access from its
Codex sandbox is unverified; the pinned MCP Apps SDK permission declaration
does not include MIDI. The pure protocol engine supports an injected transport,
but this release supplies Node MIDI, not a helperless browser transport.

## Reviewed update boundary

- Only the unmodified official V15 `.fwsc`: 699,956 bytes, SHA-256
  `db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a`.
- Normal stock MIDI endpoints must be uniquely selected and bound to the
  one-use panel review. A new update is unavailable in OTA mode.
- The exact FM-1 model is checked before each update phase. A successful
  receipt requires transfer completion and a fresh `FM-1_015` reboot identity.
- An attempted upgrade is journaled before sending its command. Uncertain
  outcomes require explicit original-job recovery; there are no automatic
  retries. Recovery-lock acquisition is serialized.
- Status refresh performs passive endpoint enumeration only, without opening
  MIDI ports or sending identity/upgrade commands.
- Successful stock writes invalidate the old protected baseline. Transfer and
  reboot identity do not imply a full flash readback.
- Generic older Windows endpoint names are supported only by the local CLI
  with fresh WinMM USB-instance/interface correlation; the panel keeps those
  endpoints unavailable until its local selection flow is integrated.

See [the worker contract and protocol sources](../tools/jieli-wl82/stock-sysex/README.md).

## Validation performed

- 45/45 JavaScript updater tests, zero skipped, including the actual official
  V15 fixture and concurrent-resume regression.
- 202/202 Python backend, bridge, relay and update-mode tests.
- 336/336 Site, native UI, SDK and server tests; TypeScript check and production
  build passed.
- Independent review rechecked package/model gates, passive refresh,
  uncertainty and original-job recovery, approvals and baseline invalidation.
- Windows Node 22.22.2 loads the pinned `@julusian/midi` 3.8.1 native prebuild.
  A live passive probe found no stock FM-1 MIDI pair. Local package inspection
  returned the exact V15 size/hash/product.
- Private Site source `b314717b15146095c5018a0cf593fde86e113d69` was deployed
  successfully as `appgdep_6ace269f7798819182022fc690dc4a60`. The canonical UI
  resource is `ui://fm1/forge-panel-v14.html`; old resource aliases are retained.
- A fresh native panel rendered the graphical workspace, optional UVC, opaque
  black background and read-only CPU information, and received COM4 metadata.
- Reusing already verified per-call filesystem metadata reduced a synthetic
  3,739-record full journal scan from a 19.10-second median to 10.43 seconds.
  Every ancestor and JSON record still validates on every scan; no cache or
  TTL extension was added. Seven regressions cover those boundaries. The
  local relay was restarted with unchanged permissions and private ACLs.

## Physical test pending

The connected custom firmware currently exposes CDC on COM4, not stock MIDI.
An offline stock V14 restoration request was checked against the existing
verified MOD rollback image. It changes 121 application sectors, preserves all
protected bytes and writes the directory sector last. The existing writer will
require two fresh complete matching source reads before allowing a write.

The protected immutable-runtime launcher requested Windows elevation, which
was canceled. No protected session started, and no device transition, reset,
erase, program or SysEx upgrade was performed in this run. Stock restoration
and the physical V14-to-V15 transfer remain pending; host validation is not
hardware acceptance.

The UVC module is separately linked and audited. Its ProTracker source has
earlier 256×240 hardware capture evidence; this new Forge combination is still
unflashed. New projects use the SDK-default CPU clock (previously measured at
360 MHz); the panel no longer offers a clock tweak. Explicit legacy 320 MHz
draft imports retain their setting for compatibility.
