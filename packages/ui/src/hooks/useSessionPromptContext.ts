import { useEffect, useState } from "react";
import type { SessionPromptContextEntry } from "@nex/shared";
import { useServices } from "@/hooks/useServices.js";

export type SessionPromptContextState =
  | { status: "loading" }
  | { status: "ready"; entries: SessionPromptContextEntry[] }
  | { status: "error" };

/** 仅在对话框打开时拉取一次；prompt context 不随事件流推送。 */
export function useSessionPromptContext({
  workspacePath,
  workspaceIdentity,
  sessionId,
  enabled,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string | null;
  enabled: boolean;
}): SessionPromptContextState {
  const { nexAgentService } = useServices();
  const scopeKey = JSON.stringify([workspaceIdentity?.trim() || workspacePath, sessionId]);
  const [result, setResult] = useState<{
    key: string;
    state: SessionPromptContextState;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    let disposed = false;
    nexAgentService
      .readSessionPromptContext({ workspacePath, workspaceIdentity, sessionId })
      .then((snapshot) => {
        if (!disposed)
          setResult({ key: scopeKey, state: { status: "ready", entries: snapshot.entries } });
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
