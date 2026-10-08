# Web 端侧栏置顶任务

## 问题

Web 端可以置顶任务（写入 server 的 tasks-index），但侧栏「置顶」区永远是空的；被置顶的任务还会从普通列表消失，看起来像被删除。Timeline 区同理。

根因：侧栏 Pinned / Timeline 的数据源是 `useGlobalTaskList`，它只通过 `window-controller` channel（`IWindowControllerService`）读取列表。该 channel 只有 Desktop Host 注册；`nex-server` 没有，Web 上每次调用都以 `Unknown channel ... timed out` 失败，hook 保留最后一份（空）列表。

## 产品规则

- Web 与 Desktop 使用**同一套**列表投影实现，Web 端侧栏的置顶、时间线区与 Desktop 行为一致：置顶后任务出现在「置顶」区，取消置顶后回到原列表，重命名、归档、已读状态变化实时反映。
- 不在 UI 层为 Web 另写一套列表构建逻辑；`useGlobalTaskList`、`windowControllerTaskListRegistry` 与侧栏组件不改。
- 本期只覆盖 server 本机的 workspace（Web 当前也只支持这些）。远程 workspace 仍不在 Web 支持范围。

## 状态所有者与数据流

| 状态                                    | 所有者                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------- |
| 任务持久行、pinned/archived 成员关系    | server 的 tasks-index（`INexTaskService`，不变）                           |
| 列表投影（rows、membership、live 状态） | `WindowHostControllerRuntime`：内存聚合，不持久化；每次从 tasks-index 重建 |
| 每条连接的订阅与帧游标                  | 该连接的 attachment service（`createAttachmentService()`）                 |

`WindowHostControllerRuntime` 及其 projection / sessions observer 从 `packages/desktop/src/host` 迁到 `packages/services/src/window-controller`（无 Electron 依赖，仅依赖 `@nex/shared`、`@nex/rpc` 与 services 内部接口），经 `@nex/services/node` 导出。Desktop Host 与 `nex-server` 各创建自己的 runtime 实例；依赖方向保持 `desktop → services`、`server → services`。

```text
web 客户端                          nex-server
  setTaskPinned ───────────────▶ INexTaskService ──▶ tasks-index
                                        │ workspace_task_list_changed
                                        ▼
                     WindowHostControllerRuntime (共享) ── refreshSource(force)
                                        │ projection delta
                                        ▼
  useGlobalTaskList ◀── 帧 ◀── 该连接的 attachment ◀── projection.subscribe
        │  listTaskList / subscribeControllerV4 / resyncControllerV4
        └──────────────────────────────▶ window-controller channel
```

事件顺序：连接建立 → registry 订阅 `workspaces` 与 `tasks-index` 两个 topic（拿到 snapshot 游标）→ `listTaskList` 首次触发 source 注册与 refresh → 之后任一任务写入发出 `workspace_task_list_changed`，runtime 合并等待在途读取后强制 refresh，projection 产生 delta 帧，经各连接 attachment 推给客户端；客户端按游标发现缺口时 `resyncControllerV4(forceSnapshot)`，与 Desktop 的 `web-remote-replayable` 恢复语义一致。

## 不变量

1. 一个 server 进程只有一个 runtime；每条 WebSocket 连接各有一个 attachment。**连接关闭必须 dispose 该 attachment**，不能遗留订阅或事件监听。
2. Web 没有 mutation 路由包装（Desktop 的 `createControllerRoutedTaskService`）：写入直接到 `INexTaskService`，投影只靠 workspace 事件刷新。因此 runtime 对本地 source 的事件订阅是 Web 列表刷新的唯一入口，不允许绕开它加第二条刷新路径。
3. 远程 workspace identity 的查询在 server 上 fail-closed（返回无 source），不能落到本地 tasks-index。
4. 桌面连接（`desktop-continuous` 的 trusted host relay）不使用 server 的 controller；只有普通 Web 客户端使用。server 对两种连接都提供 attachment，行为无差别。
5. 渲染进程与服务端的 channel 契约不变（`IWindowControllerService`），不需要协议版本升级。

## 失败语义

- source 读取失败：沿用 runtime 既有行为，记录 warn，保留最后可信投影，不清空列表。
- server 重启：连接断开后客户端重连并重新订阅，首个 `listTaskList` 重建投影。
- agent runtime 不可用时 sessions observer 进入 dormant，列表仍可由 tasks-index 提供，live 状态缺省为 idle/终态。

## 验收

1. services 单测：本地 source 的 pinned / active / archived 列表按 membership 过滤；`workspace_task_list_changed` 事件使 pinned 列表在不重新查询的情况下更新并产生帧；attachment `dispose` 后不再收到帧；远程 identity 查询返回空。
2. 隔离 server（临时数据根）+ 无头 Chrome：Web 侧栏出现「置顶」区且包含已置顶任务；在 Web 上置顶 / 取消置顶后列表实时变化；控制台不再出现 `Unknown channel: window-controller`。
3. Desktop 行为不变：desktop 测试与既有 e2e 通过；`pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过。
