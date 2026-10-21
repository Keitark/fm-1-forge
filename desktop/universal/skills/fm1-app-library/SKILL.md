---
name: fm1-app-library
description: Use the bundled FM-1 Forge desktop panel, native MIDI tools, firmware configuration and local app library on Windows or macOS.
---

# FM-1 Forge desktop

This single plugin package automatically selects Windows x64, macOS Apple silicon arm64 or macOS Intel x64. Its runtime and native MIDI component are bundled. Do not install a global Node or Python runtime, start a separate helper, edit the installed cache, or redirect the native panel to the hosted Site. Linux and Windows arm64 are unsupported.

Inspect the installed server's advertised tools, then open Forge with its opening tool. The selected Windows or macOS server supplies the native panel. Settings, projects and durable records remain in the host-provided `PLUGIN_DATA` directory; preserve existing records when updating the package.

Use the desktop MIDI transport for requested inventory and identity checks. Browser MIDI/SysEx permission cannot override the Codex MCP App sandbox. Connection status, packaging, project configuration and builds do not authorize a firmware write.

For an authorized stock update, the native panel accepts only the exact unmodified official V15 `.fwsc`. Require explicit confirmation of its reviewed device and package hash. Preserve the original attempt and recovery evidence; never automatically retry an uncertain transfer or silently choose a different port.

For custom firmware, export the audited build using `tools/jieli-wl82/stock-sysex/package-custom.mjs`, then select its `firmware.fwsc` and matching `firmware.json` in the separate custom FWSC section. This path starts from stock V15 and requires explicit Install confirmation. Success must prove `FM1_FORGE_001` plus the exact FMC1 build/family. Common-firmware ARM/self-updates remain disabled.

Keep user files, recovery state and graphical module drafts local. USB serial, UBOOT writes, arbitrary SysEx and compiler installation are not exposed by this desktop package. Distinguish source/build tests, native transport availability and physical FM-1 acceptance; native package checks do not establish a successful hardware write.
