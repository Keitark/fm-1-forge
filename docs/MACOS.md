# FM-1 Forge macOS preview

For the current single-install Windows/macOS package with automatic CPU selection,
see [FM-1 Forge desktop](DESKTOP.md). The alpha.8 instructions below remain
available for the separate architecture-specific preview.

Version **3.4.0-alpha.8** adds a separate native macOS plugin edition for Apple
Silicon (`arm64`) and Intel (`x64`). The Windows alpha.7 installation and the
hosted Forge plugin are preserved. Linux is not enabled by this change.

The Mac package bundles Node v22.22.2 and the pinned `@julusian/midi` 3.8.1
CoreMIDI component. Normal plugin use needs no global Node/Python installation,
separately launched helper, browser MIDI permission or localhost service.

## Install the matching built package

1. Open the repository's [Actions page](https://github.com/Keitark/fm-1-forge/actions/workflows/verify.yml) and select the successful Verify run for the macOS implementation commit.
2. Download `FM-1-Forge-macOS-arm64-3.4.0-alpha.8` for an Apple Silicon Mac or the corresponding `x64` artifact for an Intel Mac. Extract the artifact ZIP to obtain the `.tar.gz` and its SHA-256 file.
3. Verify the archive with `shasum -a 256 --check <archive>.sha256`, then extract the tar archive. It contains the local marketplace and the self-contained plugin. Retain the executable permissions carried by tar.
4. With the Codex CLI on PATH, register that extracted marketplace and install it:

```sh
codex plugin marketplace add /absolute/path/to/fm1-forge-macos-arm64
codex plugin add fm1-app-library@fm1-forge-macos
```

Use the `fm1-forge-macos-x64` folder for Intel. Open **FM-1 Forge macOS** in
Codex after its plugin connections refresh. The Mac and Windows marketplaces
share the stable plugin name but have separate marketplace and MCP server keys.

## Device and firmware behavior

- Explicit **Connect stock MIDI** reads the stock V15 identity through CoreMIDI.
- **Connect firmware MIDI** reads compatible Forge identity/capabilities.
- Stock V15 restore and custom FWSC review/install use the same bounded native
  SysEx engines, package validation, exact identity/build checks, exclusive
  device ownership and durable original-attempt recovery as Windows.
- A file selection, connection or build request never confirms a firmware write.
- Common-firmware self-updates remain disabled. Native USB serial/UBOOT writing
  and compiler distribution are not added by the Mac edition.
- Exact FM-1 endpoint matching remains fail-closed. Actual CoreMIDI endpoint
  names, reconnect behavior and physical flashing still require a Mac bench.

Storage uses the host's `PLUGIN_DATA`; the fallback is
`~/Library/Application Support/FM1Forge/macOS`. Existing path/link protections,
private file modes and journal/lease ownership checks remain in force.

## Build and verification

CI runs on native Apple Silicon and Intel macOS 15 hosts. It verifies the
[official Node distribution](https://nodejs.org/en/blog/release/v22.22.2) by its
pinned architecture-specific SHA-256, runs desktop and SysEx contracts, builds
with the matching runtime, loads the native addon without enumerating/opening
MIDI, and performs passive SDK checks over three MCP revisions with an empty
PATH. The build records file hashes, POSIX modes, source closure and licenses.

The native builder rejects cross-building from Windows or a mismatched CPU:

```sh
node desktop/scripts/build-macos.mjs --arch arm64 --out /absolute/checkout/tmp/mac-release/fm1-app-library --node /absolute/node-v22.22.2-darwin-arm64/bin/node --node-license /absolute/node-v22.22.2-darwin-arm64/LICENSE
```

Developer builds require the pinned Site dependencies and native MIDI package;
CI installs the MIDI package with `--ignore-scripts` and verifies its supplied
prebuild directly. The matching Mac runtime must actually execute; a copied
Mach-O file or a Windows-only test does not count as native acceptance.

CoreMIDI support is documented by the [upstream MIDI library](https://github.com/Julusian/node-midi).
Native package/stdio acceptance and real FM-1 connection/transfer/boot acceptance
are separate. This implementation does not claim a physical Mac firmware test.