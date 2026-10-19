# FM-1 Forge Windows

Version **3.4.0-alpha.6** adds a separate stock V15-to-custom `.fwsc` SysEx path. It validates the generated package and matching manifest, preserves the pinned public V15 layout offline, and verifies `FM1_FORGE_001` plus the exact embedded MIDI build after reboot. The common self-update capability in the running custom firmware stays disabled. See [the custom FWSC guide](../docs/CUSTOM_FWSC_20261020.md).

The preceding alpha.4 stock writer and alpha.3 connection results remain recorded below. Native alpha.6 physical update acceptance is pending.

This edition is separate from the existing hosted FM-1 Forge plugin and Site. Preparing or installing it does not replace the hosted plugin or migrate its cloud data.

The intended experience is to install the plugin, open its native Codex panel and connect FM-1. Its Node.js runtime and native MIDI dependency ship inside the package. The user does not install Node.js or Python, start a helper application, run a server, configure a localhost port, or edit MCP configuration.

This preview implements Windows **connection, configuration, stock V15 restoration and reviewed custom FWSC installation**. It does not yet satisfy the complete cross-platform firmware factory requirement.

## Features in this edition

| Feature | Preview behavior |
| --- | --- |
| Stock MIDI connection | Opens one unambiguous named FM-1 MIDI input/output pair and verifies `FM-1_015` or `ota-FM-1_015` using a fixed identity query. |
| Firmware MIDI connection | Verifies `FM1_FORGE_001` and reads its common-update capabilities. Compatible custom firmware must already be installed. |
| Connection refresh | Checks the explicitly connected pair. Missing devices clear the connection; a transient identity timeout retains the last verified identity only while the named pair remains present and reports a diagnostic error. |
| Native panel | The local MCP server supplies the Forge interface and its graphical USB, HAL, user-module and tweak configuration. |
| Settings and drafts | Appearance settings and up to 24 validated configuration drafts are saved locally. Draft resources can be referenced through the plugin. |
| Stock V15 installation | Select the exact official `.fwsc`, review its hash and the connected stock MIDI identity, then explicitly confirm Install. A durable journal retains the original attempt through OTA re-enumeration, progress and uncertain outcomes. Physical update acceptance is pending. |
| Custom FWSC installation | Starts from explicitly connected stock V15, validates the generated FWSC and manifest, requires review/confirmation, and verifies the exact Forge MIDI build after reboot. Subsequent common-firmware self-updates remain disabled. |
| USB serial and UBOOT | Not implemented by this Windows preview. No serial commands, loader entry, device reset or mass-storage writes are exposed. |
| Compiler/toolchain distribution | Not included. Asking Codex to build a project still requires a separately qualified development environment or future build service. |
| macOS, Linux and Windows ARM | Not supported or qualified by this package. Native dependency prebuilds for other systems do not establish product support. |

Connection tools still expose no raw MIDI/SysEx API. The app-only stock writer accepts bounded chunks of the pinned official V15 package, validates them again in the native server, and starts only after an unexpired package/device review is explicitly confirmed. It never accepts a caller-selected file path or state directory. Uncertain attempts block new writes; recovery requires the original saved attempt and an explicitly connected, freshly identified OTA loader. No update automatically retries or resumes. Custom firmware installation remains unavailable.

## Install and open the preview

`desktop/` is source code. Distribute the **generated Windows package**, which includes the runtime, native dependency and panel, rather than this source directory alone.

The local preview uses the installed Codex CLI's supported marketplace registration and plugin installation commands. An operator creates a local marketplace named `fm1-forge-windows`. Its canonical catalog is **`.agents/plugins/marketplace.json`**, with plugin source paths resolved relative to the **marketplace root**, not the catalog's containing directory. `.codex-plugin/marketplace.json` is not a supported marketplace catalog location.

Use [marketplace.example.json](marketplace.example.json) as the catalog contents and arrange the generated package as follows:

```text
<marketplace-root>/
  .agents/plugins/marketplace.json
  plugins/fm1-app-library/
    plugin.json
    mcp.json
    runtime/
    server/
    ...remaining generated package files...
```

The example's `./plugins/fm1-app-library` source therefore refers to `<marketplace-root>/plugins/fm1-app-library`. Register the marketplace root and install its named plugin:

```powershell
codex plugin marketplace add <absolute-local-marketplace-path> --json
codex plugin add fm1-app-library@fm1-forge-windows --json
```

These are preview provisioning operations performed by the developer/operator. They are not instructions for ordinary users to install a runtime or launch a helper, and they do not establish a public marketplace release or an upgrade to the existing account-owned cloud plugin. The local plugin identity is `fm1-app-library@fm1-forge-windows`. On 2026-10-19 the installed alpha.3 server was visible in Codex with version `3.4.0-alpha.3`, 12 tools and `toolsError: null`. Its native panel and physical stock MIDI connection were inspected in the current chat. Earlier alpha.2 CLI installation and cache checks remain recorded below.

After installation, open a **new Codex chat** and open **FM-1 Forge Windows** through its installed plugin opening tool. Check the edition name when the existing hosted Forge plugin is also available. The alpha.3 native panel has now passed the host appearance and stock-connection check. Check that its eyebrow reads **FM-1 Forge Windows plugin**; the separately installed hosted panel uses a different device-access route. Opening the panel alone does not connect a device or send MIDI.

1. Connect the intended FM-1 and select **Connect stock MIDI** for original V15, or **Connect firmware MIDI** for compatible common-update firmware.
2. The panel asks the local MCP tool to open the exact MIDI pair and verify its identity. Browser MIDI/SysEx permission is not used for this route.
3. Configure modules, save a local draft, or send the project brief to Codex. Saving or requesting a build does not install firmware.
4. For an authorized stock restore, select the official V15 `.fwsc` in **Stock firmware · V15 SysEx update**, choose **Review stock update**, verify the package/device details, and explicitly confirm **Install stock firmware**. This changes firmware; connection alone does not.
5. Use **Disconnect** to release the native MIDI handles. A lost connection requires an explicit new Connect action; the plugin never substitutes another MIDI pair.

Close other software holding the FM-1 MIDI ports if Windows cannot open them. Multiple indistinguishable FM-1 devices are rejected; connect only the intended unit for this preview. An absent serial device on stock V15 is expected: use stock MIDI for that firmware.

## Runtime and local data contract

The generated `mcp.json` and `.mcp.json` declare a stdio MCP server. Codex launches the packaged `runtime/win32-x64/node.exe` with `${PLUGIN_ROOT}/server/index.mjs` and the plugin directory as its working directory. The package pins **Node.js v22.22.2** and **@julusian/midi 3.8.1**, including its Windows x64 N-API native prebuild and dependency closure. Startup does not run npm, download dependencies or rely on a user-managed runtime on PATH.

The native component is part of that Codex-managed MCP process. It is not a separately installed Windows service or an independently started background helper. It uses WinMM for MIDI access. A bounded, hidden invocation of the built-in Windows PowerShell executable obtains passive device-interface metadata from the packaged `server/windows-midi-inventory.ps1`; it does not open MIDI ports or send device commands. No administrator prompt is required by the MIDI connection code.

Settings, drafts and original stock-update recovery records live in the host-provided `PLUGIN_DATA` directory. When that variable is absent, the Windows preview uses `%LOCALAPPDATA%\FM1Forge\Windows`. The metadata file is `forge-store.json`; it contains settings and validated configuration drafts. The stock updater separately persists the selected, validated official package and its attempt evidence for explicit recovery; it does not store device dumps or credentials. The installed package remains an input, not a writable state directory. Cloud drafts are not automatically imported or modified.

The device service serializes connect, status and disconnect operations. Failed connections and fatal transport errors close native handles. Shutdown rejects pending connection evidence, closes the active pair and prevents a late native open from becoming a new connection. The official stdio transport closes the server when Codex closes stdin; the server's close handler also closes the device service. SIGINT and SIGTERM use the same graceful shutdown route. Windows releasing a terminated process is the final fallback, not evidence that a graceful close was tested.

## Endpoint selection and evidence limits

Automatic selection recognizes only exact canonical names `FM-1`, `FM-1 Midi`, `FM-1 Forge`, `FM1_FORGE_001` and `ota-FM-1`, with RtMidi's trailing numeric port index permitted. It requires one input and one output with the same canonical name and rejects duplicates or multiple matching pairs. Generic `USB Composite Device` names are not automatically opened in this preview.

Passive Windows metadata is correlated only when all reported WinMM indices and endpoint names match the native inventory. Raw device-interface paths are not returned; retained metadata uses a hashed USB instance identifier. Named-pair connection still requires a matching firmware identity response. This read-only identity check is not firmware transfer verification, flash readback, LCD/audio testing, hardware-control acceptance, or proof that an update loader is qualified.

An identity timeout can mean the MIDI endpoint still exists while the firmware is not answering. The panel retains the last verified identity with an error in that case. If a device is unplugged and another identically named unit appears between polls, endpoint names alone cannot establish that it is the same physical unit; use Disconnect and explicitly connect the intended device again.

## Build and verification for maintainers

`desktop/scripts/build-windows.mjs` assembles a **fresh** output directory under the repository's `tmp/` directory. Its required inputs are an explicit Node v22.22.2 Windows x64 executable and the unmodified matching Node license:

```powershell
node desktop/scripts/build-windows.mjs --out <absolute-new-tmp-directory> --node <absolute-node22-executable> --node-license <absolute-node-license>
```

The builder uses already installed, pinned development dependencies; it does not install packages. It bundles the server, stages the panel and plugin manifests, copies the Windows runtime and native closure, and retains redistribution notices. `BUILD-MANIFEST.json` records source/runtime/dependency hashes and packaged files. Its native addon smoke check loads the dependency without enumerating or opening a device.

Run the desktop tests from this repository's `desktop/` directory with `node --test test/*.test.mjs`, using a shell that expands the test paths as needed. Device-service tests inject fake transports, so passing tests do not imply a physical FM-1 connection. Keep four results distinct in a release record: source/tests, self-contained package checks, actual Codex installation/panel lifecycle, and physical device identity/status acceptance.

## Alpha.4 offline package and installation

The new writer source passed **604 tests**: 80 desktop, 478 Site and 46 stock
SysEx, with no failures/skips. TypeScript, panel and production builds passed.
The packaged server passed modern and legacy MCP checks with an empty `PATH`;
all 127 installed alpha.4 files matched the package. See the
[writer receipt](../docs/evidence/windows-alpha4-offline-20261019.json).

Open a **new Codex chat** to activate installed alpha.4; the existing chat retained
its earlier alpha.3 server when checked. The alpha.4 native view and a physical
stock write are not yet accepted. All records below describe the earlier
connection-only releases and remain historical evidence.

## Verification recorded on 2026-10-19 (JST)

The current **alpha.3** acceptance checks used the installed Windows plugin in the current Codex chat. They did not use the hosted panel's browser MIDI permission route.

| Check | Observed result |
| --- | --- |
| Desktop test suite | **54 / 54 passed**, with no failures, skips or cancellations; `F:/dev/fm1/tmp/forge-windows-tests-20261019-alpha3.log`. |
| Existing Site tests | The previously recorded **466 / 466** result is unchanged; this acceptance check did not rerun or alter the hosted Site implementation. |
| Codex-managed local server | Version **3.4.0-alpha.3**, **12 tools**, `toolsError: null`, confirmed through the existing daemon control proxy. The inspection itself performed no device I/O; `F:/dev/fm1/tmp/forge-daemon-ws-status-20261019-alpha3.json`. |
| Current-chat MCP routing | `mcp__fm1_forge_windows` tools were available. `open_fm1_library` opened the Windows edition, then `connect_fm1_device({transport: 'stock-midi'})` returned `connected: true`, `identity: 'FM-1_015'`, `loader: false`, `lastError: null`, and `installationAvailable: false`. |
| Native Codex panel | Inspected MCP App tab **Fm1 Forge Windows MCP FM-1 Forge Windows**, with eyebrow **FM-1 Forge Windows plugin**. After Refresh, the heading read **FM-1 via stock MIDI · FM-1_015** and the badge read **Device connected**. The black interface was readable; no `NotAllowedError` appeared. Serial and update controls remained disabled. DOM-backed acceptance receipt: `F:/dev/fm1/tmp/forge-windows-native-panel-acceptance-20261019.json`. Screenshot: `F:/dev/fm1/tmp/fm1-forge-windows-connected-20261019.png`. |
| Physical-write boundary | Only stock identity/status was queried. No firmware write, bootloader entry or device reset occurred. The current native MIDI connection was left open for the user. |

The earlier `NotAllowedError` was observed in the separate hosted Forge tab (tab 8), which requests browser MIDI/SysEx access. It is not the result of the now-verified Windows view. See [the routing and acceptance record](../docs/WINDOWS_MCP_ROUTING_20261019.md).

### Historical alpha.2 / stage-e receipts

The final **alpha.2 / stage-e** package corrected the preview descriptions and retained the common-protocol Apache license/notice. Its implementation, package, installed cache and physical stock connection were rechecked separately.

| Check | Observed result |
| --- | --- |
| Desktop test suite | **53 / 53 passed**, recorded in `F:/dev/fm1/tmp/forge-windows-tests-20261019-alpha2.log`. |
| Site test suite | **466 / 466 passed**; `tsc --noEmit` also passed. The Site implementation remained unchanged during the final packaging correction. |
| Final staged package | Stage **e**, version `3.4.0-alpha.2`: **127 files, 91,340,399 bytes**. Bundled Node.js `v22.22.2` and native MIDI `3.8.1`. |
| Official SDK client compatibility | Strict SDK `2.3.1` checks passed for modern protocol `2026-07-28` and legacy protocols `2025-11-25` and `2024-11-05`. Metadata, file-handler and redistribution-notice checks passed; receipt `F:/dev/fm1/tmp/fm1-windows-package-verification-20261019-e.json`. |
| Self-contained launch and shutdown | Packaged MCP tests passed with an empty `PATH`; closing stdin reached EOF cleanup and process exit code **0**. |
| Local Codex plugin installation | CLI registration/install succeeded for `fm1-app-library@fm1-forge-windows`, version `3.4.0-alpha.2`, **enabled**, preserving the local plugin identity. All **127 installed-cache files** were verified against the final package. The existing private cloud plugin was not upgraded or replaced. |
| Physical FM-1 test from installed alpha.2 | The installed cache's bundled Node runtime, with empty `PATH`, performed stock read-only connect, identity refresh and disconnect. It verified **`FM-1_015`**, normal mode, with no reported connection error or administrator prompt. No upgrade command or firmware write was performed. Receipt `F:/dev/fm1/tmp/forge-windows-identity-report-20261019-alpha2.json`. |
| Windows binary dependencies | Read-only PE import and delay-import inspection found **no non-system DLL dependency** in packaged `node.exe` or the MIDI addon. No additional VCRUNTIME/MSVCP redistributable DLL is declared. The addon delay-loads the included `node.exe`; all other imported DLLs are Windows system components. |
| Native Codex panel at the alpha.2 checkpoint | Rendering was pending at that checkpoint. The later alpha.3 native-panel inspection above now records actual renderer and stock-connection acceptance. |

Historical alpha.2 / stage-e `BUILD-MANIFEST.json` SHA-256:

```text
4ddcdac2540f0b15468ae8ebff5a828c02d3415f75dc22d519e672181781649a
```

The historical alpha.2 distributable archive is `F:/dev/fm1/tmp/FM-1-Forge-Windows-3.4.0-alpha.2.zip`, **34,135,518 bytes**, SHA-256:

```text
4643b9b1db6f36ac441123afb3b5567bdf22b33a2ed9a0eb2c613ea7c7f93e3d
```

Earlier alpha.1/stage-c evidence is preserved separately: its 125-file, 91,326,054-byte package and 51-test desktop result remain historical receipts, not the current alpha.3 result. Earlier stage-d candidates also remain intact. Documentation edits do not modify those artifacts or the frozen final stage-e package.

The physical result qualifies this Windows machine's stock identity/status route through the installed package. It does not qualify clean-machine installation, other operating systems, serial/UBOOT, firmware transfer, flash readback or custom firmware installation.

Do not advertise the complete single-install firmware workflow until serial, UBOOT, reviewed stock/custom transfers, compiler distribution and clean-machine acceptance have been implemented and verified on every claimed platform.
