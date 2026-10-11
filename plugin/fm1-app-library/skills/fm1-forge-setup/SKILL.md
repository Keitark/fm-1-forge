---
name: fm1-forge-setup
description: Set up FM1 Forge after installation, open its native panel, check extension capabilities and the local FM1 connection, and explain the first firmware workflow.
---

# Set up FM1 Forge

Use the installed FM1 Forge plugin. Discover its actual tool schemas and open
`open_fm1_library` to show the native MCP App. The internal package remains
`fm1-app-library`; do not create another plugin or substitute a website tab for
the native panel.

1. Check the current panel's Forge branding and connection. Request passive
   status and packages when needed, then inspect their original saved request
   IDs. A request being accepted is not proof of device readiness.
2. Show the user's native plugin settings and the panel's available extension
   actions: configuration drafts, file editing, composer references, chat
   context, current/new conversations and editable drafts. Features depend on
   the host's advertised capabilities. Do not claim an unavailable feature
   succeeded; retain the displayed copy/download fallback.
3. Explain that saved configuration drafts are design data. Saving or opening
   one does not create a local project directory, compile firmware or write
   the device. Read local repository instructions before any build.
4. For the first device workflow, install and verify the diagnostic baseline,
   test controls/LCD/audio, then create a new local firmware project using the
   HAL and USB recovery starter. Read the companion `fm1-app-library` skill for
   the protected transfer and generator workflow.

Keep the existing Site, plugin identity, private audience, saved jobs and local
bridge. Do not change permissions, start a firmware transfer, open the vendor
updater or send a new conversation message merely to demonstrate onboarding.
Firmware writes still require review of the exact package and the user's
confirmation in the native panel. Do not call app-only confirmation tools
from chat. Leave uncertain jobs available for inspection and preserve rollback.
