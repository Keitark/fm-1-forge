# Native MIDI OTA recovery

The first tracker transfer reached `checking`, then its native coordinator
process exited. The durable original attempt remained active, with no recorded
write phase and `transfer_finished=false`. Windows subsequently exposed a
USB-Midi interface with VID4D4A/PID4155/MI00. This is enumeration evidence; the
loader still requires a fresh exact `ota-FM-1_015` identity before writing.

Host logs show the MCP transport closed. They contain no native exception or
exit code. The pinned MIDI addon nevertheless has a concrete unguarded C++
teardown path: Input.destroy calls WinMM closePort, whose buffer-unprepare
failure can throw outside the JavaScript catch. This matches the phase of the
failure but is not established as its actual cause.

The native package therefore contains MIDI operations in an owned child of the
MCP coordinator, using its bundled runtime and a closed bounded IPC protocol.
The coordinator owns the update journal. Native stdout cannot corrupt MCP
stdio. Unexpected child exit or timeout fails the operation without replay;
an explicit link close waits for the operating system to report child exit.
A teardown abort during that close cannot terminate the coordinator. No
independent helper service, network listener or general MIDI API is exposed.

The generic loader path accepts only a unique USB-Midi input/output pair whose
actual WinMM names/indices correlate to the same current USB instance, exact
VID4D4A/PID4155/interface00 and valid instance digest. Missing, changed or
ambiguous evidence fails. Generic stock selection remains separately restricted
to its existing policy. The loader must then answer the fixed read-only query
as `ota-FM-1_015` before a recovery review can reach a write.

Recovery uses the original saved job, package and build. It neither clears old
locks/latches nor replaces the candidate. A dead owner's exact original attempt
can be reclaimed only by the existing explicit recovery operation. The panel
requires a fresh loader connection, **Review original custom recovery**, then
the user's confirmation. A completed but unverified tracker transfer instead
uses the read-only **Verify tracker boot** path.

Mock/native-boundary and package checks remain separate from a successful
physical recovery and running tracker proof. Do not infer those from this fix.

## Original attempt returned to stock V15

Alpha 13 adds **Prepare original recovery** for an unresolved custom attempt
whose transfer has not finished and whose device freshly identifies as stock
`FM-1_015`. File selection does not create a new attempt or unlock normal Review.
Preparation uses only the original saved job, request digest, package, manifest,
profile and target build. The panel compares these original hashes and lengths
against the review. The server revalidates them under the original journal lock
at confirmation and binds the current stock endpoint to the original pair.

After **Enter recovery loader**, the runner sends one upgrade command and serves
only CHECK requests. It rejects WRITE_FINISH, requires exact `ota-FM-1_015`, and
stops before `entering_write` or a second upgrade command. CHECK changes device
state; this is not a read-only observation. The original journal phase and
uncertainty remain intact, with preparation progress in `loader_entry_stage`.
Failure, shutdown or a late result never reports installation success.

Reconnect with **Connect stock MIDI**, review the original custom recovery in
the freshly identified loader, and confirm that separate review before WRITE.
There is no automatic continuation, replacement job or manual lock cleanup.
Named MIDI endpoints provide a fresh identity and unique reviewed pair, not a
persistent cryptographic identity for an individual physical unit.
