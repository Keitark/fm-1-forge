---
name: fm1-forge-setup
description: Open and verify the self-contained FM-1 Forge desktop plugin with automatic Windows or macOS runtime selection.
---

# Set up FM-1 Forge desktop

1. Confirm the installed plugin is FM-1 Forge desktop and inspect its advertised MCP tools. One package selects Windows x64, macOS arm64 or macOS x64 automatically.
2. Open the native panel through its opening tool and keep it beside the active chat when requested. The selected server may identify itself as FM-1 Forge Windows or FM-1 Forge macOS.
3. Verify passive desktop status without opening MIDI. Device enumeration or connection requires a user request; successful startup alone does not establish an FM-1 connection.
4. Use the bundled runtime and native MIDI component. No separate Node, Python, persistent helper or browser MIDI/SysEx permission is needed.
5. Preserve the host-provided `PLUGIN_DATA` directory, existing projects, settings and recovery attempts. Do not migrate or delete another installed edition automatically.

Unsupported platforms, missing payloads and device/transport failures must remain visible. Do not substitute another MIDI port or remove identity checks. Linux, Windows arm64, USB serial and UBOOT writes are unsupported.

Let users configure USB, HAL, modules and tweaks, then save a project or request a build. For separately authorized programming, require explicit confirmation of the exact reviewed device and official V15 or custom FWSC package in the appropriate panel section. A custom FWSC also needs its matching build manifest and exact post-boot identity. Preserve uncertainty guards and original-attempt recovery. Do not flash, reset or enter a bootloader merely to verify installation.
