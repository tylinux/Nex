import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_SEARCH_TOOL_NAME } from "@nex/contracts";
import { createToolRegistry } from "../src/tool/registry.js";
import { searchToolDocuments, mcpNamespaceOf } from "../src/tool/tool-search-index.js";
import {
  collectActivatedToolNames,
  decodeToolSearchResults,
  encodeToolSearchResults,
} from "../src/tool/tool-search-activation.js";
import type { ToolEntry } from "../src/tool/types.js";
import type { RuntimeMessageEntry } from "../src/agent/message-history.js";

function entry(name: string, description: string, exposure?: "direct" | "deferred" | "hidden") {
  return {
    capability: description,
    metadata: {
      name,
      description,
      readOnly: true,
      destructive: false,
      concurrentSafe: true,
      sideEffectScope: "none",
      riskLevel: "low",
      needsApproval: false,
      ...(exposure ? { exposure } : {}),
    },
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    handler: async () => ({}),
  } as unknown as ToolEntry;
}

test("registry: hidden tools are neither declared, listed nor gettable", () => {
  const registry = createToolRegistry();
  registry.register(entry("A", "a", "direct"));
  registry.register(entry("H", "h", "hidden"));
  assert.deepEqual(registry.toContracts().map((c) => c.name), ["A"]);
  assert.deepEqual(registry.list(), ["A"]);
  assert.equal(registry.get("H"), undefined);
  assert.equal(registry.has("H"), false);
});

test("registry: deferred tools are declared by toContracts but listed as search documents", () => {
  const registry = createToolRegistry();
  registry.register(entry("mcp__github__read_issue", "Read a GitHub issue", "deferred"));
  registry.register(entry("Bash", "Run shell"));
  const docs = registry.listDeferredDocuments();
  assert.deepEqual(docs, [
    { name: "mcp__github__read_issue", description: "Read a GitHub issue", namespace: "github" },
  ]);
});

test("BM25 ranks name hits first and respects namespace and limit", () => {
  const docs = [
    { name: "mcp__github__read_issue", description: "Read a GitHub issue", namespace: "github" },
    { name: "mcp__github__create_pr", description: "Open a pull request", namespace: "github" },
    { name: "mcp__slack__post_message", description: "Post a Slack message", namespace: "slack" },
  ];
  const hits = searchToolDocuments(docs, { query: "read github issue", limit: 8 });
  assert.equal(hits[0]?.name, "mcp__github__read_issue");
  assert.equal(searchToolDocuments(docs, { query: "message", limit: 8, namespace: "github" }).length, 0);
  assert.equal(searchToolDocuments(docs, { query: "github", limit: 1 }).length, 1);
  assert.deepEqual(searchToolDocuments(docs, { query: "zzz", limit: 8 }), []);
  assert.equal(mcpNamespaceOf("Bash"), undefined);
});

test("activation block round-trips and ignores failed/other calls", () => {
  const text = encodeToolSearchResults([
    { name: "mcp__github__read_issue", description: "Read an\nissue" },
    { name: "mcp__slack__post_message", description: "Post" },
  ]);
  assert.deepEqual(decodeToolSearchResults(text), [
    "mcp__github__read_issue",
    "mcp__slack__post_message",
  ]);
  assert.deepEqual(decodeToolSearchResults(encodeToolSearchResults([])), []);

  const entries: RuntimeMessageEntry[] = [
    {
      message: {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "ok", name: TOOL_SEARCH_TOOL_NAME, input: {} },
          { id: "bad", name: TOOL_SEARCH_TOOL_NAME, input: {} },
          { id: "other", name: "Bash", input: {} },
        ],
      },
    },
    { message: { role: "tool", content: text, toolCallId: "ok" } },
    {
      message: {
        role: "tool",
        content: encodeToolSearchResults([{ name: "evil", description: "x" }]),
        toolCallId: "bad",
        isError: true,
      },
    },
    {
      message: {
        role: "tool",
        content: encodeToolSearchResults([{ name: "evil2", description: "x" }]),
        toolCallId: "other",
      },
    },
  ];
  assert.deepEqual([...collectActivatedToolNames(entries)].sort(), [
    "mcp__github__read_issue",
    "mcp__slack__post_message",
  ]);
});
