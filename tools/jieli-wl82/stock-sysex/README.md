# FM1 stock USB-MIDI updater (JavaScript)

This isolated Node 22 worker implements the stock FM-1 USB-MIDI SysEx pull
protocol. It accepts only the unmodified official V15 package:

- Product: `FM-1_015`
- Raw length: 699,956 bytes; logical length: 699,936 bytes
- SHA-256: `db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a`

The package is a local input; no firmware is bundled or downloaded by this
worker. There is no arbitrary SysEx command, `force` flag, package mutation,
automatic retry, or automatic update resume.

## Runtime and host verification

`npm ci --ignore-scripts --no-audit --no-fund` installs the lockfile-pinned
`@julusian/midi` 3.8.1 dependency and its Windows N-API prebuild. The installer
does not need Python or a compiler on supported prebuilt platforms.

`npm test` runs protocol, state machine, durable journal, endpoint selection and
trusted metadata host tests. Tests do not load MIDI hardware. The actual V15
fixture is read only when available at `F:/dev/fm1/references/originals/FM-1-v15-original.fwsc`
or `FM1_STOCK_V15_FIXTURE`; it is never copied into this repository. Tests with
that fixture are explicitly skipped when it is unavailable.

`protocol.mjs`, `physical.mjs`, `selection.mjs`, and `updater.mjs` use only standard
JavaScript and an injected transport/journal/clock. They can also serve a future
Web MIDI adapter. This worker provides the Node transport; it does not claim that
Codex's sandbox grants Web MIDI permissions. The surrounding existing Forge
bridge and outbound relay are separate services.

## Local worker contract

Start `node cli.mjs` with exactly one JSON object on stdin. Each stdout line is
NDJSON: `type: event`, `type: result`, or `type: error`. No package bytes, raw USB
device paths, token values or OS exception strings are printed.

Supported operations:

- `inspect_package`: `operation`, absolute `localPackagePath`. Validates the
  exact size, embedded marker identity and SHA-256 without importing native MIDI.
- `probe`: passive MIDI endpoint enumeration. Returns `pairs`, `selectedPair`
  and `identity_verified: false`. It never opens a MIDI endpoint or sends SysEx.
  Optional `expectedStockPair` restricts selection. Multiple indistinguishable
  FM-1 units are rejected; there is no sole-unrelated-output fallback.
- `update`: absolute `localPackagePath`, exact `reviewedSha256`, immutable `jobId`,
  opaque `endpointReviewId`, absolute private `stateRoot` and exact
  `expectedStockPair: {inputName, outputName}` are required.
- `resume`: identical unresolved job, digest, original endpoint review ID and
  endpoint metadata. A fresh exact FM-1 OTA-loader identity is mandatory before
  sending another upgrade command. A new update cannot clear an unknown latch.

For example, a normal selected pair can be `FM-1 Midi 0` / `FM-1 Midi 1`.
The trailing index is the WinMM port index appended by RtMidi; it is not inferred
from arbitrary substrings. Only unique canonical `FM-1`, `FM-1 Midi` and
`ota-FM-1` names are recognized automatically.

Generic older stock `USB Composite Device` endpoints require explicit local
selection plus `physical: {vid: '4c4a', pid: 'c755', mi, instanceHash,
correlated: true, userSelected: true}`. Those flags alone confer no trust.
`windows-midi-inventory.ps1` performs bounded system-intercepted WinMM device
interface metadata queries without MIDI opens/sends. The worker checks every
RtMidi index and name against those fresh WinMM results, then requires both
selected endpoints to have the same reviewed USB instance and interface.
Only hashes of USB instance metadata are retained; raw device paths never leave
that script. Correlation failure blocks generic endpoint opens. The native
backend and Site must keep generic updates unavailable unless the user selects
the locally proved pair; remote assertions are insufficient.

Progress events have `phase`, optional `requests`, `bytes_served` and `progress`
as a fraction from 0 to 1. Events are limited to a maximum of one per 100 ms,
apart from phase changes and terminal acknowledgements. Coverage progress counts
unique served source bytes so duplicate and out-of-order pulls do not inflate it.

Successful results report `transfer_finished: true`, `boot_identity_verified:
true`, exact identity `FM-1_015`, and `readback_verified: false`. The stock
loader finish handshake and subsequent identity are evidence of transfer finish
and a matching reboot; they are not a full flash readback. Any failure after an
attempted upgrade command is `state: unknown`, `recovery_required: true`.

## Durable safety boundary

A private exclusive worker lock and atomically replaced, fsynced attempt journal
are established before any upgrade command. The journal binds the reviewed
package, original endpoint approval and job ID. A process crash leaves an
active/unknown recovery latch. An explicit identical resume can reclaim only a
dead owner's lock and must find a freshly identified OTA loader; an active owner
blocks it. Every normal/resume lock acquisition is serialized by a separate
exclusive acquisition guard through stale-owner validation and replacement.
Random owner nonces protect both guard release and worker-lock release. A
crashed acquisition guard remains fail closed; the worker never automatically
deletes it. Trusted bridge/manual recovery must first prove that owner is dead.
Terminal receipts are archived immutably before a later distinct job.
Corrupt state, inconsistent receipts, unsafe paths, symlinks and junctions fail
closed. The owning Forge backend must also enforce its existing approval and
serial/UBOOT mutual exclusion. This local worker does not grant write permission.

## Protocol provenance

This is an independent implementation of factual wire framing and documented
timing. It does not bundle or copy the upstream installer implementation.

- [FM-1-RE OTA protocol](https://github.com/AL-255/FM-1-RE/blob/main/docs/io/11-ota-protocol.md)
  documents continuous LSB-first packing, `00 59 30` framing, exact partial
  lengths, complement checksum, marker stripping and phase terminals.
- [Pinned Felucca installer, commit 1727537624390cc3f9c7dff2456b43b3a8edb005](https://github.com/hugelton/Felucca/blob/1727537624390cc3f9c7dff2456b43b3a8edb005/tools/fm1_install.py)
  confirms the official V15 digest, identity fields and two-stage stock flow.
  That reference source is GPL-3.0-only and is not shipped in this worker.
- [Julusian node-midi](https://github.com/Julusian/node-midi) documents native
  RtMidi support and SysEx receive settings. The dependency's bundled licenses
  remain applicable.
- Microsoft's [DRV_QUERYDEVICEINTERFACE](https://learn.microsoft.com/en-us/windows/win32/multimedia/drv-querydeviceinterface)
  and [DRV_QUERYDEVICEINTERFACESIZE](https://learn.microsoft.com/en-us/windows/win32/multimedia/drv-querydeviceinterfacesize)
  document the passive WinMM metadata query surface.

Host validation is separate from physical acceptance. No flash operation or
hardware acceptance is implied by the test suite passing.
