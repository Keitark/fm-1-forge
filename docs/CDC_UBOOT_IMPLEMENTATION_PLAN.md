# Native Windows CDC to UBOOT updates

Refs #3. Extend the existing self-contained Windows plugin; keep its identity,
data directory and stock/custom MIDI workflows. The running tracker installation
is already recorded succeeded with exact CDC build proof. Do not flash it again
merely to test this feature.

## Route and artifacts

Accept the same strictly validated generated firmware.fwsc + firmware.json,
initially the closed protracker profile. Extract its audited plaintext application
after inspectCustomFwsc; its returned logical image is UFW, not a raw NOR image.
Bind source FWINFO identity/build and the uniquely identified CDC USB instance.
CDC interface00 is3654:5155; UBOOT mass storage is4c4a:8057 with exact WL82 inquiry.
Keep disk numbers, COM names and unit metadata internal. Compare physical USB
location paths across personality changes where available; reject ambiguity.

## User flow and ownership

1. Connect USB serial: bounded fixed FWINFO challenge, no STOP/UBOOT/write.
2. Select package pair and review source device, source/target build and hashes.
3. Explicit Prepare confirmation owns the shared device lease, stops playback,
   verifies stopped status and performs UBOOT arm/confirmation. An owned elevated
   worker uploads only the pinned RAM helper and reads the full current1MiB twice.
4. Derive the candidate from that live baseline. Show its baseline/candidate
   hashes and exact changed-sector plan. A separate explicit Install confirmation
   authorizes the application erase/program phase. A zero-change plan returns to
   the same application without erase/program.
5. Persist mutation intent before every erase/program, verify each result and
   complete full final readback twice. Program the application directory sector
   last. Reset once after complete verification, then verify exact target build
   with a fresh CDC nonce. Report transfer, readback, boot and physical acceptance
   separately.

Use one plugin-owned Windows PowerShell/C# worker under UAC, not a global Python
installation, manual helper service or WebUSB driver. Its code/data must be
hash-frozen before elevation into an administrator-owned private job snapshot.
The private named pipe is restricted to the requesting Windows SID and checks
the exact client/server process identities and job nonce. No public raw SCSI,
serial command, arbitrary path or caller-selected sector API is exposed.

## V15 and closed transport policy

Do not reuse legacy V14 constants. V15 application starts0x4120, capacity581564,
configuration starts0x920dc (383 bytes), VM starts0x93000, complete NOR1MiB.
Only application bytes and the first two directory CRC/size records may change.
Preserve unused tail, shared erase-sector configuration bytes and every other
boot/config/reserved byte. Validate directory/payload CRCs and application build
identity; never print or serialize a decoded encoding key.

The narrow WL82 protocol supports only inquiry, the pinned24064-byte RAM helper
(SHA d41da6126760c9d66660bcc0cac8d27d221806c5e369a8036921efe68dca5376)
at0x1c02000, exact flash type3/id0x856014, ready/status,256-byte reads/programs,
4KiB sector erases and explicit verified reset. No key access, chip erase or
general memory commands. Helper initialization can change NOR status/protection;
it is a state-changing preparation, not a passive read claim.

## Persistence and recovery

Add a separate cdc-uboot journal; do not fake a MIDI request. Stock, custom MIDI
and CDC/UBOOT routes share uncertainty guards and the fixed device lease.
Preserve original package, source proof, live baseline, effective candidate,
ordered sector list, verified prefix, uncertain sector and protected worker
receipt. Failed preparation/programming, shutdown and lost workers remain
blocked; no automatic write retries, fallback transports or resets.

Explicit recovery uses only the original immutable job and verifies the full
current image against its recorded verified prefix and next uncertain sector.
An unprovable cold/RAM-loader state must fail closed rather than re-upload a
helper blindly. Provide a truthful bounded recovery handoff when the original
worker session cannot be safely re-established.

## Implementation boundaries

- Pure JS V15 package extraction/layout/planning and WL82 command vectors.
- Fixed privileged C# sector engine with injected transport for formal tests;
  independent range/hash/preimage enforcement even if the coordinator fails.
- Node coordinator and owned elevation/pipe bridge; application-only reviewed
  tools and model-visible passive status/exact boot observation.
- Existing generated desktop panel integration, CDC connection capability,
  shared busy/unknown guards, exact original-job recovery and clear history.
- Native package sidecars, pinned helper input/license/provenance, complete hash
  closure, updated skills and actual delivered-panel/package verification.

Validation must cover malformed/changed artifacts, V14 rejection, non-app byte
changes, shared configuration sector, partial transfers, live competing owners,
failed helper phases, interrupted writes, original-scope recovery, stale reviews,
shutdown/late results and physical identity changes. First hardware exercise
should qualify CDC entry/read/no-change return with the already installed build;
do not claim physical programming acceptance from that exercise or mock tests.
