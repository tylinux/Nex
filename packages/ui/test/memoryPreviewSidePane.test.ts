import assert from "node:assert/strict";
import test from "node:test";
import {
  openMemoryPreviewSidePane,
  type MemoryPreviewSidePaneTab,
} from "../src/lib/workspaceSidePane.js";
import { getSidePaneTabTitle } from "../src/app-shell/SidePaneTabTrigger.js";
import {
  getSidePaneTabSearchHint,
  getSidePaneTabTypeLabel,
  type SidePaneTabPresentationLabels,
} from "../src/app-shell/sidePaneTabPresentation.js";

const WORKSPACE_KEY = "/tmp/workspace-a";
const WORKSPACE_ID = "workspace-a-0123456789abcdef";
const FILE_NAME = "MEMORY.md";

function formatMessage(descriptor: { id: string }): string {
  const labels: Record<string, string> = {
    "settings.memory.preview.tabType": "Memory",
    "codeViewer.title": "Preview",
  };
  return labels[descriptor.id] ?? descriptor.id;
}

const presentationLabels: SidePaneTabPresentationLabels = {
  browserTitle: "Browser",
  reviewTitle: "Review",
  codeViewerTitle: "Preview",
  treemappingTitle: "Treemapping",
  whiteboardTitle: "Whiteboard",
  modelTrajectoryTitle: "Trajectory",
  memoryPreviewTitle: "Memory",
  developerToolsTitle: "Developer Tools",
  terminalTitle: "Terminal",
  subagentTypeLabel: "Subagent",
  subagentDirectoryTitle: "Subagents",
  selectionChatTitle: "Selection chat",
  planTitle: "Plan",
  workflowRunTitle: "Workflow run",
  workflowDirectoryTitle: "Workflow runs",
  workflowActorTitle: "Actor",
  workflowScriptTitle: "Script steps",
  workflowArtifactTitle: "Artifact",
};

test("openMemoryPreviewSidePane opens a tab with the structured id", () => {
  const next = openMemoryPreviewSidePane(null, {
    workspaceKey: WORKSPACE_KEY,
    workspaceId: WORKSPACE_ID,
    fileName: FILE_NAME,
  });
  const tab = next.tabs[0] as MemoryPreviewSidePaneTab;
  assert.equal(next.tabs.length, 1);
  assert.equal(next.activeTabId, tab.id);
  assert.equal(tab.type, "memory-preview");
  assert.equal(tab.workspaceKey, WORKSPACE_KEY);
  assert.equal(tab.workspaceId, WORKSPACE_ID);
  assert.equal(tab.fileName, FILE_NAME);
  assert.equal(
    tab.id,
    `memory-preview:${encodeURIComponent(WORKSPACE_KEY)}:${WORKSPACE_ID}:${FILE_NAME}`,
  );
});

test("openMemoryPreviewSidePane reuses the existing tab for the same file", () => {
  const first = openMemoryPreviewSidePane(null, {
    workspaceKey: WORKSPACE_KEY,
    workspaceId: WORKSPACE_ID,
    fileName: FILE_NAME,
  });
  const other = openMemoryPreviewSidePane(first, {
    workspaceKey: WORKSPACE_KEY,
    workspaceId: WORKSPACE_ID,
    fileName: "topic.md",
  });
  assert.equal(other.tabs.length, 2);
  assert.equal(
    other.activeTabId,
    (other.tabs[1] as MemoryPreviewSidePaneTab).id,
  );

  // 再次点击同一文件：复用 tab（不重复创建）并聚焦。
  const refocused = openMemoryPreviewSidePane(other, {
    workspaceKey: WORKSPACE_KEY,
    workspaceId: WORKSPACE_ID,
    fileName: FILE_NAME,
  });
  assert.equal(refocused.tabs.length, 2);
  assert.equal(refocused.activeTabId, (refocused.tabs[0] as MemoryPreviewSidePaneTab).id);
  assert.equal(
    refocused.tabs[0],
    other.tabs[0],
    "已有 tab 应原样复用，不重置 openedAt 等字段",
  );
});

test("memory preview tab title/search-hint/type-label resolve", () => {
  const next = openMemoryPreviewSidePane(null, {
    workspaceKey: WORKSPACE_KEY,
    workspaceId: WORKSPACE_ID,
    fileName: FILE_NAME,
  });
  const tab = next.tabs[0];
  assert.equal(getSidePaneTabTitle(tab, formatMessage), FILE_NAME);
  assert.equal(getSidePaneTabTypeLabel(tab, presentationLabels), "Memory");
  assert.ok(getSidePaneTabSearchHint(tab).includes(FILE_NAME));
  assert.ok(getSidePaneTabSearchHint(tab).includes(WORKSPACE_ID));
});
