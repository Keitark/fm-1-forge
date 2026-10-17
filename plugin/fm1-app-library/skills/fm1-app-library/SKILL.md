---
name: fm1-app-library
description: Use FM-1 Forge for direct browser MIDI/serial, reviewed stock updates, graphical firmware modules and Codex build requests.
---

# FM-1 Forge

Open open_fm1_library from this installed plugin. Discover actual tool schemas for cloud settings, projects and file resources. Keep the existing private Site, plugin identity and saved work. The internal package remains fm1-app-library; the displayed name is FM-1 Forge.

## Direct device connection

Normal hardware access is foreground panel JavaScript. No Python/Node helper process is required. Do not start the old bridge/relay or install a runtime to demonstrate this flow. API/policy checks are separate from permission, device identity and transfer acceptance.

The user explicitly selects browser serial or stock MIDI access. Serial accepts only FM-1 USB IDs and known HELLO replies. It exposes fixed read-only status commands, not arbitrary commands, STOP, UBOOT or flashing. Do not add sampled key/knob activity.

Stock updating accepts only the unmodified official V15 .fwsc: 699,956 bytes, SHA-256 db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a. Select and check it locally; never upload firmware bytes/device paths to Sites, MCP or chat. Review digest, size, identity and selected MIDI pair before the panel confirmation. Durable IndexedDB state and a shared Web Lock are mandatory before upgrade; no memory-only downgrade, automatic retry or different-job resume. Completion and FM-1_015 reboot identity do not establish full readback or physical LCD/audio acceptance.

Custom firmware may have CDC but no stock MIDI. A stock restore is then required before SysEx updating. Existing UBOOT uses mass storage and remains manual recovery because standard WebUSB protects its interface class.

## Configuration and builds

The graph separates required CDC/UBOOT recovery, optional UAC/UVC, selectable HAL access and the user module. HALs default enabled. New projects retain SDK-default CPU, previously measured at 360 MHz; no new clock-tweak choice. Explicit legacy sdk-320 imports remain compatible with their stock-DMA restriction. LCD choices are stock DMA and 15/30 MHz RGB444. Optional UVC is 256x240 YUY2 at 5 fps; ProTracker has earlier capture evidence, while a new Forge combination needs its own device acceptance.

Code/project requests do not require a cloud write receipt. Ask Codex through the host message action or copy/download the brief. A saved draft is design data, not a local directory, linked binary or installed image.

Read firmware/forge/README.md in the selected checkout, then use the actual create_project.py/build_project.py CLIs. Preserve active projects and validate packing, protected ranges and exact artifact hashes. Build-tool execution is distinct from a background device helper.

## Native UI and evidence

Keep the opaque black default and saved palettes/patterns. Keep connection text stable while the small indicator blinks, and change it only with confirmed device state. Preserve native settings, opaque file resources/ETags, composer references, model context and current/new chat/draft choices. Do not silently send drafts or create chats to demonstrate an extension.

Browser-native attempts and legacy bridge jobs remain distinct. Legacy APIs are backward compatible but not the normal device flow. Do not call legacy app-only confirmations from chat or clear loader/failure latches. Separately requested legacy recovery needs a fresh current-device read gate: the old protected worker's saved verified_preflight baseline alone does not prove current NOR contents.

Report source, host tests, linked candidates, writes/readbacks, runtime identity and physical acceptance separately. A binary, screenshot or advancing counter does not prove all hardware works. Preserve unknown jobs and rollback.
