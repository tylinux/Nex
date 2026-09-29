import { create } from "zustand";

/**
 * 打开「Memory 文件预览」侧边栏的请求桥接 store。
 *
 * 背景与 modelTrajectoryStore 同构：触发入口在设置页 Memory 分区（挂载位置在
 * workspace shell 之外），而侧边栏 tab 状态由每个 workspace 的 useAppPanels
 * 持有。用轻量单例 store 作桥：设置页写入 pending 请求，目标 workspace 的
 * useAppPanels 订阅并消费（按 workspaceKey 匹配，避免多 workspace 实例串开）。
 */
interface MemoryPreviewOpenRequest {
  /** 唯一请求 id，同一文件连续点击也能触发消费。 */
  requestId: string;
  workspaceId: string;
  fileName: string;
  /** workspaceIdentity?.trim() || workspacePath，用于定位目标 workspace 侧边栏。 */
  workspaceKey: string;
}

interface MemoryPreviewStoreState {
  pendingRequest: MemoryPreviewOpenRequest | null;
  requestOpen: (request: Omit<MemoryPreviewOpenRequest, "requestId">) => void;
  consumeRequest: (requestId: string) => void;
}

let requestSeq = 0;

export const useMemoryPreviewStore = create<MemoryPreviewStoreState>((set) => ({
  pendingRequest: null,
  requestOpen: (request) => {
    requestSeq += 1;
    set({
      pendingRequest: { ...request, requestId: `memory-preview-open:${requestSeq}` },
    });
  },
  consumeRequest: (requestId) => {
    set((state) =>
      state.pendingRequest?.requestId === requestId ? { pendingRequest: null } : state,
    );
  },
}));
