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
After a completed tracker transfer, use `verify_fm1_custom_boot` with the original
job ID, or **Verify tracker boot** in the panel, to observe the same original
build without rewriting it. This bounded observation can run without another
Install confirmation. It records the original receipt, sends only a fresh
`FWINFO` challenge, and accepts no port, command or replacement build input.
A missing or mismatched proof remains
unresolved. This leaves common-firmware ARM/self-updates disabled.
Preserve shared stock/custom uncertainty guards and original-attempt recovery.
If the original unresolved custom attempt has returned to freshly identified
stock V15 before transfer completion, use **Prepare original recovery**. Review
the original saved hashes and explicitly confirm **Enter recovery loader**.
This state-changing preparation serves CHECK only and stops after identifying
the pinned OTA loader. It preserves the original job, phase and uncertainty.
Then reconnect stock MIDI, use **Review original custom recovery**, and require
a separate explicit confirmation before the application-write phase. Never
clear the original journal, substitute selected files or automatically continue
from loader preparation into WRITE.
Offline public-template layout preservation is not a live unit baseline check
or full flash readback; distinguish these from physical acceptance.

For an FM-1 already running the tracker, the Windows edition also provides the
separate **Tracker update · USB serial** route. Connect USB serial for a fixed
fresh `FWINFO` challenge; connection does not stop playback or enter recovery.
Select the generated tracker FWSC and matching JSON, then review the source and
target build digests. **Prepare recovery and read flash** requires an explicit
panel confirmation. It requests Windows administrator access for a plugin-owned,
hash-frozen worker, then stops playback and enters UBOOT. This uploads only
the pinned RAM helper and reads the complete live flash twice. Initialization
can change flash status/protection; this phase does not erase/program the array.

Use **Review application sector plan** next. Review the original job, live
baseline/candidate hashes and exact ordered sectors. A separate explicit
**Install reviewed application sectors** confirmation authorizes programming.
The protected worker preserves boot/configuration/reserved bytes, writes the
application directory sector last, and verifies per-operation and full final
readback before restart. A zero-change plan explicitly returns to the same
verified tracker without erase/program. Completion additionally requires its
exact target build over a fresh CDC challenge; physical screen/audio/control
acceptance remains separate.

Stock, custom SysEx and CDC routes share device ownership and unresolved-job
guards. Never clear a journal, substitute selected files, retry a write, choose
another transport or reset automatically. CDC recovery reuses only the original
job and existing protected worker session. If that session cannot be proven,
retain the blocked original record and report the required recovery handoff.
`get_fm1_cdc_update_status` is passive. `verify_fm1_cdc_boot` accepts only the
original completed/readback-verified job; it cannot program firmware. Prepare,
review and install tools are app-only and cannot accept a caller-selected port,
disk, sector, serial command or SCSI operation. No new USB driver, global runtime
or separately started helper is required. macOS does not expose this route.
