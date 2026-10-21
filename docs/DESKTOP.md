# FM-1 Forge: one desktop plugin

**3.4.0-alpha.9** provides one native Codex plugin for Windows x64, macOS Apple
Silicon and macOS Intel. The same installation includes all supported runtimes
and MIDI components. At launch, it selects the matching files automatically.
There is no separate Node/Python installation, helper service, browser MIDI
permission, architecture choice or first-run runtime download.

## Install from the desktop marketplace

Register the built desktop distribution, then install the single entry:

```sh
codex plugin marketplace add Keitark/fm-1-forge@desktop
codex plugin add fm1-app-library@fm1-forge
```

Open **FM-1 Forge** in a new Codex chat after plugin connections refresh. The
native server reports Windows or macOS so the selected backend can be inspected.
This is the local desktop distribution; the existing hosted Site is a separate
edition and does not install native code into a browser or remote executor.
The `desktop` branch contains verified built files; the source implementation
and review history remain on the development/main branches.

For an offline installation, download the **FM-1-Forge-Desktop-3.4.0-alpha.9**
artifact from the successful Verify run, extract its ZIP, verify the supplied
SHA-256, then extract the tar archive. Register the extracted marketplace:

```sh
codex plugin marketplace add /absolute/path/to/fm1-forge-desktop
codex plugin add fm1-app-library@fm1-forge
```

Keep the executable permissions stored in tar. Git distributions record the
same POSIX executable bits and disable text conversion so Windows clones retain
all package hashes. Both install routes use the same package bytes.

Existing Windows/macOS previews, hosted plugin, projects and recovery records
are not removed or migrated automatically. A new marketplace uses its own
host-provided `PLUGIN_DATA`. Avoid enabling multiple native editions against
the same device; keep original recovery evidence with its original installation.

## What runs automatically

The portable MCP configuration has one server, `fm1-forge`, with command
`./runtime/node` and argument `${PLUGIN_ROOT}/start.mjs`.

- Windows selects the adjacent reviewed `runtime/node.exe`.
- macOS executes `runtime/node`, a `/bin/sh` launcher using the fixed system
  `uname` to choose the included Apple Silicon or Intel Node runtime.
- `start.mjs` selects the matching intact native payload from the actual
  `process.platform` and `process.arch`. Environment or command-line target
  overrides are not accepted.

The launcher performs no downloads and opens no device. Codex owns its process
lifecycle. Native MIDI remains inside the selected payload and loads its own
matching prebuild. Unsupported systems fail with an installation error.

This uses the supported string command in portable `mcp.json`; it does not add
invented OS keys or install hooks. The behavior was checked against
[Codex 0.162.1 program resolution](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/rmcp-client/src/program_resolver.rs)
and the [portable plugin parser](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/codex-mcp/src/agent_plugin_config.rs).
See also [OpenAI desktop plugin packaging](https://developers.openai.com/plugins/deploy/desktop-only).

## Firmware scope

The native panel supports stock V15 identity/status, reviewed stock restoration,
and V15-to-custom FWSC installation with a matching manifest and exact build
verification. Programming still requires explicit review and confirmation.
Installation, panel opening and passive status do not connect, reset, flash or
enter a bootloader. Uncertain writes retain their original recovery attempt.

Actual FM-1 connection/flashing on macOS remains bench-pending. Linux, native
Windows arm64, common-firmware self-updates, native USB serial/UBOOT writes and
compiler distribution are outside this package's current support.

## Build and acceptance

Native CI builds Windows x64 and each Mac architecture using hash-pinned
Node v22.22.2 and MIDI 3.8.1. The assembler accepts exactly three matching
version/source closures, verifies every file, runtime pin, license notice and
Mac mode, and retains each native manifest unchanged. The outer manifest records
all payload hashes, launcher sources, source commit and POSIX modes.

```sh
node desktop/scripts/build-universal.mjs --out /checkout/tmp/fm1-forge-desktop/fm1-app-library --windows /checkout/tmp/native/win32-x64/fm1-app-library --macos-arm64 /checkout/tmp/native/darwin-arm64/fm1-app-library --macos-x64 /checkout/tmp/native/darwin-x64/fm1-app-library --source-revision FULL_40_HEX_COMMIT
node desktop/scripts/stage-universal-marketplace.mjs /checkout/tmp/fm1-forge-desktop
```

Assembly runs on POSIX to preserve executable bits. No native payload is
cross-compiled or accepted only from a copied executable. The resulting single
archive is installed on native Windows, Apple Silicon and Intel CI hosts using
Codex 0.162.1 in isolated profiles. Acceptance checks the installed copy, one
native MCP server, its 24 tools, panel resource and three SDK protocol revisions
with an empty PATH. It imports the MIDI addon without enumerating/opening ports
and never requests a model or firmware operation.

Each platform emits a `UNIVERSAL-VERIFICATION-<platform>-<arch>.json` artifact.
Publish the built `desktop` marketplace only after all native installation jobs
pass. Packaging/stdio acceptance is separate from physical FM-1 acceptance.
