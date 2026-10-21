# Windows stock writer - 2026-10-19

FM-1 Forge Windows **3.4.0-alpha.4** integrates the existing stock V15 SysEx
engine into the plugin's bundled Node/native-MIDI process. No browser MIDI
permission, Python installation, localhost service or separately started helper
is used. This is a Windows x64 implementation; macOS/Linux are not qualified.

## Supported operation

The sole accepted package is the unmodified official V15 `.fwsc`: **699,956 raw
bytes**, **699,936 logical bytes**, product `FM-1_015`, SHA-256:

```text
db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a
```

The user supplies that package locally; the repository and distributable do not
bundle the manufacturer's firmware. Selecting it is not permission to install.

1. Explicitly connect the intended normal FM-1 through **Connect stock MIDI**.
2. Choose the official package, then **Review stock update**. The panel uploads
   bounded sequential chunks to its local MCP server; the server validates the
   full size, product and SHA and snapshots the approved bytes.
3. Review the firmware identity, exact MIDI input/output names and full digest.
4. Explicitly confirm **Install stock firmware** in the panel. Only that reviewed
   operation may enter the stock OTA flow and replace firmware.
5. Follow the original job through checking, loader re-enumeration, writing and
   verified V15 reboot. Connection checks pause while the writer owns the device.

The native server holds the exclusive device lease across OTA re-enumeration.
Other panels cannot connect or disconnect through it during a transfer. Status
reads cached progress without transmitting MIDI. Closing the app view does not
restart the transfer or create a new attempt.

## Recovery and evidence

Attempt records are durably committed before the upgrade commands. Active or
unknown outcomes block new updates. On an uncertain result, retain the original
job, reconnect the intended OTA device explicitly through stock MIDI, and use
**Review original transfer recovery**. Recovery requires the same saved package
and original request; it never substitutes a new job or automatically retries.
A crashed or unresolved acquisition guard is not silently removed.

Success requires both `transfer_finished` and `boot_identity_verified` for exact
`FM-1_015`. It does **not** establish a byte-for-byte flash readback; the receipt
keeps `readback_verified: false`. Lost/failed terminal evidence remains visible
as an unresolved or failed outcome.

The stock write tools are marked app-only, and the start tool is destructive.
No raw MIDI, arbitrary local path, custom firmware payload, serial command or
UBOOT write tool is exposed. Common custom-firmware `installationAvailable`
remains false; stock capability is explicitly separate.

## Validation status

Implementation tests, self-contained package checks and native host checks are
recorded separately. The preceding alpha.3 native stock MIDI identity/status
check is documented in [the Windows panel evidence](WINDOWS_MCP_ROUTING_20261019.md).
A real stock write using this new alpha.4 panel has **not** been performed.
Source implementation and package startup do not establish physical acceptance.


The alpha.4 verification passed **80 desktop + 478 Site + 46 stock-protocol
checks (604 total)** with no failures/skips, TypeScript checking, panel build and
production build. The packaged server passed strict SDK checks for MCP
`2026-07-28`, `2025-11-25` and `2024-11-05` with an empty `PATH`. It exposes
18 tools, including app-only reviewed stock operations, and serves
`ui://fm1/forge-windows-v2.html`. Its addon load check did not enumerate ports.

The supported Codex installer installed `fm1-app-library@fm1-forge-windows`
version **3.4.0-alpha.4** and all **127 installed files** matched the package.
The current chat still retained the preceding alpha.3 MCP instance when checked;
open a **new chat** to activate alpha.4. Native alpha.4 panel acceptance and an
actual stock write remain pending. The prior alpha.3 identity check is retained
as historical evidence, not a new write result.

The [machine-readable offline receipt](evidence/windows-alpha4-offline-20261019.json)
records the package hashes and acceptance boundary. GitHub CI now includes the
Windows native writer and stock protocol suites alongside the existing checks.
