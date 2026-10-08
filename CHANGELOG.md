# Changelog

All notable changes to Nex are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Docker: the image is now a single `nex-server` container that serves the API,
  WebSocket and Web UI from one process. It packages the prebuilt SEA binary
  and the matching web build on `debian:bookworm-slim` instead of copying the
  whole monorepo build tree, so it no longer carries `node_modules`, sources or
  build tooling (about 0.8 GB instead of 4.3 GB). The Dockerfile no longer
  compiles anything; `scripts/stage-docker-context.sh` prepares its input.

### Removed

- The `nex-web` (nginx) image, `docker/web-nginx.conf` and the `web` service in
  `docker-compose.yml`. `ghcr.io/tylinux/nex-web` is no longer updated; old tags
  stay available.

### Upgrade note

- `docker compose` users: the UI is now on port `3030` (was `8080`) and there
  is no `web` service. Behind a reverse proxy, forward `/ws` (with `Upgrade`)
  and `/api` to port 3030. Static assets are no longer gzip-compressed by nginx.

## [1.2.3] - 2026-10-08

### Added

- Web sign-in page: when `nex-server` has an access token, the browser is sent
  to `/login` until the token is entered, then returns to the page it asked
  for. The browser keeps only a random `HttpOnly` session cookie (30 days);
  sessions are stored hashed in `web-sessions.json` in the Nex config
  directory, survive a server restart, and are discarded when the token
  changes. Five failed attempts from one address lock sign-in for a minute.
  Opening `/?token=<token>` still signs in directly, and `?token=` keeps
  working for programmatic `/ws` and `/api` clients.
- Web: the first time you sign in, a one-time prompt offers to allow browser
  notifications for finished, failed or blocked tasks. Settings → Browser
  notifications now always shows the current state (Allow button, Allowed,
  blocked by the browser, or unsupported).

### Fixed

- Web: Pinned and Timeline tasks now appear in the sidebar. `nex-server` did
  not serve the window-controller channel, so pinned tasks vanished from the
  normal list without showing up under Pinned.
- Model settings: deleting a model no longer shows a notification, and adding
  models shows readable text ("2 models added to <provider>") instead of raw
  `{count, plural, ...}` markup.
- Server release assets are named with the version (`nex-server-<target>-vX.Y.Z`)
  instead of `alpha-<shortsha>`; `main` builds keep the short sha.

### Upgrade note

- A web client opened with a stale cookie from before this version is sent to
  the sign-in page once; entering the token again is enough. The old
  `nex_lite_token` cookie is no longer accepted.

## [1.2.2] - 2026-10-07

### Added

- Model display name: an optional per-model alias set in the model editor
  ("Model name") that the chat model picker shows as `Provider/Name`, so long
  IDs like `magpie/cst/claude/claude-sonnet-5-5` can read as
  `magpie/sonnet-5-5`. It defaults to the model ID, is display-only, and
  requests keep using the model ID.

### Fixed

- "Fetch model info" now resolves model IDs with several namespace levels
  (e.g. `cst/claude/claude-opus-5-5`), not just one.
- Adding several models from the "fetch from /v1/models" dialog now shows a
  single aggregated notification instead of one per model.

### Upgrade note

- A build that does not know about the model `name` field rejects a personal
  provider config containing it. Upgrade every build sharing the same data root
  (desktop app, `nex-server`) together; downgrading has the same effect.

## [1.2.1] - 2026-10-07

### Added

- Desktop pets (Codex-compatible format): an animated companion that lives on
  the desktop (transparent always-on-top window) and reflects the agent state
  across all open workspaces. Pet folders (`pet.json` + `spritesheet.webp`) go
  in `~/.nex/pets/`, managed from Settings → Pets. The pet can be dragged and
  thrown anywhere on screen (hold Alt to snap to an edge), looks at the cursor,
  has a right-click menu (Hide, Settings) and disabled placeholder buttons for
  new chat and voice, and its size and visibility (always / on demand with
  `Cmd/Ctrl+Alt+P`) are configurable. On web, the pet is an in-app floating
  widget instead of a system window.
- macOS menu bar icon: click it to show the main window (it is recreated if
  every window was closed); right-click for the same menu as the Windows tray.
- Settings → General → "Show icon in Dock" (macOS): turn it off to run Nex from
  the menu bar only. The Dock icon is only hidden once the menu bar icon exists.

### Changed

- App, installer and web icons now use the neutral black-and-white N.

### Fixed

- Web task notifications never appeared because nothing requested the browser
  permission. Settings now has a "Browser notifications" row with an Allow
  button, and clicking a notification focuses the tab and opens the task.
- `install.sh` finds `web/` in the release tarball layout, so a bare-metal
  install serves the web UI.

## [1.2.0] - 2026-10-06

### Added

- Codemode: a sandboxed `Codemode` tool that lets the model run a short
  JavaScript program (QuickJS-WASM) which calls other tools in parallel and
  returns only a budgeted summary to the model
- On-demand tool declarations: `ToolSearch` (BM25) and a history-derived
  declared set, so deferred tool schemas are sent only after they are found
- Per-server `exposure` and per-tool `toolExposure` (`direct` / `deferred` /
  `hidden`) for MCP servers, with a settings editor that has a per-tool
  dropdown list and search
- Settings switches for Tool Search and Codemode (both off by default)

### Fixed

- The web build can now save MCP server settings (via the `mcp-sync` RPC)

## [1.1.1] - 2026-10-05

### Added

- Cross-platform About dialog in the workspace help menu (was desktop-only via
  the native Electron window; web had no version surface). Shows the app
  version from the build-time constant, with the commit behind a details
  toggle, and the "Optimized for Apple Silicon" line only on desktop macOS
- Brand mark surfaces documentation (`docs/specs/brand-mark-surfaces.md`) and a
  test asserting every mark shares the same three-stroke geometry

### Fixed

- **Terminals in the SEA server**: `terminal.create` always failed with
  "nodePty.spawn is not a function". The SEA loader takes over the main
  script's `require()`, so node-pty's inlined native-addon probes failed with
  `ERR_UNKNOWN_BUILTIN_MODULE`; esbuild's `__commonJS` helper then returned a
  half-initialized cache on retry. The server now releases a self-contained
  node-pty package (JS + platform addon + darwin spawn-helper) from the SEA
  assets and loads it from disk via `createRequire`; verified end to end
  against the built darwin-arm64 binary
- Server install tarballs now carry the matching web build; `install.sh`
  deploys it next to the data dir and sets `NEX_WEB_STATIC_ROOT`, so a
  bare-metal install serves a version-aligned UI from the same process
  (previously the served assets could drift from the binary version)
- Brand mark geometry corrected to match the official app icon (equal-width
  parallelograms replaced by the folded-ribbon N), applied consistently across
  the About dialog, both boot splashes, the startup badge, and the draft
  empty state

## [1.1.0] - 2026-09-29

### Added

- Memory file preview in Settings → Memory: clicking a memory file row opens a
  right-anchored preview dialog inside the settings layer (previously desktop
  only offered "open with editor" buttons and web had no way to read memory
  content). Renders with the same markdown stack as conversation messages;
  oversized files (> 5 MiB) surface an inline notice matched by error code.
  Works on both desktop and web (#15)
- Server shipped as a self-contained SEA (single executable application)
  binary with a rolling `alpha-<shortsha>` release on main updates (#1, #14)
- Agent runtime resolution recovers node-pty from a fallback addon dir in
  embedded runtimes (#14)

### Changed

- Built-in model providers and model rules dropped from Nex; provider
  configuration is fully user-managed (#9)
- Provider settings now surface real fetch errors and retry transient network
  failures instead of failing silently (#10)
- Engine baselines kept while removing built-in providers (#11)
- Default plugin marketplace removed: no marketplace is preset anymore,
  `DEFAULT_PLUGIN_MARKETPLACES` is emptied and the store no longer shows the
  ZCode official CDN source (the CDN has no `/nex/` shard; the path 404s).
  Adding marketplace sources is preserved (git / GitHub / URL / local path,
  `.claude-plugin/marketplace.json` compatible)
- Migration in `ensureDefaultPluginMarketplaces`: leftover preset official
  marketplace records (`nex-plugins-official` and the pre-rename
  `zcode-plugins-official`) in `known_marketplaces.json` are dropped on read
- Removed the store catalog auto-refresh (`officialMarketplaceAutoRefresh`);
  it only served the removed official CDN marketplace
- Official plugin ids unified to `@nex-plugins-official` across
  `DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS`, `NEX_CUA_OFFICIAL_PLUGIN_ID`,
  `CANONICAL_CUA_PLUGIN_ID`, and UI references (suggested prompts / icons /
  builtin skill i18n), ~80 sites total; legacy `zcode-plugins-official` ids
  remain as compatibility aliases and are canonicalized on read
- Bundled capabilities (node-repl-host, browser-use) are unaffected: local
  seeding is independent of the marketplace list

### Removed

- The "Report issue" entry in task context menus (task list, grouped task
  rows, header overflow menu); feedback remains available via the feedback
  center, the chat error banner, and the session subscription error panel (#13)

### Fixed

- Server: fall back to homedir when the default workspace resolves to `/` (#8)
- Server: seed the lite token cookie on any `?token=` request; deploy routing
  fixed so `/` reaches the server and SPA fallback works (#1)
- Packaging: inject the auth token into the macOS LaunchAgent (#7)
- Server: prefer the monorepo agent bundle over a leaked env override in the
  dev runtime (#12); agent command resolution tests no longer depend on the
  real dist bundle

### CI

- PR checks, macOS DMG release (Developer ID signing + notarization + staple),
  server/web Docker images published to GHCR; edge images build on main
  pushes, versioned + latest only on tags
- Server SEA release pipeline: full CLI workspace build before asset
  collectors, packaging path fixes, short-sha tarball names
- pnpm store and Electron binaries cached in GitHub Actions

### Docs

- README now defaults to English (`README.md`); the Chinese version moved to
  `README.zh-CN.md`
- CHANGELOG entries rewritten in English

## [1.0.2] - 2026-09-28

Build and release:

- Gitea Actions: PR check pipeline (linux-amd64 runner)
- GitHub Actions: PR checks, macOS DMG release (Developer ID signing +
  notarization + staple), server/web Docker images published to GHCR
- Desktop auto-update switched to GitHub Releases (electron-updater GitHub provider)
- The Gitea repository mirrors main and tags to GitHub via push mirror

Docker:

- Added the root Dockerfile (server / web images) and docker-compose.yml;
  compose enforces `NEX_SERVER_AUTH_TOKEN` authentication

Fixes:

- CLI cross-workspace dependencies switched to the `link:` protocol, restoring `pnpm install`
- electron-builder signing now covers the embedded search tools (bfs/ripgrep/ugrep),
  fixing notarization rejections
- Desktop updater adopts the new DMG installer background artwork

## [1.0.0] - 2026-09-27

First standalone release, based on [ZCode](https://github.com/zai-org/ZCode)
v3.14.3 (Apache-2.0).

Branding and identity:

- Product renamed from ZCode to **Nex**: desktop identity is now
  `productName: Nex` / `appId: dev.nex.app`, Linux executable name `nex`
- Runtime contracts renamed across the board: 34 packages `@zcode/*` → `@nex/*`,
  environment variables `ZCODE_*` → `NEX_*` (284 occurrences), URL scheme
  `zcode://` → `nex://`, preload bridge `window.zcode` → `window.nex`,
  RPC channels and protocol literals `zcode-*` → `nex-*`
- CLI: `zcode` → `nex` (bin, process name, SEA artifact)
- New icon master set: nine PNG sizes, macOS icns, multi-size Windows ico
  (including tray), web favicon

Data migration:

- Data directory `~/.zcode` → `~/.nex`: automatic atomic rename migration on
  first resolution (workspace-level `.zcode` directories remain compatible)

Trimmed and removed:

- Removed all telemetry egress: warehouse analytics (zcode.z.ai), Alibaba Cloud
  ARMS RUM, OTLP traces/metrics; deleted `@arms/rum-electron` and seven
  `@opentelemetry/*` dependencies; compile-time master switch off — no outbound
  calls in any environment
- Removed the ZCode account system: forced login gate on startup, forced
  re-login on JWT expiry, avatar menu (language/theme/UI mode moved to Settings;
  upgrade/connect entries removed), command-palette login/logout commands
- Provider login (OAuth) in the model settings page remains the only login path
- Removed the Settings onboarding pages (career onboarding + migration wizard
  entry) and the top-right help entry
- Removed the Zhipu-specific section from the model config page (preset
  providers / Coding Plan / Start Plan); provider templates are no longer
  grouped; the web client gained workspace memory detail view

Fixes and polish:

- Simplified the main-window footer to settings/back buttons
- Replaced the new-conversation background watermark "Z" with the Nex "N"
  outline (light inline SVG + dark gradient assets)

Known leftovers:

- The plugin marketplace still uses the `zcode-plugins-official` id and the
  z.ai CDN (addressed separately later — resolved in Unreleased)
- Model API / OAuth endpoints still point at Zhipu services
  (`bigmodel.cn` / `api.z.ai` / `zcode.z.ai`)
- The DMG installer background retains the original artwork
