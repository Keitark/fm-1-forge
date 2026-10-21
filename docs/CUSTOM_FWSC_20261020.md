# Custom FWSC over SysEx - 2026-10-20

FM-1 Forge Windows **3.4.0-alpha.6** adds a separate manufacturer-compatible
custom FWSC path. The exact official stock V15 restoration whitelist is retained.
This custom path starts from stock V15; it does not enable common-firmware ARM
or self-updating in an already installed Forge application.

## Prepare the firmware

Build the Forge project with firmware MIDI enabled so the installed application
can report its embedded build identity. Then export with the source CLI:

```powershell
node tools/jieli-wl82/stock-sysex/package-custom.mjs --stock <official-V15.fwsc> --application <fm1-usb-diag.app.bin> --build-manifest <build-manifest.json> --out <fresh-output-directory>
```

Use the existing development/bundled Node runtime; ordinary plugin use needs no
separate JavaScript runtime or helper installation. The CLI requires the audited
application, matching build manifest and exact public V15 template. It verifies
application size/hash, source/archive closure and static audit, then takes the
target identity from `usb_midi_update_contract.build_id`. A manifest file hash
is not the embedded firmware identity.

Output files are `firmware.fwsc`, `firmware.json` and `packaging-receipt.json`.
The repository and installed plugin do not bundle the manufacturer's firmware.
No private unit readback, chip-key query, key file or external packing executable
is needed for this public-template transform.

## Install through the panel

1. Open the installed **FM-1 Forge Windows** edition in a fresh Codex chat.
2. Use **Connect stock MIDI** to explicitly connect the intended stock V15 FM-1.
3. In the custom FWSC section, select the generated `.fwsc` and its matching
   `firmware.json` manifest.
4. Review the exact package digest, target build, firmware identity, MIDI pair,
   layout policy and qualification limits. Confirm the explicit custom Install
   action only when that is the intended firmware replacement.
5. Keep the original attempt through checking, OTA re-enumeration, writing and
   final Forge identity/build verification. Stock/custom writers share exclusive
   device ownership and suppress connection queries while either transfer runs.

Do not use the stock V15 restore file selector for a custom package. The custom
writer accepts the bounded Forge package policy and matching manifest, not a
bare `app.bin` or an arbitrary caller-selected native file path.

## Package contract

The source format follows the MIT-licensed official M-VAVE packager at commit
`b178ac43c25f010c60a878056fb5331fe693fd62`, while retaining the fixed public V15
layout rather than invoking its Open-layout migration. See
[the upstream packager](https://github.com/m-vave/fm1_open/blob/b178ac43c25f010c60a878056fb5331fe693fd62/sdk/Package.cs).

- The exact official V15 template is pinned by full SHA-256.
- The custom container has two canonical entries: `flash.bin` and pinned `ota.bin`.
- Chip, sizes, bounds, directory/header/data CRCs and logical/package SHA-256 are
  checked. The published public SFC encoding is used, without unit-private keys.
- The boot prefix, fixed configuration/reserved directory and configuration data
  remain pinned. Application bytes and the two required checksum/length records
  are updated; the unused application tail remains exact.
- A pinned SHA-256 Merkle proof authenticates that preserved ciphertext tail,
  including a partial boundary block. All proof fields are bounded and validated.
- The application must contain its declared 32-byte MIDI build identity; the CLI
  additionally derives that value from the matching audited build manifest.

## Completion and recovery

The writer requires the pinned OTA identity `ota-FM-1_015`. Final success requires
both transfer completion and observed `FM1_FORGE_001` identity, FMC1 family 8,
idle state and the exact reviewed build digest. An idle firmware reply with its
installation capability disabled is valid build evidence. The source/build
identity is not a full-flash readback hash; `readback_verified` stays false.

A durable journal precedes the upgrade commands. Active, unknown, corrupt or
orphaned worker evidence blocks a new attempt in either stock/custom route.
Explicit recovery uses only the identical original custom job, saved package,
manifest and target build, with a freshly connected pinned OTA loader. Neither
opening the panel nor reconnecting automatically retries a write.

Offline preservation of the package does not prove the current unit's full NOR
baseline: stock V15 exposes no live digest ARM operation. Loader write behavior,
boot and physical LCD/input/audio behavior remain pending until a separately
authorized hardware test. Package generation, installation of the plugin and
source tests do not by themselves qualify a physical firmware transfer.

## Offline implementation receipt

The 2026-10-20 validation passed 102 desktop, 497 Site and 70 stock/custom SysEx
contracts (669 total, no failures or skips), plus TypeScript, panel and production
builds. The packaged alpha.6 server passed passive checks over MCP 2026-07-28,
2025-11-25 and 2024-11-05 with an empty PATH and no device opened. All 127
installed file hashes matched the build manifest after supported Codex CLI
installation. See [the machine-readable receipt](evidence/windows-alpha6-custom-fwsc-offline-20261020.json).

A 623,156-byte custom FWSC was exported from the audited 160,560-byte starter
application. Its package SHA-256 is
`28feacb925a1bb634beae7e38e9094964e8e61e7a69af2c0c5f601adcc572472`.
The firmware package is local and is not included in the repository or plugin.
Native panel activation in a fresh chat and a separately authorized physical
transfer remain pending.