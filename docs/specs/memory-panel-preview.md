# Spec: Memory file preview in workspace side pane

Status: accepted
Owner: packages/ui (workspace side pane + settings memory section)
Related: `docs/desktop-vs-web-capability-gap.md` (A-class gap: memory detail visibility)

## Behavior

- Settings → Memory file list rows are clickable on both desktop and web.
  Clicking a row opens (or focuses) a workspace side pane tab that renders the
  memory Markdown file.
- The preview uses the shared workspace side pane (`WorkspaceSidePaneTab`),
  same residency/lifecycle rules as `plan-detail` tabs: tab state lives in the
  workspace-keyed side pane store, content is not persisted across app restarts.
- Desktop keeps the existing "open with editor / file manager" buttons
  (`WorkspaceEditorButtonGroup`); the preview is additive.
- Web gets preview as its only read surface (editor buttons are already
  absent there).

## Ownership & data flow

- Single data owner: `IMemoryService` on the local Host (desktop host process
  or `nex serve` server process). The renderer never reads memory files
  directly.
- Fetch path: pane component calls
  `memoryService.readProjectMemoryFile({ workspaceId, fileName })` per open;
  the result is render-local state (not a store). A stale response after
  switching files is discarded by request id.
- Render path: `MessageResponse` (same markdown stack as conversation
  messages). No links/mermaid side effects beyond what MessageResponse already
  guards.

## Invariants

- Read-only: no UI in the preview writes memory content.
- Backend contract unchanged: size limit (5MB) and
  `PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED` error surface as a user-visible
  message with the desktop editor buttons as fallback.
- The pane tab id is structured (`memory:<workspaceId>:<fileName>`) so a
  second click on the same file reuses and focuses the existing tab.
- File row click area excludes the editor-button zone on desktop so the two
  affordances never conflict.

## Failure semantics

- Load error (including oversized file): inline error state inside the pane;
  tab stays open; refresh via tab retry button.
- File deleted between listing and preview: `ENOENT` renders the same inline
  error state.

## Acceptance scenarios

1. Desktop: click a memory file row → side pane opens with rendered
   markdown; editor buttons still work.
2. Web: click a memory file row → same pane opens with rendered markdown.
3. Clicking the same file again focuses the existing tab instead of
   duplicating it.
4. Oversized file (> 5MB) → inline error message in the pane.
5. Search filter still applies to the list; preview is unaffected.
