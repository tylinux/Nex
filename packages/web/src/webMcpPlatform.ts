import type { IPlatformService } from "@nex/shared";
import type { connectViaWebSocket } from "@nex/client";

// 从已连接的服务访问器推导类型：web 包不直接依赖 @nex/services，只为一个类型加依赖不值得。
type WebServices = Awaited<ReturnType<typeof connectViaWebSocket>>;
export type WebMcpSyncService = WebServices["mcpSyncService"];

/**
 * Web 没有桌面 IPC，但连接的 server 已经注册了 mcp-sync RPC，并且它读写的就是 server 所在机器上的
 * ~/.nex/cli/config.json。MCP 设置页对本地 workspace 走 platform 接口，所以 Web 的 platform 必须把
 * 读写转发给这个 RPC，否则列表恒为空、保存恒失败（旧实现是固定的空/失败 stub）。
 */
export function createWebMcpPlatform(
  mcpSyncService: Pick<WebMcpSyncService, "loadMcpFromUserDirectory" | "saveMcpToUserDirectory">,
): Pick<IPlatformService, "loadMcpFromUserDirectory" | "saveMcpToUserDirectory"> {
  return {
    loadMcpFromUserDirectory: (payload) => mcpSyncService.loadMcpFromUserDirectory(payload ?? {}),
    saveMcpToUserDirectory: async (payload) => {
      try {
        await mcpSyncService.saveMcpToUserDirectory(payload);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
