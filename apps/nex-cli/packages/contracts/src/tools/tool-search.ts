// ============================================================
// ToolSearch Tool - 发现并激活 deferred 工具
// ============================================================
//
// deferred 工具默认不进模型请求。模型调用 ToolSearch 命中后，命中的工具在**下一次**
// 请求里带全量 schema（见 docs/specs/codemode.md 的 P1）。结果块的编码与解码都在
// core 的 `tool/tool-search-activation.ts`，这里只给入参契约与名字常量。

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

export const TOOL_SEARCH_TOOL_NAME = "ToolSearch";

export const TOOL_SEARCH_DEFAULT_LIMIT = 8;
export const TOOL_SEARCH_MAX_LIMIT = 25;

export const ToolSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).describe("Keywords describing the capability you need."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(TOOL_SEARCH_MAX_LIMIT)
      .optional()
      .describe(`Maximum number of tools to activate (default ${TOOL_SEARCH_DEFAULT_LIMIT}).`),
    namespace: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Only match tools from this MCP server name."),
  })
  .strict();

export type ToolSearchInput = z.infer<typeof ToolSearchInputSchema>;

export const ToolSearchInputJsonSchema = toToolJsonSchema(ToolSearchInputSchema);

export const ToolSearchHitSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const ToolSearchOutputSchema = z.object({
  query: z.string(),
  hits: z.array(ToolSearchHitSchema),
});

export type ToolSearchOutput = z.infer<typeof ToolSearchOutputSchema>;

export const ToolSearchOutputJsonSchema = toToolJsonSchema(ToolSearchOutputSchema);
