import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_SEARCH_TOOL_NAME } from "@nex/contracts";
import { getTools } from "../src/runtime/methods/config.js";
import { createToolRegistry } from "../src/tool/registry.js";
import { toolSearchToolEntry } from "../src/tool/handlers/tool-search.js";
import { encodeToolSearchResults } from "../src/tool/tool-search-activation.js";
import type { ToolEntry } from "../src/tool/types.js";
import type { RuntimeMessageEntry } from "../src/agent/message-history.js";

const GITHUB = "mcp__github__read_issue";

function tool(name: string, exposure?: "deferred" | "hidden"): ToolEntry {
  return {
    capability: name,
    metadata: {
      name,
      description: `${name} description`,
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

function fakeRuntime(entries: RuntimeMessageEntry[]) {
  const registry = createToolRegistry();
  registry.register(tool("Bash"));
  registry.register(toolSearchToolEntry);
  registry.register(tool(GITHUB, "deferred"));
  registry.register(tool("mcp__secret__x", "hidden"));
  return {
    registry,
    cachedTools: null,
    config: {},
    messageHistory: { borrowReadOnlyRuntimeEntries: () => entries },
  } as never;
}

const names = (runtime: never) =>
  getTools.call(runtime).map((contract) => contract.name).sort();

test("first request omits deferred and hidden schemas but declares ToolSearch", () => {
  assert.deepEqual(names(fakeRuntime([])), ["Bash", TOOL_SEARCH_TOOL_NAME].sort());
});

test("after a successful ToolSearch the next request declares the hit", () => {
  const history: RuntimeMessageEntry[] = [
    {
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: TOOL_SEARCH_TOOL_NAME, input: { query: "issue" } }],
      },
    },
    {
      message: {
        role: "tool",
        toolCallId: "t1",
        content: encodeToolSearchResults([{ name: GITHUB, description: "Read" }]),
      },
    },
  ];
  assert.deepEqual(names(fakeRuntime(history)), ["Bash", GITHUB, TOOL_SEARCH_TOOL_NAME].sort());
});

test("a hidden tool can never be activated, even if a result names it", () => {
  const history: RuntimeMessageEntry[] = [
    {
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: TOOL_SEARCH_TOOL_NAME, input: {} }],
      },
    },
    {
      message: {
        role: "tool",
        toolCallId: "t1",
        content: encodeToolSearchResults([{ name: "mcp__secret__x", description: "x" }]),
      },
    },
  ];
  assert.ok(!names(fakeRuntime(history)).includes("mcp__secret__x"));
});

test("ToolSearch is not declared when no deferred tool exists", () => {
  const registry = createToolRegistry();
  registry.register(tool("Bash"));
  registry.register(toolSearchToolEntry);
  const runtime = {
    registry,
    cachedTools: null,
    config: {},
    messageHistory: { borrowReadOnlyRuntimeEntries: () => [] },
  } as never;
  assert.deepEqual(names(runtime), ["Bash"]);
});
