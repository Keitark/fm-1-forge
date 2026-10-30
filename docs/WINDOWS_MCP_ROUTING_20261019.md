# Windows MCP routing and native-panel acceptance

Recorded on **2026-10-19 (JST)** for installed **FM-1 Forge Windows 3.4.0-alpha.3**. This record supersedes the earlier native-panel-pending status; it does not qualify firmware installation.

## Verified route

The local plugin identity is `fm1-app-library@fm1-forge-windows`. Codex manages its bundled stdio MCP process and native Windows MIDI component. The native panel calls that process through `mcp__fm1_forge_windows`; it does not request browser MIDI/SysEx permission.

The current chat exposed the Windows tools. `open_fm1_library` opened the Windows edition, followed by the explicit read-only call:

```json
{"transport":"stock-midi"}
```

`connect_fm1_device` returned:

```json
{
  "connected": true,
  "transport": "stock-midi",
  "identity": "FM-1_015",
  "loader": false,
  "lastError": null,
  "installationAvailable": false
}
```

## Native panel inspected

The inspected MCP App was tab 1, titled **Fm1 Forge Windows MCP FM-1 Forge Windows**, with eyebrow **FM-1 Forge Windows plugin**. After the panel's Refresh action, its heading was **FM-1 via stock MIDI · FM-1_015** and its badge was **Device connected**. The interface had a readable black background. No `NotAllowedError` was shown. USB serial and firmware-update controls remained disabled.

DOM-backed acceptance receipt: `F:/dev/fm1/tmp/forge-windows-native-panel-acceptance-20261019.json`. It records the visible edition, heading and badge, and confirms that serial, stock installation and custom installation controls are disabled. Screenshot: `F:/dev/fm1/tmp/fm1-forge-windows-connected-20261019.png`.

The earlier message **MIDI/SysEx access request failed (NotAllowedError)** belonged to the separately installed hosted Forge view inspected as tab 8. That view uses browser MIDI/SysEx permission, which the host had denied. The successful Windows view uses the packaged native component instead; the hosted tab is not evidence that the Windows connection failed.

## Supporting verification

- The installed daemon reported server **FM-1 Forge Windows**, version **3.4.0-alpha.3**, **12 tools**, one resource and `toolsError: null`. The status inspection used the existing daemon control proxy, without creating a thread, starting a turn, reconciling plugins, refreshing connections or performing device I/O. Receipt: `F:/dev/fm1/tmp/forge-daemon-ws-status-20261019-alpha3.json`.
- Desktop tests passed **54 / 54**, with zero failures, skips or cancellations. Log: `F:/dev/fm1/tmp/forge-windows-tests-20261019-alpha3.log`.
- The previously recorded Site result remains **466 / 466**. This acceptance record does not claim a new Site test run.

## Acceptance boundary

The native stock MIDI connection was left open for the user. Only identity/status was queried: no firmware write, bootloader entry or reset occurred. `installationAvailable` remains `false`.

This confirms the current Windows machine's installed MCP routing, native-panel appearance and stock V15 identity/status path. It does not establish serial/UBOOT support, stock or custom firmware transfer, clean-machine installation, compiler distribution, or macOS/Linux support. The historical alpha.2 package hashes remain in [the Windows guide](../desktop/README.md).
