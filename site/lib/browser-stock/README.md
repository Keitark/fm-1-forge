# Direct browser stock update core

`index.mjs` exports `createBrowserStockUpdater` for FM1 Forge's native panel.
All production modules here use browser APIs and local relative ES modules;
they do not spawn processes, use Node modules, fetch/upload firmware, or call
the MCP bridge. The SysEx protocol implementation is adapted from this
repository's independently implemented stock worker.

The constructor is inert. `connect()` alone requests Web MIDI SysEx permission,
under an actual user gesture and the device's exclusive Web Lock. It opens only
an exact selected FM-1 pair, sends a benign identity query, verifies the model,
then closes both endpoints. It returns `{pair, identity, loader,
identityVerified: true}`. `pair` includes exact input/output IDs and names.
Unrelated, generic `USB Composite Device` and ambiguous duplicate endpoints are
unavailable through this browser path because Web MIDI supplies no trusted
USB-interface correlation.

`initialize()` / `ready()` initialize only durable local storage under the same
Web Lock. `status().storageScope` reports actual `location.origin`, `originKind`,
the actual boolean/null `secureContext`, the persisted IndexedDB UUID sentinel,
`durableReady` and `locksAvailable`. Canonical HTTP/S
origins and the native `codex-sandbox://mcp-app-<48 lowercase hex characters>.web-sandbox.oaiusercontent.com`
origin form are accepted. Native access additionally requires the actual
`isSecureContext === true`; its actual `location.origin` is preserved exactly,
never replaced with an HTTPS URL. Null/opaque origins, other custom schemes,
credentials, ports or path/query/fragment additions to native origins are rejected.
The exact native grammar is checked before URL parsing, so Electron's registered
scheme normalization cannot add a false trailing-slash rejection.
An instance that observed a sentinel rejects later replacement or
deletion; the original request digest also binds that origin and sentinel, and
every journal transition verifies them. Native panel acceptance must compare
actual reports from two panels and a reopened panel before claiming shared
cross-tab recovery. Facade host tests cannot establish the host's real storage
partition behavior.

`status()` is a synchronous cached snapshot. `probe()` reads already-authorized
endpoint metadata only. `savedAttempt()` reads and validates the authoritative
IndexedDB record and returns scrubbed original job/review IDs, state, phase,
package identity/digest, selected pair and completion flags. These methods do
not request permission, open MIDI, send messages or resume a transfer. Passive
MIDIAccess state changes invalidate a cached connection; they do not query a
device automatically.

`inspectPackage(File | ArrayBuffer | Uint8Array)` uses WebCrypto SHA-256 to accept
only unmodified official stock V15 (`FM-1_015`, 699,956 raw / 699,936 logical bytes,
digest `db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a`).
The chosen bytes stay inside the panel. Input bytes are copied before hashing.

`update({jobId, reviewId, packageBytes})` and
`resume({jobId, reviewId, packageBytes})` require explicit user actions, previously
granted MIDI, confirmed identity, strict durable IndexedDB and the same
exclusive cross-tab Web Lock used by Connect. Both IDs are 32 lowercase hex
characters. The host UI must display the pinned package review and require a
second trusted confirmation before calling either method.

The immutable reviewed request and active phase commit via an IndexedDB
`readwrite` transaction with `durability: 'strict'`. The transaction's
`oncomplete`, not merely a request's success, resolves before any UPGRADE send.
Missing Web Locks, IndexedDB or strict durability blocks the path. There is no
memory/localStorage fallback. An active/unknown record survives reload and
blocks a new update. Resume requires the original IDs, the same pinned package
and a fresh exact OTA-loader identity; it never retries automatically.

Two-phase device pulls use continuous LSB-first SysEx packing, exact partial
response lengths, complement checksum, 512-byte bounded ordinary requests and
phase-specific terminal acknowledgements. Completion requires the loader's
finish path and a subsequent exact `FM-1_015` identity. It reports
`transfer_finished: true`, `boot_identity_verified: true`,
`readback_verified: false`. Failure after an attempted UPGRADE remains unknown
and recovery-required. Progress events have a phase and optional request/byte
counts and a fraction from 0 to 1. There is no hardware-input activity polling.

`onState(snapshot)` and `onEvent(progress)` callbacks are optional. Callback
errors cannot interrupt the firmware transfer. Disconnect is blocked while a
transfer or another panel owns the device lock.

The underlying factual protocol sources are
[FM-1-RE OTA documentation](https://github.com/AL-255/FM-1-RE/blob/main/docs/io/11-ota-protocol.md)
and the
[pinned Felucca installer reference](https://github.com/hugelton/Felucca/blob/1727537624390cc3f9c7dff2456b43b3a8edb005/tools/fm1_install.py).
The GPL reference implementation is not bundled here.

Host tests in `test/browser-stock.test.mjs` use injected MIDI, IndexedDB and
Web Lock facades. They read the real pinned V15 fixture if available and
explicitly skip fixture-dependent cases otherwise. A passing host test or
exposed browser API is separate from real browser permission and hardware
acceptance.
