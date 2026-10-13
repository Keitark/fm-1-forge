# Stock SysEx implementation and acceptance — 2026-10-13

FM1 Forge 3.2.0 performs stock updates in the native panel's JavaScript with
direct Web MIDI. Its normal device flow starts no Python or Node helper. Local
package validation uses WebCrypto; a strict IndexedDB journal and Web Locks
protect the original transfer. Direct USB serial provides read-only custom
firmware identity/status. UBOOT mass-storage recovery remains manual.

The real Codex document reports secure context and allowed MIDI/serial APIs.
This is API/policy evidence, not a device permission grant or successful flash.
See [direct device acceptance](DIRECT_DEVICE_ACCESS_20261013.md). The earlier
Node/Python implementation below remains a legacy recovery path, separate from
the default browser controls.

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
- Transfer and reboot identity do not imply a full flash readback or establish
  a baseline for a later custom flash. Historical helper baselines must not be
  reused as current device proof.
- Generic older Windows endpoint names are supported only by the local CLI
  with fresh WinMM USB-instance/interface correlation; the panel keeps those
  endpoints unavailable until its local selection flow is integrated.

See [the worker contract and protocol sources](../tools/jieli-wl82/stock-sysex/README.md).

## Legacy implementation validation

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
protected bytes and writes the directory sector last. Offline review found
that the protected worker passes its saved baseline as `verified_preflight`,
which skips the writer's normal fresh-read checks. A fresh current-device read
gate must be established before this restoration is used; the old saved
baseline alone is insufficient. Loader and failure latches must be preserved.

The first elevation request was canceled. A later authorized launch completed
its immutable-runtime startup and idle status exchange. The session was then
stopped without device I/O while investigating the requested process-free
panel architecture. No device transition, reset, erase, program or SysEx upgrade
was performed. Stock restoration and the physical V14-to-V15 transfer remain
pending; host validation is not hardware acceptance.

The UVC module is separately linked and audited. Its ProTracker source has
earlier 256×240 hardware capture evidence; this new Forge combination is still
unflashed. New projects use the SDK-default CPU clock (previously measured at
360 MHz); the panel no longer offers a clock tweak. Explicit legacy 320 MHz
draft imports retain their setting for compatibility.
