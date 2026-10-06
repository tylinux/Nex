import {
  sessionSystemPromptParamsSchema,
  type SessionSystemPromptSnapshot,
} from "@nex/shared";
import { requireSession, type NexProtocolAgentServerContext } from "./server-types.js";

/** 只读查询：直接取 runtime 最近一次构建的 system prompt 分段，不做任何缓存。 */
export function querySessionSystemPrompt(
  context: NexProtocolAgentServerContext,
  rawParams: unknown,
): SessionSystemPromptSnapshot {
  const params = sessionSystemPromptParamsSchema.parse(rawParams);
  const record = requireSession(context, params.sessionId, { operation: "session_system_prompt" });
  return {
    sessionId: params.sessionId,
    sections: record.app.runtime.getSystemPromptSections().map((section) => ({
      name: section.name,
      source: section.source,
      cacheHint: section.cacheHint,
      content: section.content,
    })),
  };
}
