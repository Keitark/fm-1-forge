---
name: fm1-forge-setup
description: Open the native FM-1 Forge panel, connect directly through browser MIDI or serial, and configure firmware projects.
---

# Set up FM-1 Forge

Use open_fm1_library from the installed plugin. Keep its Site, plugin identity and private audience; the internal package remains fm1-app-library. Show the native MCP App rather than a website tab.

1. Inspect Direct device access. Available APIs and allowed document policy are not device permission, identity or transfer acceptance.
2. Let the user choose Connect USB serial, Connect stock MIDI or Connect firmware MIDI and grant browser device access. Normal hardware communication runs in foreground panel JavaScript. Do not install or start Python/Node bridge, relay or helper processes, or auto-open devices on startup.
3. Serial verifies a known FM-1 firmware identity and supports read-only status. Stock MIDI updating requires the exact local official V15 package, reviewed metadata and the panel's explicit confirmation. Keep package bytes in the browser. Unknown attempts require their original job/package; never automatically resume or repeat an upgrade.
4. Firmware MIDI is the experimental common-update path for firmware that exposes FM1_FORGE_001. Select its local manifest and matching .fwsc, then review their hashes and target identity. The backend defaults to installation unavailable; physical OTA-loader/layout/preservation qualification is pending. Do not enable the gate or treat it as an accepted flashing path. Stock and common updates share a same-origin lock and preserve unresolved attempts; they never automatically resume. The JavaScript design is portable across Windows/macOS/Linux subject to the native host's MIDI/SysEx support; Mac/Linux hardware acceptance remains unverified.
5. Configuration and Ask Codex to build request design/code work, not a device write. Preserve native settings, files, composer references and current/new chat choices with copy/download fallbacks.
6. Existing UBOOT uses mass storage, a protected standard WebUSB class. Treat it as manual recovery, not a working browser-only flash path. Old bridge transfers/imports are legacy workflows, not the normal panel.

Preserve rollback and uncertain transfer evidence. A ready package does not prove startup, display, sound or controls. Never call legacy app-only confirmation tools from chat. Read the companion Forge skill and repository instructions before builds or separately requested recovery.
