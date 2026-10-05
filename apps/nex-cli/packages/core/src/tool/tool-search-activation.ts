// ============================================================
// ToolSearch 结果块的编码与解码
// ============================================================
// declared set 不单独存储：它由 provider 可见历史里**成功的** ToolSearch 结果推导。
// 于是 cold resume / rewind / branch cut / compaction 重建历史时答案随之重建，
// 只有 tool result 这一条写入路径。编码与解码必须同处本文件，保证往返一致。

import { modelMessageContentToText, TOOL_SEARCH_TOOL_NAME } from "@nex/contracts";
import type { RuntimeMessageEntry } from "../agent/message-history.js";

const BLOCK_OPEN = "<tool_search_results>";
const BLOCK_CLOSE = "</tool_search_results>";
const HIT_LINE = /^- ([^\s:]+): ?(.*)$/;

export interface ToolSearchHitLine {
  name: string;
  description: string;
}

const DESCRIPTION_MAX_CHARS = 240;

function oneLine(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > DESCRIPTION_MAX_CHARS
    ? `${collapsed.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`
    : collapsed;
}

export function encodeToolSearchResults(hits: readonly ToolSearchHitLine[]): string {
  if (hits.length === 0) {
    return `${BLOCK_OPEN}\nNo matching tools. Try different keywords.\n${BLOCK_CLOSE}`;
  }
  const lines = hits.map((hit) => `- ${hit.name}: ${oneLine(hit.description)}`);
  return [
    BLOCK_OPEN,
    ...lines,
    "These tools are now available; call them directly.",
    BLOCK_CLOSE,
  ].join("\n");
}

export function decodeToolSearchResults(text: string): string[] {
  const start = text.indexOf(BLOCK_OPEN);
  const end = text.indexOf(BLOCK_CLOSE);
  if (start < 0 || end < start) return [];
  const names: string[] = [];
  for (const line of text.slice(start + BLOCK_OPEN.length, end).split("\n")) {
    const match = HIT_LINE.exec(line.trim());
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

/** 历史里所有成功 ToolSearch 调用命中的工具名。 */
export function collectActivatedToolNames(entries: readonly RuntimeMessageEntry[]): Set<string> {
  const searchCallIds = new Set<string>();
  const activated = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "attachment") continue;
    const message = entry.message;
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        if (call.name === TOOL_SEARCH_TOOL_NAME) searchCallIds.add(call.id);
      }
      continue;
    }
    if (
      message.role === "tool" &&
      message.toolCallId !== undefined &&
      searchCallIds.has(message.toolCallId) &&
      message.isError !== true
    ) {
      for (const name of decodeToolSearchResults(modelMessageContentToText(message.content))) {
        activated.add(name);
      }
    }
  }
  return activated;
}
