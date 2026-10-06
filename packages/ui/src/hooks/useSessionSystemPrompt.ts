import { useEffect, useState } from "react";
import type { SessionSystemPromptSection } from "@nex/shared";
import { useServices } from "@/hooks/useServices.js";

export type SessionSystemPromptState =
  | { status: "loading" }
  | { status: "ready"; sections: SessionSystemPromptSection[] }
  | { status: "error" };

/** 仅在对话框打开时拉取一次；system prompt 不随事件流推送。 */
export function useSessionSystemPrompt({
  workspacePath,
  workspaceIdentity,
  sessionId,
  enabled,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string | null;
  enabled: boolean;
}): SessionSystemPromptState {
  const { nexAgentService } = useServices();
  const scopeKey = JSON.stringify([workspaceIdentity?.trim() || workspacePath, sessionId]);
  const [result, setResult] = useState<{
    key: string;
    state: SessionSystemPromptState;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    let disposed = false;
    nexAgentService
      .readSessionSystemPrompt({ workspacePath, workspaceIdentity, sessionId })
      .then((snapshot) => {
        if (!disposed)
          setResult({ key: scopeKey, state: { status: "ready", sections: snapshot.sections } });
      })
      .catch(() => {
        if (!disposed) setResult({ key: scopeKey, state: { status: "error" } });
      });
    return () => {
      disposed = true;
    };
  }, [enabled, scopeKey, sessionId, workspaceIdentity, workspacePath, nexAgentService]);

  return result?.key === scopeKey ? result.state : { status: "loading" };
}
