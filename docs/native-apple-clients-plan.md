# Native Apple Clients (macOS / iPadOS / iOS) — Plan

> Status: **Draft / planning only**, not implemented yet.
> Goal: build native Nex apps with Swift and AppKit/UIKit for the Nex codebase (forked from ZCode 3.14.3).

## 1. What the codebase means for a native app

The app is layered, and only the top layer needs rewriting:

```
Agent runtime (apps/nex-cli, Node)     ← runs tools, shell, LLM calls
      ▲ stdio (Nex Protocol v4: topics, snapshots, deltas, wire fragments + crc32)
Host / Services (packages/services, server)   ← git, fs, terminal, MCP, plugins, providers…
      ▲ WebSocket /ws  (VS Code-style binary RPC: packages/rpc, ChannelClient/Server)
UI (packages/ui ≈ 172k lines of TSX, React + Zustand)  ← the part a native app replaces
```

**Recommendation: build native clients only. Don't port the agent or services to Swift.**

- **macOS:** the app runs the existing backend on the same machine. It can bundle the `nex` Node SEA binary as a helper, or manage the `nex-server-cli` daemon. It then connects over a localhost WebSocket or a unix socket.
- **iOS/iPadOS:** these can't run the agent (no subprocesses or shell), so they're purely remote clients. They connect to a Mac, a LAN or home server, or an SSH or Docker host running `nex --web` / nex-server. The existing "phone remote control" design (`web-remote-replayable`) already fits this.
- **Distribution:** the macOS app has to ship outside the Mac App Store, because the agent runs arbitrary shell commands and can't live in the sandbox. Use Developer ID and notarization, as for Electron today. The iOS app can go through the App Store.

## 2. Prerequisite work in the TypeScript repo (do this first)

The current wire format is internal and not stable enough to code a Swift client against. Five things need to happen first:

1. **A native gateway API.** Add a versioned, JSON-based facade (JSON-RPC over WebSocket) for native clients, instead of making Swift copy the VS Code channel RPC plus ~260 legacy protocol schemas.
2. **Swift types generated from the zod schemas.** Use `z.toJSONSchema()` and then quicktype to produce Swift `Codable` types, with a CI check that fails when they drift.
3. **Simpler v4 session streaming.** Either the gateway sends ready-made row snapshots and deltas, or `apply.ts`, `coalesce.ts` and `rows.ts` are ported to Swift and tested against shared JSON fixtures.
4. **Pairing and discovery.** The server advertises itself over Bonjour. Pairing works by scanning a QR code containing the token and a TLS certificate fingerprint. LAN connections use TLS with a pinned self-signed certificate.
5. **Push notifications.** Telling a phone that a task finished or needs a permission requires a self-hosted APNs relay. The relay only forwards messages and doesn't store business state, per the rules in `AGENTS.md`.

## 3. Features to build

### P0: MVP

| Area | Features |
|---|---|
| Connection | Local backend lifecycle (macOS), server list, QR pairing, Keychain token storage, reconnect/replay, protocol version check |
| Workspaces and tasks | Sidebar with workspaces; pinned, grouped, timeline and archived tasks; rename; new task; task status badges |
| Conversation | Streaming timeline (markdown, code, math), thinking blocks, tool-call blocks (bash output, file edit diffs, reads, search), queue panel, stop/interrupt, context usage |
| Composer | Rich input with `@file` mentions, `/` slash commands, image and file attachments (paste, drag and drop, camera on iOS), model and reasoning-level picker, plan/agent mode |
| Interaction | Permission dialog, elicitation dialog, workflow permission blocks |
| Settings (minimal) | Model providers and API keys, "Fetch model info" (models.dev), theme, language |

### P1: Workbench

- Diff and code review pane, with change summaries per message.
- File tree, file search, and file preview. QuickLook and PDFKit can replace the JavaScript docx, xlsx, pptx and PDF renderers.
- Git pane: status, stage, commit, branch switcher, graph.
- Terminal: a local PTY on macOS, or the remote terminal service.
- Remote workspaces over SSH, WSL or Docker (macOS; the server already handles deployment).
- Model trajectory viewer and conversation sharing.

### P2: Management

MCP servers, skills, the plugin store (following the terms in `CONTEXT.md`), hooks, commands, subagents, memory, automations and bots, usage stats, shortcuts, migration import.

### P3: Apple-platform features

- Notifications, a Live Activity or Dynamic Island for running tasks, and widgets.
- App Intents / Shortcuts ("Ask Nex in workspace X"), Spotlight, Handoff between Mac and iPad.
- macOS: a menu bar extra, multiple windows and tabs, Sparkle updates.
- iPad: Stage Manager multi-window, keyboard shortcuts via `UIKeyCommand`, pointer support.

### Keep in a WKWebView, at least at first

Whiteboard, workflow graphs (xyflow), treemap, Mermaid diagrams, the embedded browser (browser-use), and a fallback for any settings page not yet ported.

## 4. How the Swift code is organized

```
NexKit (Swift Package, shared by all targets)
 ├─ NexTransport   WebSocket (URLSession / Network.framework), unix socket, reconnect, TLS pinning
 ├─ NexProtocol    generated Codable types + request/response/event routing
 ├─ NexSessionCore v4 reducer → row models, drafts, optimistic overlay (pure Swift, tested with fixtures)
 ├─ NexStore       observable app state + GRDB offline cache
 └─ NexRender      markdown → NSAttributedString, syntax highlighting, diff model
NexMac   (AppKit)  NSSplitViewController with 3 columns, NSToolbar, NSTableView timeline, NSTextView composer
NexTouch (UIKit)   UISplitViewController (iPad) / navigation stack (iPhone), UICollectionView with diffable data source
NexBackendHelper   (macOS only) bundled Node/`nex` binary, launchd/XPC management, entitlements (allow-jit)
```

Settings forms are a lot of screens that don't need custom behavior. Hosting SwiftUI views for them inside AppKit/UIKit would save a lot of time.

## 5. Open-source projects that can be used

These are all permissive licenses (MIT, BSD or Apache), so they're compatible with Apache-2.0.

| Need | Project |
|---|---|
| Terminal | **SwiftTerm** (AppKit and UIKit, local PTY on macOS) |
| Markdown parsing | **apple/swift-markdown** (cmark-gfm) |
| Streaming markdown views | **Lakr233/MarkdownView** (UIKit, used by FlowDown), **gonzalezreal/Textual** (SwiftUI) |
| Math | **SwiftMath** (native LaTeX); KaTeX in a web view as a fallback |
| Syntax highlighting | **SwiftTreeSitter + Neon** (ChimeHQ), or **Highlightr** (highlight.js through JavaScriptCore) |
| Code view/editor | **CodeEditSourceEditor** (macOS), **Runestone** (iOS/iPadOS) |
| SSH tunnel on iOS | **Citadel** / **swift-nio-ssh** (connect an iPad to a server over SSH) |
| Local database | **GRDB.swift** |
| Keychain | **KeychainAccess** |
| Utilities | **swift-collections**, **swift-async-algorithms**, **swift-log**, **Nuke** (images) |
| macOS updates | **Sparkle** |
| Code generation | **quicktype** (JSON Schema → Swift) |
| Built into the OS | QuickLook, PDFKit, VisionKit QR scanner, Network.framework `NWBrowser` (Bonjour), UserNotifications, ActivityKit |

**STTextView** is a good TextKit 2 editor, but it's GPL or commercially licensed, so avoid it.

Reference projects for architecture and UI (check each license before copying any code):

- **CodeEdit**: a native macOS IDE built with AppKit and SwiftUI.
- **FlowDown**: a UIKit/Catalyst LLM chat app with good streaming rendering.
- **slopus/happy**: a mobile remote client for coding agents, with a relay and end-to-end encryption.

## 6. Suggested phases (rough estimates for one person)

| Phase | Scope | Estimate |
|---|---|---|
| 0 | Gateway API, schema-to-Swift code generation, pairing, Bonjour (TS repo) | 2–3 wk |
| 1 | NexKit + macOS MVP (P0) against a local backend | 5–7 wk |
| 2 | iPad/iPhone P0, pairing, reconnect/replay, notifications | 4–5 wk |
| 3 | Workbench (P1) | 6–8 wk |
| 4 | Management pages (P2), mostly SwiftUI forms | 4–6 wk |
| 5 | Apple-platform features (P3) | ongoing |

## 7. Main risks

- **Protocol churn.** v4 is still changing and the legacy protocol hasn't been removed yet. Without the gateway and generated types, the Swift client will keep breaking.
- **Streaming performance.** Long timelines that grow while the model is still writing need careful cell reuse, sizing and cached attributed strings. This is the hardest native UI problem here.
- **Keeping two UIs in sync.** Every web feature would also need a native version. Decide whether the web UI stays the main one and native covers only a subset, or the other way round.
- **Bundling Node on macOS.** Hardened runtime and JIT entitlements need handling, notarization has to cover the helper binaries, and the bundle gets bigger.

## 8. Open decisions

1. Should the native apps replace Electron entirely, or run alongside it, with Electron and web keeping the full feature set?
2. Should iOS target the App Store, or only TestFlight or personal install?
3. A native gateway facade on the server, or should the Swift client use the existing RPC and v4 protocol directly?
4. Is push notifications through a self-hosted APNs relay in scope?
