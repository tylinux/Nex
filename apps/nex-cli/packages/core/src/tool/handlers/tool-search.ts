// ============================================================
// ToolSearch Tool Handler
// ============================================================
// 搜索 deferred 工具并激活命中项。激活本身不在这里存状态：结果块写进历史后，
// runtime 的 getTools() 从历史推导 declared set（见 tool-search-activation.ts），
// 所以命中工具的 schema 在**下一次**请求才出现。

import {
  TOOL_SEARCH_DEFAULT_LIMIT,
  TOOL_SEARCH_TOOL_NAME,
  ToolSearchInputJsonSchema,
  ToolSearchInputSchema,
  ToolSearchOutputJsonSchema,
  ToolSearchOutputSchema,
  type ModelMessageContent,
  type ToolSearchOutput,
} from "@nex/contracts";
import type { ToolEntry, ToolHandler } from "../types.js";
import { searchToolDocuments } from "../tool-search-index.js";
import { encodeToolSearchResults } from "../tool-search-activation.js";

const TOOL_SEARCH_TIMEOUT_MS = 5_000;
const TOOL_SEARCH_MODEL_BYTES = 16_000;

const TOOL_SEARCH_DESCRIPTION = [
  "Searches the tools that are not yet loaded and makes the matches callable.",
  "",
  "- Some tools (for example MCP tools) are not listed in your tool declarations until you search for them.",
  "- Describe the capability with a few keywords; matching tools are loaded and can be called starting with your next step.",
  "- Pass `namespace` to restrict the search to one MCP server.",
].join("\n");

const toolSearchHandler: ToolHandler = async (input, context) => {
  const parsed = ToolSearchInputSchema.parse(input);
  const documents = context.deferredToolCatalog?.() ?? [];
  const hits = searchToolDocuments(documents, {
    query: parsed.query,
    limit: parsed.limit ?? TOOL_SEARCH_DEFAULT_LIMIT,
    ...(parsed.namespace === undefined ? {} : { namespace: parsed.namespace }),
  });
  return {
    query: parsed.query,
    hits: hits.map((hit) => ({ name: hit.name, description: hit.description })),
  } satisfies ToolSearchOutput;
};

function formatToolSearchModelContent(output: unknown): ModelMessageContent {
  const parsed = ToolSearchOutputSchema.safeParse(output);
  if (!parsed.success) return "ToolSearch returned an invalid result.";
  return encodeToolSearchResults(parsed.data.hits);
}

export const toolSearchToolEntry: ToolEntry = {
  capability: "Search deferred tools and activate the matches for the next request",
  metadata: {
    name: TOOL_SEARCH_TOOL_NAME,
    description: TOOL_SEARCH_DESCRIPTION,
    readOnly: true,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: TOOL_SEARCH_TIMEOUT_MS,
    maxOutputBytes: TOOL_SEARCH_MODEL_BYTES,
    sideEffectScope: "none",
    riskLevel: "low",
    needsApproval: false,
  },
  handler: toolSearchHandler,
  inputSchema: ToolSearchInputJsonSchema,
  outputSchema: ToolSearchOutputJsonSchema,
  runtimeInputSchema: ToolSearchInputSchema,
  runtimeOutputSchema: ToolSearchOutputSchema,
  formatModelContent: formatToolSearchModelContent,
  permission: {
    permission: "toolSearch",
    reason: "ToolSearch reads the in-memory tool catalog",
    riskLevel: "low",
    sideEffectScope: "none",
    needsApproval: false,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: TOOL_SEARCH_MODEL_BYTES,
    maxModelBytes: TOOL_SEARCH_MODEL_BYTES,
    strategy: "truncate",
    preview: { maxBytes: TOOL_SEARCH_MODEL_BYTES, direction: "head" },
  },
  timeout: {
    kind: "timed",
    defaultMs: TOOL_SEARCH_TIMEOUT_MS,
    maxMs: TOOL_SEARCH_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: false,
    cleanup: "none",
    userVisibleMessage: "ToolSearch reads the in-memory tool catalog and cannot be cancelled",
  },
  trace: {
    required: true,
    propagateToAdapters: false,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
