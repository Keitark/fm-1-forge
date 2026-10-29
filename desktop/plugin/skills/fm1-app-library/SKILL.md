---
name: fm1-app-library
description: Use the self-contained Windows FM-1 Forge plugin panel, local MIDI tools, project configuration and saved local app library.
---

# FM-1 Forge Windows

This edition runs its MCP server and reviewed MIDI transport from the installed plugin package. The package includes its Windows x64 Node runtime and native MIDI dependency. Do not install a global runtime, start a separate helper, edit the plugin cache, or redirect it to the hosted Site.

The packaged native MIDI adapter runs in a bounded child owned by the MCP
coordinator. The coordinator retains recovery evidence if that child fails.
Do not start that worker independently or retry an uncertain firmware command.
The USB-Midi OTA endpoint is accepted only with the pinned loader USB identity,
same-instance endpoint correlation and exact V15 loader response.

Open the Forge panel with its advertised opening tool. Inspect the installed server's available tools before choosing a device action. Its UI is served by that same local MCP server, with settings, projects and durable records in the host-provided `PLUGIN_DATA` directory.

Prefer the panel's desktop transport for MIDI inventory and reviewed device work. The native Codex MCP App sandbox currently blocks browser `midiSysex`; asking the user to grant browser permission again cannot override that host policy.

Inventory and connection status do not authorize programming. Review the exact package, destination, transfer method and expected result before an update. Preserve existing recovery gates and never infer a successful hardware write from packaging, tool discovery or a UI response. Keep firmware bytes and local paths local; do not copy credentials or device dumps into a release.

Keep graphical module drafts and local library entries intact when refreshing the view. Distinguish source/build verification, native transport availability, and physical FM-1 acceptance.


The Windows stock writer is scoped to the exact unmodified official V15 `.fwsc`.
Its upload, review, recovery and install tools are app-only. Have the user select
the package and explicitly confirm the reviewed device/hash in the panel. Never
infer confirmation from a connection or a build request. An uncertain attempt
must stay blocked until explicit recovery of that identical original attempt in
a freshly identified OTA loader. Stock support does not enable common/custom
firmware installation, arbitrary SysEx or UBOOT writes. A successful stock result
requires transfer completion and exact V15 reboot identity; full flash readback
remains unverified.


The separate custom FWSC route starts from stock V15. Use only a generated
`firmware.fwsc` and matching `firmware.json`; review both file digests and the
embedded target build before the user's explicit Install confirmation.
Diagnostic packages prove `FM1_FORGE_001` plus exact FMC1 build/family over MIDI.
The separate `protracker` profile uses stock MIDI only for installation, then
proves `MOD-EDITOR/1` and its exact immutable build over CDC with a fresh nonce.
Its bounded packaged verifier sends only `FWINFO`; it exposes no serial writer.
After a completed tracker transfer, use **Verify tracker boot** to observe the
same original build without rewriting it. A missing or mismatched proof remains
unresolved. This leaves common-firmware ARM/self-updates disabled.
Preserve shared stock/custom uncertainty guards and original-attempt recovery.
Offline public-template layout preservation is not a live unit baseline check
or full flash readback; distinguish these from physical acceptance.
