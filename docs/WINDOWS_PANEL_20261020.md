# Windows panel refinement - 2026-10-20

FM-1 Forge Windows **3.4.0-alpha.7** presents one active **Custom firmware
update · SysEx** section and a separate **Restore stock V15** section. The old,
inactive common-ARM update form and dialog are omitted from the Windows HTML.
The firmware-MIDI connection button remains available for read-only identity
and capability checks. The hosted browser edition retains its existing form.

While a read-only connection or writer-status poll is pending, file selection
uses the last confirmed connected device state. Users can choose the stock
package, custom FWSC and matching manifest without the chooser flickering
between enabled and disabled on every poll. Completed selections remain intact.
A confirmed disconnected reply disables these selectors. Interactive connect,
disconnect, review and transfer operations retain their existing locks; review
and install never gain permission from a background poll or a file selection.

The panel resource is `ui://fm1/forge-windows-v4.html`. Reopen the installed
Windows edition after Codex refreshes its plugin connection to load this view.
No firmware, device mode, saved project, appearance preference or recovery
record is changed by this UI update. Physical flashing is not part of the check.

Validation passed 500 Site tests, including 44 focused native updater UI tests,
and 26 server/package contracts. Three MCP revisions passed passive packaged
checks with an empty PATH; all 127 installed file hashes matched. See the
[machine-readable receipt](evidence/windows-alpha7-panel-20261020.json).
