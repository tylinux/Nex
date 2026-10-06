# How the Codex App ("ChatGPT" / `com.openai.codex`) Implements Desktop Pets — Reference Report

**Purpose.** Complete reverse-engineering report of the pet (a.k.a. "Mini" / avatar-overlay / mascot) system in the Codex desktop app, for use as a reference when implementing compatible pet features. All findings below are verified against the installed app, not guessed:

- App: `/Applications/ChatGPT.app` (bundle `com.openai.codex`, v26.930.51102 / build 13100, Electron 42.3.0, arm64). The app was renamed from "Codex" to "ChatGPT" (`CFBundleAlternateNames` still contains `Codex`; `BundleSigningBaseName = Codex`; `~/Library/Application Support/Codex/` and `~/.codex/` still used).
- Evidence: full `app.asar` extraction (`/tmp/codex-pet-report/asar`), main-process chunk `main-C7cfj__D.js`, shared chunk `bootstrap-CXJAEjVI.js`, renderer chunks `avatar-overlay-native-page-*.js` / `app-initial-*.js`, bundled Rust `codex` binary (`tui/src/pets/*` modules), native addon `sky.node`, `codesign` entitlements, and runtime window inspection via `CGWindowList`.

---

## 1. System Overview

The pet is **one feature of a larger "Mini" overlay system**. The window hosts:

1. The **pet sprite** (animated mascot, user-selectable).
2. **Pet controls** (a control row under the mascot).
3. Optionally a **Quick Chat bar** (small composer attached to the mascot) and a **notification tray** (activity/attention notifications).

Architecture in three layers:

| Layer                          | Where                                                                                                       | Responsibility                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main process                   | `avatarOverlayManager` class in `main-C7cfj__D.js` (logger scope `avatar-overlay`)                          | Owns the overlay `BrowserWindow`, window layout/anchoring, drag state machine, momentum physics, snap/dock, input-shape/mouse-passthrough, bounds persistence, native macOS bridges (non-activating panel, AppKit event drag) |
| Renderer                       | `avatar-overlay-native-page-*.js` (route `/avatar-overlay`)                                                 | Draws the pet sprite via CSS background-position animation, derives pet state from session/task state, runs the pointer gesture recognizer, sends `avatar-overlay-drag-*` IPC                                                 |
| Shared (also used by Rust TUI) | Pet format + install pipeline in `bootstrap-CXJAEjVI.js`; sprite grid spec in `app-initial-f9b16fbf8fc7.js` | `pet.json` manifest schema, spritesheet validation, directory layout under `~/.codex/pets/`                                                                                                                                   |

There is **also a terminal (TUI) pet** inside the Rust `codex` CLI (`tui/src/pets/{mod,model,asset_pack,picker,image_protocol,sixel}.rs`) with the _same_ on-disk format — the desktop app and the CLI share pets. The TUI renders with **Kitty graphics or Sixel** protocols and refuses to run in tmux ("Try a terminal with Kitty graphics or Sixel support, or run Codex outside tmux").

---

## 2. Pet Format (the compatible "spec")

### 2.1 Directory layout

```
~/.codex/pets/<pet-id>/
├── pet.json
└── spritesheet.webp      (or spritesheet.png)
```

- Also supports `~/.codex/avatars/<id>/avatar.json` as a legacy alias: the loader scans **both** `pets/` (manifest `pet.json`) and `avatars/` (manifest `avatar.json`), merging by id, deduped, sorted by `updatedAt` desc.
- The selected pet id is stored in `~/.codex/config.toml` under `[desktop]` as `selected-avatar-id = "pet_..."` (verified live on this machine). Ids prefixed `custom:` point at the local directory; `pet_…` ids are cloud-shared pets.
- Remote/cloud pets (installed from `chatgpt.com/pets/share/sharepet_<id>/sprite` URLs) are stored server-side; local install writes the same directory layout.

### 2.2 `pet.json` manifest schema (zod, exact)

```ts
{
  id?: string                  // optional, trimmed, min 1 — legacy fallback for displayName
  displayName?: string         // trimmed, min 1
  description?: string | null  // trimmed or null
  spriteVersionNumber: 1 | 2   // default 1
  spritesheetPath: string      // default "spritesheet.webp", trimmed, min 1
}
```

Additional runtime-computed fields (not in file): `id: "custom:<dirname>"`, `spritesheetDataUrl`, `updatedAt` = max(mtime of manifest, spritesheet).

### 2.3 Spritesheet — sprite grid spec (the critical part)

Two versions, **both are 8-column grids of 192×208 px cells**:

| Version | Atlas size      | Grid                            | Rows |
| ------- | --------------- | ------------------------------- | ---- |
| 1       | **1536 × 1872** | 8 cols × 192px, 9 rows × 208px  | 9    |
| 2       | **1536 × 2288** | 8 cols × 192px, 11 rows × 208px | 11   |

`requiredFramesByRow` (from the renderer's grid spec, version 2):

```
row 0: 6 frames   (idle)
row 1: 8 frames   (running-right)
row 2: 8 frames   (running-left)
row 3: 4 frames   (waving)
row 4: 5 frames   (jumping)
row 5: 8 frames   (failed)
row 6: 6 frames   (waiting)
row 7: 6 frames   (running)
row 8: 6 frames   (review)
row 9: 8 frames   (look-at-cursor, left half of ring)
row 10: 8 frames  (look-at-cursor, right half of ring)
```

Row order (verified from the renderer's frame table `zGa`): `failed`=row 5, `idle`=row 0, `jumping`=row 4, `review`=row 8, `running`=row 7, `running-left`=row 2, `running-right`=row 1, `waving`=row 3, `waiting`=row 6, plus look-row base 9.

Frame durations (ms; last frame of each row has a longer "settle" duration):

- idle (row 0): `[280, 110, 110, 140, 140, 320]`
- running-right/left (rows 1–2): 8 × 120, last 220
- waving (row 3): 4 × 140, last 280
- jumping (row 4): 5 × 140, last 280
- failed (row 5): 8 × 140, last 240
- waiting (row 6): 6 × 150, last 260
- running (row 7): 6 × 120, last 220
- review (row 8): 6 × 150, last 280

**Look-at-cursor ring** (v2 only): 16 frames split 8+8 across rows 9–10. Angle = `atan2(dx, -dy)` from the mascot's _center_; 16 sectors of 22.5°; frame = `round(angle/22.5) % 16`; `columnIndex = sector % 8`, `rowIndex = 9 + floor(sector/8)`. Ignored (falls back to idle) if the cursor is within 1 px of the center, or if `spriteVersionNumber != 2`.

**Non-looping animation rule**: for one-shot states (everything except `idle`), the renderer plays `[row ×3, then idle row]` with `loopStartIndex` pointing at the idle segment — i.e. the state animation plays 3 times, then settles into idle. `idle` itself loops with each duration ×6 (slow breathing loop).

### 2.4 Spritesheet validation (main process, `dB`/`_B`/`vB`/`yB`/`bB`)

- Pure header parsing, **no image decoding**:
  - PNG: magic + IHDR, width@16 BE, height@20 BE.
  - WebP: walks RIFF chunks; `VP8X` → 24-bit LE width/height (+1); `VP8L` → 14-bit packed fields from a 32-bit LE read at chunk+1 (`width = (bits & 0x3FFF)+1`, `height = ((bits>>14)&0x3FFF)+1`); `VP8 ` → keyframe signature `0x9D 0x01 0x2A` then 14-bit dims.
- Accepts **exactly** width 1536 and height 1872 (v1) or 2288 (v2). MIME must be `image/png` or `image/webp` → extension `.png`/`.webp`.
- The Rust CLI enforces the same: `"pet frame grid must cover spritesheet exactly"`, `"invalid pet spritesheet dimensions"`, `"spritesheet must be <dims>"`, `"pet frame grid width/height/count overflow"`.
- Official v2 sheets measured on disk: all 9 bundled sheets are **1536×2288 VP8L (lossless) WebP**, ~0.8–2.4 MB each. The community "bubu" pet (YaKun9/codex-pets) is also 1536×2288 VP8L — byte-compatible with the official format.

### 2.5 Install pipeline (from URL)

`PetInstallManager` (`Mhe`) in the main process:

1. **Deep-link entry**: `codex://pets/install?name=…&description=…&imageUrl=https://…&spriteVersionNumber=1|2`. Only whitelisted query params accepted; `imageUrl` must be `https:` (localhost https allowed); `spriteVersionNumber` ∈ {1,2} optional.
2. **Fetch** via Electron `net.fetch` with `redirect: 'manual'` — **redirects are rejected** ("Pet spritesheet redirects are not allowed").
3. Response `Content-Type` must be `image/png` or `image/webp`; size cap **20 MiB** enforced both via `Content-Length` and streaming byte count.
4. Header-parse + dimension-validate (above). If `spriteVersionNumber` is absent, try v1 then v2.
5. Install writes: `~/.codex/pets/<slug>/pet.json` + `spritesheet.<ext>`. Slug = kebab-case of the name, max **80** chars, truncated trailing dashes, fallback `pet`, de-duplicated with `-2`, `-3`… suffixes.
6. **Path traversal hardening**: `pet.json`'s `spritesheetPath` is resolved and must stay inside the pet directory (`relative()` check rejects `..`, absolute). The Rust binary has the same check ("spritesheet path must stay inside…", "pet spritesheet path should include an assets directory" for CDN packs).
7. Returns id `custom:<slug>`.

Cloud variant: if the URL matches `https://chatgpt.com/pets/share/sharepet_<id>/sprite`, install registers a shared pet against the user's ChatGPT account instead of writing local files.

### 2.6 Official pet catalog (renderer hard-coded, CDN fallback for TUI)

Desktop renderer bundles 9 official spritesheets as static assets (`webview/assets/*-spritesheet-*.webp`), all `spriteVersionNumber: 2`:

| id          | displayName | description                                    |
| ----------- | ----------- | ---------------------------------------------- |
| codex       | Codex       | The original Codex companion.                  |
| dewey       | Dewey       | A calm companion for focused workspace days    |
| fireball    | Fireball    | Hot path energy for fast iteration.            |
| hoots       | Hoots       | A sharp-eyed owl for polished work in a blink. |
| rocky       | Rocky       | A steady rock when the diff gets large.        |
| seedy       | Seedy       | Small green shoots for new ideas.              |
| stacky      | Stacky      | A balanced stack for deep work.                |
| bsod        | BSOD        | A tiny blue-screen gremlin.                    |
| null-signal | Null Signal | Quiet signal from the void.                    |

The Rust TUI instead downloads from `https://persistent.oaistatic.com/codex/pets/v1/…` (v4 sheets) and caches under `~/.codex/cache/tui-pets/` ("join pet spritesheet cache validation task", "join pet spritesheet install task").

---

## 3. How the Pet Is Displayed Over Other Apps

### 3.1 The overlay window (Electron `BrowserWindow`)

Created by `avatarOverlayManager.createWindow()` via the app's window manager:

```js
await windowManager.createWindow({
  title: app.getName(),
  width: 356,
  height: 320, // legacy viewport (Wp)
  appearance: "avatarOverlay",
  supportsWindowTiling: false,
  focusable: false, // never takes keyboard focus
  show: false, // shown later with showInactive()
  initialRoute: "/avatar-overlay",
});
// native draw mode uses a larger viewport Gp = { width: 384, height: 400 }
```

Then `setAlwaysOnTop(true, 'floating')` — and importantly, on macOS the window is layered at **`kCGWindowLayer = 3`** (verified live: the overlay window shows layer 3 while normal app windows are layer 0).

macOS-specific bridges via the `objc-js` module:

- `_setPreventsActivation:(true)` on the NSWindow — makes the panel **non-activating** so clicking the pet never activates/steals focus from the foreground app.
- `setCanHide:(false)` — the pet window **survives Cmd-H (Hide)** of the whole app ("Pet and Mini are independent of macOS Hide", verified flag `remainsVisibleWhenApplicationHides`).
- `_setForceActiveControls:` / `setNativeGlassForcesActiveAppearance:` — forces "active" visual appearance even though the window is not key.
- Every selector call is `respondsToSelector$`-guarded and degrades silently.

### 3.2 Mouse interactivity — the hard part of transparent overlay windows

The window is larger than the pet sprite (to host Quick Chat/tray). Two complementary mechanisms:

1. **`setIgnoreMouseEvents(ignore, { forward })`** — when the pointer is over dead space, the window is click-through with `forward: true` so the renderer still receives `mousemove` (to know when the pointer re-enters interactive regions). When over an interactive region, `setIgnoreMouseEvents(false)`.
2. **`BrowserWindow.setInputShape(rects)`** (`supportsInputShape = BrowserWindow.isInputShapeSupported()`) — when available, an OS-level input region is set from the renderer-reported element rects (mascot, controls, tray, quick-chat), and `setIgnoreMouseEvents` is disabled entirely. This is the preferred mechanism: crisp hit-testing without forwarding.
   - The renderer drives this: a `useFloatingWindowPointerInteractivity` hook tracks `mousemove`/`scroll`/`resize` + DOM `MutationObserver`, hit-tests `elementsFromPoint` against the interactive selectors, and reports `avatar-overlay-pointer-interaction-changed { isInteractive }` to main.

A three-state machine `mousePassthroughMode ∈ { 'disabled', 'forwarding', 'without-forwarding' }` avoids redundant calls; when the window is hidden it's fully non-forwarding (except a Windows workaround).

### 3.3 Layout model

- The manager keeps an `anchor` (centered rect of the mascot) + per-display work-area math (`rm()` layout function).
- Placement snapping: the release position is classified into one of 6 zones — `top-left, top-center, top-right, bottom-left, bottom-center, bottom-right` (`bm()`), then the window animates to that edge anchor (`xm()` with 16 px margins).
- Bounds are **persisted per display id and per resolution** (`byDisplayId`, `byResolution` maps in globalState) so the pet returns to a sensible spot after resolution changes; `reclampWindowToVisibleDisplay` re-clamps when a display disappears.
- Window size adapts to content: the renderer measures mascot / controls / tray / quick-chat elements and sends `avatar-overlay-element-size-changed`; main recomputes layout and window bounds.
- Pet size is user-adjustable: setting `petSize` (key `avatar-overlay-mascot-width-px`, default **112 px**, range **80–224**, int). Default mascot rect `Am = {width: 112, height: 121}` — note 192/208 aspect ratio.

### 3.4 Visibility modes

Setting `petVisibility` (key `pet-visibility`): `always-visible` (default) or `on-demand` ("Show with {shortcut}. Hide when you click away."). Related hidden setting `petVisible` (`avatar-overlay-pet-visible`) toggles just the mascot above its controls ("bar only" mode — "The lightweight codex companion"). In on-demand mode, showing the window makes it temporarily focusable and focused (with `setPendingAuxiliaryActivationTarget`), then it hides on click-away.

---

## 4. Dragging — Full Detail

This is the most sophisticated part. There are **two drag paths** plus **throw physics**.

### 4.1 Renderer gesture recognizer

On the mascot (and quick-chat bar):

- `pointerdown` (button 0, no ctrl, target not inside `.no-drag`): `setPointerCapture`, record a gesture object `{ pointerId, samples: [{x,y,screenX,screenY,timeMs}], screenX, screenY, hasMoved: false, beganOnQuickChatBar, usesOrbPhysics, quickChatClickTarget… }`, then IPC `avatar-overlay-drag-start { pointerScreenX, pointerScreenY, pointerWindowX, pointerWindowY, usesOrbPhysics }`.
- `pointermove`: push a sample; **dead-zone threshold of 4 px** in either axis before `hasMoved = true`. Once moved, IPC `avatar-overlay-drag-move { pointerScreenX, pointerScreenY }`. **Drag animation**: while dragging with orb physics disabled, the renderer overrides the sprite state to `running-right` when the pointer moves ≥ +4 px horizontally, `running-left` when ≤ −4 px (this is the "pet runs while you drag it" effect).
- `pointerup` / `pointercancel`: compute `releaseSample` + velocity, release capture, then IPC `avatar-overlay-drag-end { pointerScreenX, pointerScreenY, altKey }`; if `usesOrbPhysics` and velocity exists, also `avatar-overlay-drag-release { velocityX: v.x*3, velocityY: v.y*3, shouldBounce: true }`.
- **Click vs drag**: if the pointer never exceeded the 4 px dead zone, `pointerup` on the mascot fires the click action (analytics `CODEX_AVATAR_OVERLAY_ACTION_MASCOT_CLICKED`, opens/focuses the main window or quick chat).

**Velocity sampling** (`mf`/`hf`): keep only samples within a **160 ms** window; find the earliest sample that is ≥ 4 px away from the last; velocity = Δscreen / Δt (min Δt 8 ms); discard if speed < **320 px/s** (jitter); clamp to **1600 px/s**. Multiplied ×3 when sent as throw velocity.

### 4.2 Main-process drag state machine

`startDrag(webContentsId, pointer, usesOrbPhysics)`:

- Cancels any in-flight momentum and pending persistence; clears the dock-restore anchor.
- Computes the grab offset: `pointerWindowX/Y − mascotRect.left/top` → `DragState(pointerAnchorX, pointerAnchorY, displayBounds)`.
- **macOS native drag handoff**: if `layoutMode === 'native'` and the native drag target is registered and it's not a quick-chat/multi-display edge case, the first `drag-move` performs `Ere(window, pointer, allDisplayBounds)` → the **`sky.node` native addon** calls AppKit `performWindowDrag` with the window's native handle (`getNativeWindowHandle()`) and display bounds. From then on the OS drives the drag (`nativeWindowDragActive = true`); a 50 ms interval polls `isWindowDragActive` and ends the drag on button release. `finishWindowDrag` returns final bounds + altKey state. This gives perfect 120 Hz, Terminal-app-quality dragging with zero JS involvement.

`moveDrag`: if native drag didn't engage, main moves the window itself (`moveDragToPointer`) using `screen.getCursorScreenPoint()` (or the renderer-reported screen point) minus the grab offset. Movement intent cancels edge-stash and snap.

`endDrag(webContentsId, pointer, altKey, reason)`:

- If native drag: read final bounds from AppKit, `rememberMovedWindow` + persist.
- Else: final `moveDragToPointer`, then `reclampWindowToVisibleDisplay({shouldPersist:true})`.
- **Alt-drop override**: if `altKey` was held at release, the pet is placed _freely_ where dropped (`isFreelyPositioned = true`, no snap); otherwise it snaps to the nearest edge zone and animates there (`animatePresentationTo(petSnapAnchor)` with a spring), persisting after the animation.
- Dock targets: if the pet was released near a registered dock anchor, it magnetically docks (`shouldDock` check with an acceleration field toward the dock center).

`throwWithVelocity` → `startMomentum(vx, vy, shouldBounce)`: a **16 ms tick** rAF-style timer integrating position, with:

- Dock attraction acceleration while a dock target exists; snaps to dock when `shouldDock`.
- Per-display clamping; on hitting an edge with bounce, velocity flips at restitution **0.7** (`Hm`).
- Frame-rate-independent friction: velocity \*= `0.88^(dt/16ms)` (`Vm`).
- Momentum ends when speed < **65 px/s** (`Um`) or after **900 ms** (`Wm`), then bounds are persisted.

`suppressNextRendererThrow` prevents double-throw when native drag already imparted motion.

### 4.3 Persistence

`persistWindowBounds` stores `{ x, y, displayBounds, displayId, placement, isFreelyPositioned, snapPosition }` into globalState keyed **by display id and by resolution key** (only writes when the object actually changed). This is debounced/cleared during drags (`clearMovedWindowPersist`).

---

## 5. Pet State Machine (semantic states)

### 5.1 State derivation

The renderer derives the mascot state from **thread/task state** (function `$d`):

```
waiting  if: thread needs resume & runtime active-waiting, OR
           pending requestUserInput tool call (item/tool/requestUserInput), OR
           an incomplete planImplementation item
failed   if: resumeState needs_resume && runtime systemError, OR last turn status failed
running  if: resuming, OR turn inProgress (and last item isn't a sleep marker)
review   if: hasUnreadTurn (terminal state not yet read)
idle     otherwise
```

Cloud threads (function `ef`): `failed`/`cancelled` → failed; `in_progress`/`pending` → running; unread → review; archived → idle.

Priority for notification badges: `waiting(0) < failed(1) < review(2) < running(3) < idle(4)`.

State expiry (fallback to idle, from `im()`): `running` never expires; `failed` after **1 h**; `waiting` after **24 h**; `review` after **7 d**. The Rust TUI shows the same five states as _Thinking / Needs input / Ready / Blocked / Running_.

Transient/interaction states layered on top: `running-left` / `running-right` during drags; `jumping` on hover (`respondToHover` — pointerenter on the mascot swaps state to jumping); look-at-cursor frame override while the pointer is near.

### 5.2 Presentation composition

`Jp()`: `presentationActive && isAudioReady ? 'voice-orb' : 'pet'`; `isSessionActive && !petOpenIntent ? 'hidden' : 'pet'` — i.e. during realtime voice the mascot becomes a voice orb; during an active session without an explicit open intent it hides. `petOpenIntent` (17 uses in main) carries why the overlay was opened (explicit click vs. automatic).

The mascot also integrates with **global dictation** (Fn/Right-Control hold-to-talk): the pet window doubles as the dictation idle surface — `global-dictation-pet-renderer-ready` registers the pet's webContents; when dictation starts the pet shows the recording UI instead of a separate overlay window (`showNativePetIdleIfAvailable`). Accessibility trust is checked with `systemPreferences.isTrustedAccessibilityClient(true)` for the hotkey path.

---

## 6. Capabilities Summary (what the pet system can do)

| Capability        | Detail                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Animated states   | idle, running, running-left/right, waving, jumping, failed, waiting, review + 16-frame look-at-cursor ring (v2)             |
| Look at cursor    | 22.5° sectors, v2 sheets only, hover-gated                                                                                  |
| Hover reaction    | jumping animation on pointerenter                                                                                           |
| Drag with legs    | renderer switches to running-left/right while dragging                                                                      |
| Native drag       | macOS AppKit `performWindowDrag` via `sky.node` (setWindowDragTarget/performWindowDrag/isWindowDragActive/finishWindowDrag) |
| Throw physics     | velocity from ≤160 ms sample window, ×3 multiplier, friction 0.88^(dt/16), restitution 0.7, stop < 65 px/s or 900 ms        |
| Snap zones        | 6 edge zones, alt-drop for free placement, animated spring snap                                                             |
| Docking           | magnetic dock targets with acceleration field                                                                               |
| Multi-display     | per-display bounds, re-clamp on display removal, display-metrics listeners                                                  |
| Size control      | 80–224 px mascot width (setting + slider + reset in settings UI)                                                            |
| Visibility        | always-visible / on-demand (+bar-only lightweight mode)                                                                     |
| Notifications     | activity/attention tray above the pet with priority ordering and expiry                                                     |
| Quick Chat        | inline composer + dictation on the pet window                                                                               |
| Click action      | focus/open main window (non-activating panel so foreground app keeps focus)                                                 |
| Pet install       | deep link `codex://pets/install`, https-only, no redirects, ≤20 MiB, PNG/WebP, path-traversal-safe                          |
| Pet picker        | settings page: official grid + custom pets (preview card, Refresh, Create, Update, Open folder)                             |
| Create custom pet | "Create pet" button launches an image-generation flow (pet creation/upgrade)                                                |
| Cloud-shared pets | `chatgpt.com/pets/share/sharepet_…` linked to ChatGPT account                                                               |
| Terminal parity   | same format in Rust TUI with Kitty/Sixel render, picker UI, CDN cache                                                       |
| Survives app hide | macOS `setCanHide(false)`                                                                                                   |
| Dictation surface | pet window reused for global hotkey dictation idle/recording UI                                                             |

---

## 7. Permissions & Entitlements (what an implementation actually needs)

Verified entitlements of `com.openai.codex` (arm64, hardened runtime, notarized, Developer ID team `2DC432GLL2`):

```xml
com.apple.security.app-sandbox                  = false   ← NOT sandboxed
com.apple.security.cs.allow-jit                 = true
com.apple.security.cs.allow-unsigned-executable-memory = true
com.apple.security.network.client               = true
com.apple.security.device.audio-input           = true    (dictation)
com.apple.security.device.camera                = true
com.apple.security.files.user-selected.read-write = true
com.apple.security.automation.apple-events      = true
com.apple.security.personal-information.calendars = true
application-groups: 2DC432GLL2.com.openai.codex.notifications, 2DC432GLL2.com.openai.sky.CUAService
keychain-access-groups: 2DC432GLL2.*
```

**Key conclusions for a reference implementation:**

1. **No special entitlement is needed for the overlay itself.** Always-on-top (`setAlwaysOnTop(true,'floating')` → layer 3), transparent windows, `setIgnoreMouseEvents`, and `setInputShape` are plain Electron APIs. The "shows above other apps" behavior needs no private entitlement, no screen-capture, no accessibility permission.
2. **Non-activating + Hide-proof behavior** requires talking to AppKit (via `objc-js` or a small native addon): `_setPreventsActivation:`, `setCanHide:`, `_setForceActiveControls:`. All are private-ish selectors — guarded with `respondsToSelector` and optional.
3. **Native-quality dragging** on macOS uses a private-ish AppKit path through their `sky.node` addon (`performWindowDrag` on an NSWindow that is `nonactivatingPanel`-style). The pure-Electron fallback (renderer → IPC → `setPosition`) is what the app itself uses on Windows/Linux and works fine at 60 fps with coalesced moves.
4. **Accessibility permission** is only touched for the _global dictation hotkey_ path (`isTrustedAccessibilityClient`), not for the pet.
5. The app is **not sandboxed**, which is how it freely reads/writes `~/.codex/pets/`. A sandboxed implementation would need a user-selected folder or the app-group container instead.
6. Filesystem trust boundary: manifest-controlled `spritesheetPath` must be resolved-and-contained (they do `path.relative` containment checks; the Rust side additionally requires an `assets/` directory for CDN packs). Spritesheet download rejects redirects and non-image MIME.

---

## 8. Reference Implementation Checklist (for our port)

1. **Format compatibility (done in ZCode)**: read `~/.nex/pets/<id>/{pet.json, spritesheet.webp|png}`; zod-validate the manifest; VP8L/VP8X/VP8/PNG header parse without decode; accept 1536×1872 (v1) and 1536×2288 (v2) exactly; per-row required-frames table above; community sheets are VP8L — must parse the packed 14-bit fields, not VP8X.
2. **Renderer**: CSS `background-image` + `background-size: 800% (rows×100)%` with `background-position` in percentages (`col/(cols-1)*100%`, `row/(rows-1)*100%`) — percentage positioning avoids fractional-cell rounding; drive frames with a `setTimeout` chain using per-frame durations; idle loop ×6 durations; non-idle = 3× then idle; `data-codex-pet-state` attribute for a11y/tests; respect reduced motion (ZCode addition).
3. **Window**: `focusable: false`, `show: false` + `showInactive()`, `setAlwaysOnTop(true, 'floating')`, `supportsWindowTiling: false`, transparent; on macOS call `_setPreventsActivation:` and `setCanHide:` through a native bridge if available; exclude the pet window from "all windows closed → quit" logic; destroy it on real quit.
4. **Hit-testing**: prefer `setInputShape` when `BrowserWindow.isInputShapeSupported()`; otherwise `setIgnoreMouseEvents(true, {forward:true})` + renderer hover-region reporting. Ship a `useFloatingWindowPointerInteractivity`-equivalent hook (mousemove/scroll/resize + MutationObserver + `elementsFromPoint`).
5. **Drag**: renderer pointer capture + 4 px dead zone; screen-coordinate IPC `drag-start/move/end`; main `setPosition` following `getCursorScreenPoint()` minus grab offset; `running-left/right` animation override during drag; velocity from ≤160 ms samples, clamp 1600 px/s, ×3 throw; optional momentum with 0.88^(dt/16) friction and 0.7 restitution; snap-to-edge zones (6 zones, 16 px margin) unless Alt-dropped; persist per-display.
6. **State machine**: waiting > failed > review(unread terminal) > running > idle; expiry 1 h/24 h/7 d; hover→jumping; look-at-cursor only for v2.
7. **Install**: deep-link or settings-URL installer; https-only, `redirect: 'manual'`, MIME allow-list, 20 MiB cap, slug dedupe (80 chars), containment checks on the manifest path.
8. **Settings**: pet picker (official + custom grid), preview card with live animation, Refresh, Create (image-gen flow), Update, Open folder; size slider 80–224 (default 112); visibility always/on-demand.

## 9. Open / Not Reproduced

- The exact `sky.node` `performWindowDrag` AppKit implementation (closed addon; symbols confirmed via `strings`: `beginDragAtContentPoint:`, `mouseDragged:`, `draggingSession:*`, `finishWindowDrag`, `isWindowDragActive`).
- The cloud/shared-pet server API (`sharepet_` registration) requires a ChatGPT account flow — only the client side was reversed.
- `pets.json`-style CDN catalog at `https://persistent.oaistatic.com/codex/pets/v1/` returned 404 for the guessed path; the true manifest filename inside that prefix wasn't recovered (only the prefix string exists in the binary, concatenated in the string table).
