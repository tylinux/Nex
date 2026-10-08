import { randomUUID } from "node:crypto";
import {
  IWindowControllerService,
  INexAgentService,
  INexTaskService,
  type ServiceCollection,
} from "@nex/services";
import { createWindowHostControllerRuntime } from "@nex/services/node";
import { isRemoteWorkspaceIdentity } from "@nex/shared";

/**
 * nex-server 的侧栏列表 Controller（docs/specs/web-pinned-tasks.md）。
 *
 * Desktop Host 与 server 各持有一份 runtime；server 只服务本机 workspace。runtime 在进程内共享，
 * 每条 WebSocket 连接各自获得一个 attachment，连接关闭时必须 dispose，否则订阅与事件监听会泄漏。
 */
export function createServerWindowController(services: ServiceCollection) {
  const runtime = createWindowHostControllerRuntime({
    createId: randomUUID,
    resolveSource: (scope) => {
      // 远程 workspace identity 在 server 上 fail-closed，绝不能落到本机 tasks-index。
      if (scope.workspaceIdentity && isRemoteWorkspaceIdentity(scope.workspaceIdentity)) {
        return null;
      }
      const taskService = services.getOptional(INexTaskService);
      if (!taskService) {
        return null;
      }
      return {
        scope: {
          kind: "local" as const,
          workspacePath: scope.workspacePath,
          ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
        },
        taskService,
        agentService: services.getOptional(INexAgentService),
        sourceAvailability: "online" as const,
      };
    },
    onSourceError: (scope, operation, error) => {
      console.warn(
        `[nex-server:window-controller] source ${operation} failed, workspaceKey=${scope.workspaceIdentity?.trim() || scope.workspacePath}`,
        error,
      );
    },
  });

  // exposeOnChannelServer 只暴露已注册的服务；这里登记进程级实例，每条连接再用自己的 attachment 覆盖。
  if (!services.getOptional(IWindowControllerService)) {
    services.register(IWindowControllerService, runtime.service);
  }

  return {
    /** 为一条连接创建 attachment；返回给 channel 的对象不带 dispose，避免客户端远程调用它。 */
    attach(): { service: IWindowControllerService; dispose(): void } {
      const { dispose, ...service } = runtime.createAttachmentService();
      return { service, dispose };
    },
    dispose(): void {
      runtime.dispose();
    },
  };
}

export type ServerWindowController = ReturnType<typeof createServerWindowController>;
