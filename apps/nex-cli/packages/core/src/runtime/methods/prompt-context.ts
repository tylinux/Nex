import type { ContextSection } from "../deps.js";
import type { ModelToolContract } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { parseMcpToolName } from "../helpers/index.js";

export type PromptContextCategory =
  | "system_prompt"
  | "meta_user_context"
  | "skills"
  | "tool_prompt"
  | "system_tool_schemas"
  | "mcp_tool_schemas";

export interface PromptContextEntry {
  category: PromptContextCategory;
  name: string;
  source: string;
  content: string;
}

/** 与 context-usage 的分类口径一致，保证面板百分比与对话框内容一一对应。 */
export function classifyContextSection(section: ContextSection): PromptContextCategory {
  if (section.source === "skills") return "skills";
  if (section.source === "tools") return "tool_prompt";
  return section.injectionTarget === "meta_user" ? "meta_user_context" : "system_prompt";
}

function toolEntry(tool: ModelToolContract): PromptContextEntry {
  const mcp = parseMcpToolName(tool.name);
  return {
    category: mcp ? "mcp_tool_schemas" : "system_tool_schemas",
    name: tool.name,
    source: mcp ? `mcp:${mcp.serverName}` : "tool",
    // 描述保留原始换行（放进 JSON 会被转义成 \n 而难以阅读），schema 单独以 JSON 展示。
    content: `${tool.description ?? ""}\n\n--- inputSchema ---\n${JSON.stringify(tool.inputSchema, null, 2)}`,
  };
}

/**
 * 只读返回最近一次模型请求的非消息输入：文本分段来自最近一次 context build，
 * 工具 schema 来自实际发出的请求（deferred / hidden 工具不在其中）。
 */
export function getPromptContextEntries(this: AgentRuntimeInternal): PromptContextEntry[] {
  const sections = (this.latestContextBuildResult?.sections ?? []).map((section) => ({
    category: classifyContextSection(section),
    name: section.name,
    source: section.source,
    content: section.content,
  }));
  // 会话刚恢复、还没发过模型请求时没有“最近请求”的工具集；回退到 runtime 当前会发送的
  // 工具（同一 declared set 过滤），避免对话框只有文本分段而缺工具页。
  const tools = this.latestRequestTools.length > 0 ? this.latestRequestTools : this.getTools();
  return [...sections, ...tools.map(toolEntry)];
}
