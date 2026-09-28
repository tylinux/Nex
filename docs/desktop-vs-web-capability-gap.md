# Electron 桌面端 vs Web 模式能力差异与补全分析

> 状态：参考文档（非 spec）。对比对象：Electron 桌面端（packages/desktop）与
> Web 模式（`nex serve`：packages/server + packages/web，含 Docker 部署）。
> 分析日期：2026-09-28。相关文档：
> [cua-product-implementation-analysis.md](./cua-product-implementation-analysis.md)、
> [zcode-vs-nex-diff.md](./zcode-vs-nex-diff.md)。

## 0. 架构前提

两种模式**共用同一套 UI（packages/ui）和服务层（packages/services）**，agent
循环都跑在同一个外部 `app-server` 运行时（`NEX_AGENT_RUNTIME.spawnArgs =
["app-server", "--stdio"]`）。能力差异不来自两套实现，而来自两个机制：

1. **宿主注入点**：`createLocalServices()`（`packages/services/src/node.ts`
   附近，`browserControlExecutor` / `cuaProductMcpServerResolver` /
   `onAutomationManualRunRequested` / `authorizeLocalMediaPreviewPath` 等可选
   参数）。Desktop host 全部注入；Web 模式（`packages/server/src/entry-http.ts`
   → `createStdioServices`）一个都不注入，**缺省即 fail-closed**。
2. **UI 门控**：`isDesktop` 标志（desktop renderer 传 true，web 不传），
   能力面按此收敛；部分已抽象为 `capability: { supported, reason:
   "desktop_only" }` 协议（plugin-types / skills-types / command-types /
   subagents-types）。

## 1. 能力对照表

| 能力 | Electron | Web | 缺失根因 |
| --- | --- | --- | --- |
| Agent 对话 / turn / 会话 / 附件 | ✅ | ✅ | 同一运行时 |
| Workspace 文件 / 终端（node-pty）/ Git 检查点 | ✅ | ✅ | server 自带 node-pty 平台包 |
| Memory / 会话分享 / provider 配置 | ✅ | ✅ | 数据在 server 侧 |
| **Browser Use** | ✅ IAB（WebContentsView+CDP，右侧面板可视、tab 可接管、Chrome 登录态导入） | ❌ | `browserControlExecutor` 仅 desktop 注入（`desktop/src/host/index.ts:2421`）；headless CDP 只接了 CLI（`nex -p --browser-use headless` 与 TUI，`cli/src/headless-browser.ts`），server 模式装配未接 |
| **Computer Use** | ✅（macOS / Windows） | ❌ | `resolveComputerUseAvailability` 明确返回 `{kind:"web", supported:false}`；Helper/TCC 是"用户面前的机器"的能力 |
| **定时任务 Automations（cron）** | ✅ 常驻 scheduler utility process（20s 轮询、misfire 宽限、失败退避） | ⚠️ 只有 CRUD，**没有执行器** | scheduler 进程由 desktop main `electronUtilityProcess.fork` 拉起；核心逻辑（`AutomationRepo.claimDue`、cron 语义）在共享包 `@nex/services/node` |
| 插件装/卸/市场操作 | ✅ | ⚠️ `capability.reason: "desktop_only"` | 写宿主文件系统 + spawn git clone |
| Skills / Commands / Subagents 用户级创建 | ✅ | ⚠️ `userScopeReason: "desktop_only"` | 写 `~/` 全局目录 |
| Claude/Codex 会话迁移 | ✅ | ❌ | 读用户本机其它工具的数据目录 |
| Chrome 浏览器数据导入 | ✅ | ❌ | 读本机 Chrome profile |
| 远程工作区（SSH / WSL / Docker） | ✅ | ❌ | web 只 attached 到单一 server 环境 |
| 内嵌浏览器证书策略 | ✅ | ❌ | IAB 不存在 |
| 桌面集成（tray / 通知 / `nex://` 深链 / 文件对话框 / 关闭到托盘） | ✅ | ❌ | 本质差异 |
| 自动更新 | ✅ electron-updater | ❌ | 跟随 server 部署 |
| CUA PiP / ghost cursor / 操作浮层 | ✅ | ❌ | 随 CUA |
| 本地视频 media preview 授权 | ✅ | ❌ | desktop main 持授权 |

**设计哲学**：凡是"作用于用户面前的机器"（CUA、Chrome 导入、会话迁移）或
"写宿主全局状态"（插件安装、用户级技能）的能力都归 desktop——web 的宿主是
可能多租户的服务器，替任意浏览器客户端动本机 OS 是安全反模式。边界靠注入
缺失自然生效，不靠 if-else 硬编码，因此补全的工程面很清晰。

## 2. 补全可能性（按成本分级）

### A. 低成本、直接可做（服务端实现已存在，只差接线）

**A1. Browser Use headless CDP（约 1–2 天）**

CLI 已有完整的 `ManagedCdpBrowserRuntime`（playwright 托管 headless
Chromium，`backendType: "cdp"`，adapters/src/browser/ 全套）。缺的只是
server 模式装配：

- `entry-http` 增加部署配置开关（如 `NEX_BROWSER_BACKEND=cdp`），创建 CDP
  port 并注入 `createLocalServices`
- managed CDP 已声明能力差集：handoff / markDeliverable 等桌面交互语义命令
  返回 `capability_unsupported`（browser-use-plugin/docs/overview.md 的
  backend 差异表），UI 需按 backendType 隐藏对应操作
- Docker 镜像需安装 playwright chromium

**A2. Automations 执行器（约 1–2 天）**

scheduler 全部核心语义（`claimDue` 事务认领、misfire 宽限、退避、manual
run）在 `@nex/services/node` 共享包里，desktop scheduler 进程只是宿主壳。
server 模式在 `entry-http` 起同样轮询的循环（20s interval 或 worker
thread），派发改为本进程 `createTask + sendPrompt`。单实例部署语义完全
对齐；多实例需另加分布式认领锁（SQLite `BEGIN IMMEDIATE` 是单机方案）。

**A3. 宿主写操作开关化（约 1 天）**

用户级技能/命令/子代理/插件管理的服务端写路径本来就存在，UI 门控已是
`capability.reason: "desktop_only"` 协议。改为部署者声明开关（如
`NEX_SERVER_ALLOW_HOST_WRITES=1`）：自托管单用户（server 就跑在自己机器上）
放开，多租户默认关。

### B. 中成本、需要产品决策

**B1. 会话迁移 / Chrome 导入**：语义依赖"server 与用户的其它工具同机"。
localhost 自托管可随 A3 开关一起放开；远程 server 场景永远不该有。

### C. 不建议补（形态差异，不是缺口）

**C1. Computer Use**：安全模型核心是 Helper 与用户同机、TCC 授权给用户的
桌面会话；server 控制一台无人看的机器没有意义且危险。演进方向已埋好伏笔：
协议里 `clientMode: "web-remote-replayable"` 为手机回放设计，
`desktop-attached-remote` authority mode 已存在——**web 作为 desktop CUA
会话的遥控器/观察器**是架构支持的路径，而不是让 server 自己做 CUA。

**C2. 远程工作区 SSH**：web=单环境是产品形态选择；支持多环境等于把 desktop
的 workspace 管理搬进 server，是 server 产品化工程而非补能力。

## 3. 结论

Web 模式缺失的"硬能力"只有三块，且全部是**"最后 1 公里接线"问题**：
browser CDP（实现现成）、automation 执行器（语义现成）、宿主写开关（门控
现成）。A1 + A2 做完后，web 自托管部署即可覆盖日常使用主干（对话 / 文件 /
终端 / git / browser / 定时任务）；CUA 与桌面集成属于形态边界，不应追。
总计约一周工作量，其中浏览器 Docker 镜像与 CDP 稳定性验证可能占一半。
