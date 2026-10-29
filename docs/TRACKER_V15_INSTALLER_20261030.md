# Stock V15 to tracker installer

The Windows native package adds a closed `protracker` FWSC profile. Stock V15
supplies the two MIDI OTA phases. After the transfer, the tracker exposes its
existing CDC, duplex USB audio and UVC screen interfaces. It does not need a
firmware MIDI endpoint. The `forge-diag` profile keeps its existing exact MIDI
identity and FMC1 family/build checks.

Only the pinned public V15 template is accepted. Packaging replaces the
application within its fixed slot, updates the existing lengths/CRCs and checks
preservation of boot/config/reserved spans and unused application tail. This
is an offline template check, not a readback of the connected unit. Generated
packages, private MOD content and unit data remain outside public Git.

The tracker manifest records `profile=protracker`, family9 and expected boot
identity `MOD-EDITOR/1`. The FWSC container still uses its existing encoding
product. The exporter requires a linked audited tracker with MIDI disabled,
UAC/UVC enabled, the immutable CDC contract, and matching source/archive/vendor
overlay digests. Unsupported profile mixtures are rejected.

The packaged Windows verifier is a bounded, hidden, one-shot PowerShell child
of the MCP process. It selects exactly one present USB3654:5155 interface0
serial port and sends only `FWINFO` with a fresh 16-byte random nonce. The
firmware returns `FM1FW/1 MOD-EDITOR/1`, its 32-byte build ID and that nonce.
Both sides check exact lengths/characters; success requires the reviewed build.
No general serial-command or flash API is exposed. Tracker admission is disabled
on native platforms without this verifier.

Select `firmware.json` and `firmware.fwsc` in the separate custom update section,
review the device and hashes, then explicitly choose **Install reviewed custom
firmware**. Transfer progress alone never reports success. Keep the device
connected through CDC verification.

If the transfer completed but the CDC check failed, **Verify tracker boot**
checks the identical original package/build again without any firmware write
or MIDI upgrade command. Partial transfers retain the existing explicit
original-attempt OTA recovery. Stock/custom unresolved guards remain shared.
If the device has returned to stock V15 before completion, use **Prepare
original recovery**, review the original saved hashes, and confirm **Enter
recovery loader**. This CHECK-only step stops before application programming.
Reconnect stock MIDI and separately review/confirm the original OTA recovery.
Selecting files again does not replace an unresolved original attempt.
Closing the process aborts verification and preserves uncertainty; a late reply
cannot overwrite it with success.

This is a local Windows preview. Offline package checks and mock transport
tests do not establish physical flash, audio, display or control acceptance.
