import assert from "node:assert/strict";
import test from "node:test";
import { getPromptContextEntries } from "../src/runtime/methods/prompt-context.js";
import type { ContextSection } from "../src/context/types.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";
import type { ModelToolContract } from "@nex/contracts";

function section(overrides: Partial<ContextSection>): ContextSection {
  return {
    name: "Section",
    source: "identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: 1,
    tokens: 1,
    content: "body",
    preview: "body",
    ...overrides,
  };
}

function tool(name: string): ModelToolContract {
  return { name, description: `${name} description`, inputSchema: { type: "object" } };
}

let fallbackTools: ModelToolContract[] = [];

function runtimeWith(
  sections: ContextSection[] | undefined,
  tools: ModelToolContract[] = [],
): AgentRuntimeInternal {
  return {
    latestRequestTools: tools,
    getTools: () => fallbackTools,
    latestContextBuildResult: sections && {
      sections,
      totalChars: 0,
      totalTokens: 0,
      systemMessages: [],
      metaUserAttachments: [],
    },
  } as unknown as AgentRuntimeInternal;
}

test("is empty before the first context build and request", () => {
  assert.deepEqual(getPromptContextEntries.call(runtimeWith(undefined)), []);
});

test("classifies sections like the context-usage breakdown", () => {
  const entries = getPromptContextEntries.call(
    runtimeWith([
      section({ name: "Identity", source: "identity" }),
      section({ name: "Skills", source: "skills", injectionTarget: "meta_user" }),
      section({ name: "Tools", source: "tools" }),
      section({ name: "Memory", source: "memory", injectionTarget: "meta_user" }),
    ]),
  );
  assert.deepEqual(
    entries.map((e) => [e.name, e.category]),
    [
      ["Identity", "system_prompt"],
      ["Skills", "skills"],
      ["Tools", "tool_prompt"],
      ["Memory", "meta_user_context"],
    ],
  );
});

test("lists the tools of the latest request, splitting MCP from built-in", () => {
  const entries = getPromptContextEntries.call(
    runtimeWith([], [tool("Bash"), tool("mcp__chrome-devtools__click")]),
  );
  assert.deepEqual(
    entries.map((e) => [e.name, e.category]),
    [
      ["Bash", "system_tool_schemas"],
      ["mcp__chrome-devtools__click", "mcp_tool_schemas"],
    ],
  );
  const [description, schema] = (entries[0]?.content ?? "").split("\n\n--- inputSchema ---\n");
  assert.equal(description, "Bash description");
  assert.deepEqual(JSON.parse(schema ?? "{}"), { type: "object" });
});

test("falls back to the runtime tool list before any model request was made", () => {
  fallbackTools = [tool("Read")];
  try {
    const entries = getPromptContextEntries.call(runtimeWith([], []));
    assert.deepEqual(
      entries.map((e) => [e.name, e.category]),
      [["Read", "system_tool_schemas"]],
    );
  } finally {
    fallbackTools = [];
  }
});
