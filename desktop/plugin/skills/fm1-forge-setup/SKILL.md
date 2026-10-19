---
name: fm1-forge-setup
description: Open and verify the bundled Windows FM-1 Forge plugin without a separate runtime installation or helper service.
---

# Set up FM-1 Forge Windows

1. Confirm the installed edition is **FM-1 Forge Windows** and inspect its advertised MCP tools.
2. Open its native panel through the installed plugin's opening tool. Keep that panel beside the active chat when requested.
3. Check the local desktop transport status and enumerate MIDI devices only when requested. The packaged process contains Node and the Windows native MIDI dependency; no separate runtime or persistent helper is needed.
4. Treat an absent device, host permission block, transport error, or disconnected cable as a visible state. Do not silently substitute another MIDI port or remove update/recovery checks.
5. Let the user configure USB, HAL, user modules and tweaks, then save a project or ask Codex to build. A saved draft is not a flashed firmware image.

Settings, projects and recovery records belong in `PLUGIN_DATA`, never the installed package. Do not edit installed cache files to repair a source package. Do not flash, reset, enter a bootloader, send arbitrary SysEx, or change an active firmware project merely to verify installation.
