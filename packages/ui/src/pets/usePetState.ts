/**
 * 宠物状态订阅 hook：聚合当前窗口**所有打开的 workspace tab** 的 sessions-index，
 * 输出全局宠物语义状态（纯派生，不落盘）。
 *
 * 设计：宠物是桌面级伴侣，不随单个 workspace 切换而重置；状态优先级取所有
 * workspace 的最高档（任何一个 workspace 有 pending 审批就整体 waiting）。
 * 订阅模式照抄 useWorkspaceTerminalTaskNotifications：acquireSessionsIndex +
 * releaseSessionsIndex 清理。详见 docs/specs/desktop-pets.md。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PetSemanticState } from "@nex/shared";
import type { SessionSummary } from "@nex/shared/nex-protocol-v4";
import { useServices } from "@/hooks/useServices.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import {
  acquireSessionsIndex,
  releaseSessionsIndex,
  type SessionsIndexScope,
} from "@/v4/sessionsIndexRegistry.js";
import { derivePetState, type PetStateSnapshot } from "./petStateMachine.js";

const trimOptional = (value: string | null | undefined) => value?.trim() || undefined;

export interface PetRuntimeState {
  state: PetSemanticState;
  /** 至少一个 workspace 的订阅就绪（store live）。 */
  ready: boolean;
}

interface WorkspaceSubscriptionTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  workspaceKey: string;
}

/**
 * 聚合当前窗口所有 workspace tab 的宠物语义状态。
 * enabled=false 或无 workspace tab 时返回 idle/ready=false，且不发起任何订阅。
 */
export function usePetState(enabled: boolean): PetRuntimeState {
  const tabs = useTabStore((state) => state.tabs);
  const { nexAgentService } = useServices();

  // 当前窗口所有 workspace tab 去重（workspaceIdentity 优先）。
  const targets = useMemo<WorkspaceSubscriptionTarget[]>(() => {
    const seen = new Map<string, WorkspaceSubscriptionTarget>();
    for (const tab of tabs) {
      if (!isWorkspaceTab(tab)) continue;
      const workspaceIdentity = trimOptional(tab.workspaceIdentity);
      const workspacePath = tab.workspacePath;
      if (!workspacePath) continue;
      const workspaceKey = workspaceIdentity ?? workspacePath;
      if (seen.has(workspaceKey)) continue;
      seen.set(workspaceKey, {
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
        workspaceKey,
      });
    }
    return [...seen.values()];
  }, [tabs]);

  const signature = useMemo(
    () =>
      JSON.stringify(
        targets.map((target) => ({
          workspacePath: target.workspacePath,
          workspaceIdentity: target.workspaceIdentity ?? null,
          remoteSessionId: target.remoteSessionId ?? null,
        })),
      ),
    [targets],
  );

  const [snapshot, setSnapshot] = useState<PetStateSnapshot>({ state: "idle", since: 0 });
  const [ready, setReady] = useState(false);
  const previousRef = useRef<PetStateSnapshot | null>(null);
  // 已读水位：订阅建立时刻之前的终态不视为「未读完成」。
  const lastSeenActivityAtRef = useRef(0);
  // 每个 workspace 的最新 sessions 快照（跨 subscription 聚合）。
  const sessionsByWorkspaceRef = useRef<Map<string, SessionSummary[]>>(new Map());
  const liveByWorkspaceRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    previousRef.current = null;
    lastSeenActivityAtRef.current = Date.now();
    sessionsByWorkspaceRef.current = new Map();
    liveByWorkspaceRef.current = new Map();
    setSnapshot({ state: "idle", since: Date.now() });
    setReady(false);

    if (!enabled || targets.length === 0) {
      return;
    }

    const derive = () => {
      const now = Date.now();
      const allSessions = [...sessionsByWorkspaceRef.current.values()].flat();
      const next = derivePetState({
        sessions: allSessions,
        now,
        previous: previousRef.current,
        lastSeenActivityAt: lastSeenActivityAtRef.current,
      });
      previousRef.current = next;
      setSnapshot(next);
      setReady([...liveByWorkspaceRef.current.values()].some(Boolean));
    };

    const cleanups: Array<() => void> = [];
    for (const target of targets) {
      const scope: SessionsIndexScope = {
        workspaceKey: target.workspaceKey,
        workspacePath: target.workspacePath,
        ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
        ...(target.remoteSessionId ? { endpointKey: target.remoteSessionId } : {}),
      };
      const store = acquireSessionsIndex(scope, nexAgentService);
      const sync = () => {
        sessionsByWorkspaceRef.current.set(target.workspaceKey, store.getSessions());
        liveByWorkspaceRef.current.set(target.workspaceKey, store.getStatus() === "live");
        derive();
      };
      const unsubscribe = store.subscribe(sync);
      sync();
      cleanups.push(() => {
        unsubscribe();
        releaseSessionsIndex(scope, store);
        sessionsByWorkspaceRef.current.delete(target.workspaceKey);
        liveByWorkspaceRef.current.delete(target.workspaceKey);
      });
    }

    // 状态生命周期（running 3min / failed 1h / review 7d）到期需要自然回落 idle，
    // sessions-index 不会为此推帧——每 30s 本地重推导一次。
    const expiryTimer = setInterval(derive, 30_000);

    return () => {
      clearInterval(expiryTimer);
      for (const cleanup of cleanups) cleanup();
    };
    // signature 覆盖 targets 三元组列表；nexAgentService 换代走 registry 内部 replaceTransport。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature, nexAgentService]);

  return { state: snapshot.state, ready };
}
