# Official OpenAI MCP Extensions SDK

`openai-mcp-extensions-0.2.0.tgz` packages the unmodified TypeScript SDK from
[OpenAI's official repository](https://github.com/openai/mcp-extensions/tree/0d606217705e0e71eb21fff009619b67b80611dc/typescript).

- Source revision: `0d606217705e0e71eb21fff009619b67b80611dc`
- SDK version: `0.2.0`
- Package SHA-256: `79a1cc9e6832f557ea9f46c8925fdbeb82ba80247a60824666b14cf90cf1b755`
- License: Apache-2.0, included in the package from the repository's root LICENSE.
- Preparation: upstream frozen-lockfile installation and upstream TypeScript
  build (including `scripts/package.mjs`); copy the unmodified TypeScript root
  package manifest, README, styles.css, built dist directory and official root
  LICENSE into a temporary package directory, then `npm pack --ignore-scripts`.
  No SDK source or runtime changes were made. The official root manifest is
  retained because its declaration exports correctly target `dist/*.d.ts`;
  the upstream distribution packager currently emits invalid `*.d.d.ts` targets.

On 2026-10-11, the npm registry's latest version was still 0.1.0, while the
official source revision supplied SDK 0.2.0 with MCP SDK 2 and multi-round-trip
forms. A checked-in package makes the exact official source version available
to reproducible Site builds without depending on a mutable Git branch.

Forge uses the package's supported MCP Apps 1.7.5 and MCP SDK 1.29.0 app peers,
with MCP Server 2.3.1. The upstream SDK's 41 tests passed before packaging;
Forge's actual server, browser bundle and host behavior have their own tests.

To update, repeat the upstream build at a reviewed immutable revision and
replace the package, provenance, dependency lockfile and compatibility evidence
together. Do not edit the vendored SDK or install with forced peer overrides.
