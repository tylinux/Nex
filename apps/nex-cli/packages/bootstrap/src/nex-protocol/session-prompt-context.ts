import { sessionPromptContextParamsSchema, type SessionPromptContextSnapshot } from "@nex/shared";
import { requireSession, type NexProtocolAgentServerContext } from "./server-types.js";

/** 只读查询：直接取 runtime 最近一次模型请求的非消息输入，不做任何缓存。 */
export function querySessionPromptContext(
  context: NexProtocolAgentServerContext,
  rawParams: unknown,
): SessionPromptContextSnapshot {
  const params = sessionPromptContextParamsSchema.parse(rawParams);
  const record = requireSession(context, params.sessionId, { operation: "session_prompt_context" });
  return {
    sessionId: params.sessionId,
    entries: record.app.runtime.getPromptContextEntries(),
  };
}
