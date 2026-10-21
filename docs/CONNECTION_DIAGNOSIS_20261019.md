# FM-1 native connection diagnosis — 2026-10-19

Windows reports present, healthy FM-1 Midi and FM-1 Audio interfaces at USB
VID 4C4A / PID C755. This is the stock MIDI/audio profile, not the custom
CDC profile (3654:5155). Use Connect stock MIDI for this device. The USB serial
button requires supported custom CDC firmware; firmware MIDI requires the new
common identity. Selecting firmware modules changes a project draft, not the
firmware installed on the device.

The live native panel reports a failed MIDI/SysEx request before MIDI port
enumeration or a firmware identity query. Codex's host log independently records:

```text
[mcp-app-sandbox] mcp_app_sandbox.permission_blocked permission=midiSysex
```

Repeated matching events occurred October 19 at 02:21:27–02:21:32 JST
(October 18, 17:21:27–17:21:32 UTC). This directly establishes a native host
permission block and explains the missing permission prompt. It does not establish
whether plain MIDI without SysEx is allowed. Neither iframe policy reporting
`midi: allowed` nor JavaScript API presence is a permission grant.

Both stock and common updater connections request `{sysex: true}`. Their prior
catch clauses discarded every native exception, so the old generic permission
message alone could not identify the cause. The diagnostic correction retains
only allowlisted native error names and safe fixed context; arbitrary native
messages, paths and control text remain private. Existing failure codes and update
gates remain intact. It does not add permission support or bypass host policy.

Direct native SysEx connection remains blocked until the host supplies an allowed
permission path. No firmware write, host-security edit or background device helper
was performed for this diagnosis. The existing private Site and plugin identity
are preserved.


## Windows native route

The browser MIDI/SysEx denial recorded above belongs to the hosted Forge edition.
FM-1 Forge Windows alpha.3 uses the bundled native MIDI transport and passed the
stock V15 identity/status check in Codex on 2026-10-19. See
[Windows routing and panel acceptance](WINDOWS_MCP_ROUTING_20261019.md).
This checkpoint does not enable firmware writes.
