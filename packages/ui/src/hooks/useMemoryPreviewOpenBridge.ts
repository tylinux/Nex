import { useEffect } from "react";
import { useMemoryPreviewStore } from "@/store/memoryPreviewStore.js";

/**
 * 订阅「打开 Memory 文件预览」请求并交给当前 workspace 的侧边栏控制器。
 *
 * 触发入口在设置页深处，通过单例 store 发起请求；这里按 workspaceKey 匹配后
 * 调用 onOpen 打开侧边栏 tab，再消费请求，避免多 workspace 实例串开。
 */
export function useMemoryPreviewOpenBridge(
  ownWorkspaceKey: string,
  onOpen: (params: { workspaceId: string; fileName: string }) => void,
): void {
  useEffect(() => {
    const handlePending = (
      pendingRequest: ReturnType<typeof useMemoryPreviewStore.getState>["pendingRequest"],
    ) => {
      if (!pendingRequest || pendingRequest.workspaceKey !== ownWorkspaceKey) {
        return;
      }
      onOpen({
        workspaceId: pendingRequest.workspaceId,
        fileName: pendingRequest.fileName,
      });
      useMemoryPreviewStore.getState().consumeRequest(pendingRequest.requestId);
    };

    // 订阅期间可能已有 pending 请求（点击与挂载存在竞态），先处理一次当前值。
    handlePending(useMemoryPreviewStore.getState().pendingRequest);
    return useMemoryPreviewStore.subscribe((state) => {
      handlePending(state.pendingRequest);
    });
  }, [onOpen, ownWorkspaceKey]);
}
