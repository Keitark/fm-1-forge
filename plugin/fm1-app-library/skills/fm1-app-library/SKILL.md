---
name: fm1-app-library
description: Open FM1 Forge in its native plugin panel, inspect hardware and saved transfers, configure firmware drafts, use native settings and project files, attach composer references, or create and build a custom firmware project.
---

# FM1 Forge

Use this installed plugin's MCP tools and interactive panel. Discover actual tool schemas before calling them. The existing internal package name and endpoint remain fm1-app-library; the displayed product is FM1 Forge. If tools are unavailable, report the actual connection limitation and use the supported host connection flow.

## Inspect and install diagnostics

Open `open_fm1_library`. Request passive inventory and package metadata with `get_fm1_status` and `list_fm1_apps`. Inspect saved request or job IDs with their corresponding tools. Never resubmit an operation to obtain its status.

The first workflow is Install diagnostics → Test hardware → New firmware project → Ask Codex to build. The diagnostic package uses catalog ID `factory-diag` and profile `diagnostics`, with live firmware identity `FM1-FORGE/1`. Its source profile is `forge-diag`. A ready card or relay delivery is not verified startup. The panel unlocks its project action only after the hosted service records this exact diagnostic job's successful write, full readback and serial startup. Physical LCD, keys, encoders, volume and sound still need a device check.

For a requested transfer, stage `prepare_fm1_switch` with the supported auto, serial or already_uboot entry method. The panel displays the exact package digest and consumes its one-use approval after the user's confirmation. Never call app-only confirmation tools from chat or bypass the protected writer. USB serial enters UBOOT; direct serial firmware COMMIT is not enabled. USB Audio Class provides sound playback/capture rather than a flash protocol.

The official update action stages a handoff to the locally pinned vendor updater, which accepts official `.fwsc` packages and handles MIDI/SysEx/OTA transitions. Opening it does not establish completion. Custom diagnostic application packages are not vendor `.fwsc` files.

## Create and build a firmware project

The module designer separates fixed CDC/UBOOT recovery, optional UAC, the shared HAL and the editable user module. Configuration downloads as `forge.json`; Ask Codex sends the reviewed configuration and user brief through the host's supported message action. If unavailable, copy the prompt.

In the FM1 source checkout, read `firmware/forge/README.md`, then use `firmware/forge/create_project.py` and `firmware/forge/build_project.py` with their actual current CLI. Do not invent source paths, build outputs or hashes. Create a new directory without overwriting active projects. Use the HAL for all 41 inputs, seven encoders, master volume, LCD and sound. Keep USB/system code separate and retain recovery.

Clock presets are `sdk-default` and opt-in experimental `sdk-320`; the latter is not established to exceed the actual default clock. LCD presets are `stock-dma`, `spi15-rgb444` and `spi30-rgb444`. Require clock/bus readback guards and a device test before claiming improved speed. Build and validate a candidate, prepare its offline transfer review, and wait for confirmation for that exact operation.

The pinned SDK uses `system_clock_set` for real clock changes; `clk_set` is a stub. `sdk-320` has a 53 MHz LSB and cannot be combined with the fast LCD presets, which require 60 MHz. The generator and panel reject that combination before a build.

## Appearance and progress

The default panel is opaque black with a plain background. Version-1 preferences migrate once to that requested default; later selections preserve optional palettes, patterns and custom colours. These preferences send no firmware command.

Report the authoritative saved job and progress separately from physical acceptance. Preserve unknown/failed jobs and rollback evidence. A compiled binary, screenshot, successful readback or advancing counter alone does not establish that all hardware works.

## Native extension workflow

The panel uses the official OpenAI MCP Extensions SDK. Discover the actual
schemas for settings, project drafts and native configuration forms before
calling them. Saving a configuration draft only saves design data in the
owner's library; it does not create a local directory, build or flash firmware.
The diagnostic baseline still gates the existing firmware project handoff.

Use native plugin settings for the owner's appearance and project defaults.
Composer mentions reference the owner's saved projects, packages or job data.
Opening a `.fm1-forge.json` file invokes the native Forge editor; host-managed
resources use opaque URIs, writable metadata and ETags. Do not turn those URIs
into local paths. Preserve unsaved edits when a resource changes or conflicts.

Attach or clear a reviewed configuration in chat context explicitly. Current
and new conversation actions distinguish sending a message from preparing an
editable draft. Never silently send a draft or open a new conversation merely
to demonstrate the feature. If the host lacks the required capability, keep
the panel's copy/download fallback and describe the limitation accurately.

Deep links navigate within the Forge panel; they do not approve a transfer.
Opening a local source file is a separate host capability and requires a real,
user-selected path. Do not invent paths to cloud drafts or build artifacts.
