# Go / Rust 生态调研：构建 AI Coding Agent 后端

> **调研日期**：2026-10-08
> **方法**：GitHub REST API（`gh api`）、GitHub raw README、crates.io API、Go module proxy、pkg.go.dev、官方规范站点。所有 star / 版本 / 推送时间均为**当场抓取**，非训练数据回忆。
> **倾向**：本报告按"倾向 Go"组织，但在每项中给出 Go / Rust 对称对比。
> **标注约定**：✅ 已验证（附来源）｜⚠️ 部分验证/需实测｜❓ 未能验证（不确定性已显式标注）

---

## 0. 执行摘要（TL;DR）

**结论先行：Go 侧在 2026 年底对"AI coding agent 后端"这个具体形态已经全面可用，且有两个过去会被视为阻塞项的能力在今年补齐了。**

三个改变格局的事实：

1. **官方 Go MCP SDK 已存在且已到 v1.8.0**（`modelcontextprotocol/go-sdk`，5.2k stars，与 Google 协作维护）。**不是**社区方案。Rust 侧同样有官方 SDK（`modelcontextprotocol/rust-sdk` / crates.io 上的 `rmcp` v3.5.1）。两者都实现 MCP 稳定版 `2026-07-28` 规范。
2. **Anthropic 有官方 Go SDK**（`anthropics/anthropic-sdk-go`，v1.79.1，MIT）。这一点在官方文档的 SDK 矩阵里已确认。**Rust 没有官方 Anthropic SDK**——这是 Rust 侧最明确的缺口。
3. **纯 Go 的 SQLite（`modernc.org/sqlite` v1.60.1）与纯 Go 的 WASM 运行时（`wazero`）让"零 cgo、单静态二进制、从 macOS 交叉编译三平台"成为现实**。唯一仍强制 cgo 的常见组件是 `mattn/go-sqlite3`；但**你不需要它**（见 §6）。

**Go 侧唯一真正的软肋**：沙箱化执行不可信 JS 时，纯 Go 的 goja **不是安全边界**（同进程、无内存隔离、可被逃逸/DoS）。若这是硬需求，需要 WASM（wazero + QuickJS-WASI）或子进程隔离。这**不是** Go 独有的问题——Rust 的 rquickjs 同样不是安全边界。**两种语言在同一处都有这个问题**（见 §1）。

**逐项生产就绪度一览**：

| 能力             | Go 最佳选择                 | 就绪度                      | Rust 最佳选择                   | 就绪度                  |
| ---------------- | --------------------------- | --------------------------- | ------------------------------- | ----------------------- |
| 嵌入 JS          | goja 7.1k★                  | ✅ 生产可用（**但不安全**） | rquickjs 1.0k★ / Boa 7.6k★      | ✅ 可用（**也不安全**） |
| 安全沙箱 JS      | wazero + QuickJS-WASI       | ⚠️ 需自建                   | wasmtime / deno_core            | ⚠️ 需自建               |
| MCP SDK          | **官方 go-sdk v1.8.0**      | ✅ 生产可用                 | **官方 rmcp v3.5.1**            | ✅ 生产可用             |
| Anthropic SDK    | **官方 v1.79.1**            | ✅ 生产可用                 | ❌ 无官方                       | ❓ 社区为主             |
| OpenAI SDK       | **官方 openai-go v3.73.0**  | ✅ 生产可用                 | async-openai v0.42.1            | ✅ 可用（非官方）       |
| 多 provider 抽象 | ⚠️ 无同等品，需自建/薄封装  | ⚠️                          | **rig v0.44.0**（20+ provider） | ✅ 生产可用             |
| PTY              | creack/pty 2.1k★            | ✅ 生产可用                 | portable-pty 0.9.0              | ✅ 生产可用             |
| 终端模拟         | ⭐ 无（需自建）             | ⚠️                          | vte 0.15 + ratatui 0.30         | ✅ 生产可用             |
| CDP 浏览器       | chromedp 13.3k★ / rod 7.1k★ | ✅ 生产可用                 | chromiumoxide 0.9.1             | ⚠️ 维护偏慢             |
| SQLite           | modernc（纯 Go）/ ncruces   | ✅ 生产可用                 | rusqlite 0.40 / sqlx 0.9        | ✅ 生产可用             |
| 单二进制分发     | ✅ 原生支持                 | ✅ 最优                     | ✅ 原生支持                     | ✅ 优                   |

---

## 1. 嵌入 JS 引擎（沙箱化模型生成的 JS）

### 1.1 先回答最关键的问题：`node:vm` 不是安全边界，这里重要吗？

**非常重要，而且它决定了整个选型方向。**

`node:vm` 不是安全边界这件事，意味着"用 JS 引擎跑不可信代码"**本身就不是隔离**。同一事实适用于：goja、rquickjs、Boa、rusty_v8——**它们都是进程内引擎，都共享宿主进程的地址空间和运行时**。

因此要区分两个目标：

- **目标 A：可靠地跑模型生成的 JS，带超时 + 能力限制**（限制 `fetch`、`fs` 等 API 暴露）。→ **进程内引擎可以做到**，靠"只注入白名单宿主函数"。
- **目标 B：抵御恶意 JS 的沙箱隔离**（防止逃逸读内存、DoS 宿主）。→ **进程内引擎做不到**。必须用 WASM（能力=导入表，且内存隔离）或操作系统级子进程隔离。

⚠️ **本报告的核心判断**：如果 agent 的场景是"跑模型自己写的工具脚本"，通常 **A 就够**（模型不是攻击者，错误是 bug 而非攻击）。如果场景是"跑第三方不可信插件"，**必须 B**。请先明确你属于哪种——这决定后面选什么，也决定 Go 是否有短板。

### 1.2 Go 侧

| 方案                                     | Repo                                                                  | Stars            | 最新版本                  | 最后推送       | 状态                                             |
| ---------------------------------------- | --------------------------------------------------------------------- | ---------------- | ------------------------- | -------------- | ------------------------------------------------ |
| **goja**                                 | github.com/dop251/goja                                                | **7,128**        | 无 release（滚动 master） | **2026-10-07** | ✅ 当日活跃，48 open issues，MIT                 |
| goja_nodejs                              | github.com/dop251/goja_nodejs                                         | —                | —                         | —              | ✅ 官方配套（提供 `setTimeout`、`require` 等）   |
| modernc.org/quickjs                      | gitlab.com/cznic/quickjs（GitHub 镜像 `modernc-org/sqlite` 同源组织） | 110（镜像 repo） | **v0.25.0**               | 2026-10-01     | ✅ **纯 Go，无 cgo**，BSD-3                      |
| buke/quickjs-go                          | github.com/buke/quickjs-go                                            | 185              | **v0.7.6**                | 2026-09-28     | ✅ 活跃，MIT，QuickJS 的 cgo 绑定                |
| quickjs-go/quickjs-go                    | github.com/quickjs-go/quickjs-go                                      | 104              | —                         | **2023-04-14** | ❌ **实际上是死的**（3 年未动）                  |
| aperturerobotics/go-quickjs-wasi-reactor | github.com/aperturerobotics/go-quickjs-wasi-reactor                   | 15               | v0.15.1                   | 2026-10-06     | ⚠️ 小众但活跃，**QuickJS WASI reactor + wazero** |
| wazero                                   | github.com/tetratelabs/wazero                                         | **6,413**        | —                         | 2026-09-28     | ✅ 生产级纯 Go WASM 运行时，Apache-2.0           |
| **go-duktape**                           | github.com/olebedev/go-duktape                                        | 775              | —                         | 2021-10-14     | ❌ **已 archived，仓库名带 `[abandoned]`**       |

**Go 侧最生产就绪的是 goja** —— 唯一一个"当日还在提交、7k stars、被广泛生产使用"的纯 Go 引擎。

**goja 的关键能力（✅ 从其 README 验证）：**

- **超时/中断正是它的招牌功能**。README 直接给出 `vm.Interrupt()` 示例：
  ```go
  vm := goja.New()
  time.AfterFunc(200*time.Millisecond, func() { vm.Interrupt("halt") })
  _, err := vm.RunString(SCRIPT)  // 死循环被中断，返回 *InterruptError
  ```
  这正好对应你"带超时"的需求。**这是 goja 相对多数替代品的真实优势。**
- **能力限制靠"只注入白名单函数"实现**（不注入 `fetch`/`fs` 即可）。
- ⚠️ **明确不是并发的**：README 原文 — _"An instance of goja.Runtime can only be used by a single goroutine at a time."_ 每个会话/每次执行需要一个独立 `Runtime`，不能跨 goroutine 共享。这对多流并发 agent 是**架构约束**，不是 bug：按会话分配 Runtime 即可。
- ⭐ **有 `goja_nodejs`** 官方配套，但注意——它引入 Node 语义（`require`、文件系统），**恰恰是你要限制的东西**。用它要小心，别把能力默认打开。

**QuickJS-WASM 在 Go 里存在吗？→ 存在，但是小众。**

- ✅ `aperturerobotics/go-quickjs-wasi-reactor`（v0.15.1，2026-10-06 活跃）提供 QuickJS 编译为 WASI reactor 后由 wazero 加载。**这是 Go 里唯一"既有 WASM 隔离又有独立 JS 引擎"的路径**，但 15 stars 意味着**要自己扛集成风险**。
- ⚠️ `modernc.org/quickjs` 更成熟（v0.25.0，与 `modernc.org/sqlite` 同一套 ccgo 转译技术栈），但它是 **C→Go 转译**，**不是 WASM**，因此**没有内存隔离**，安全性等同 goja 而非 WASM。它的价值在"纯 Go、无 cgo、可交叉编译"，不在安全。

**Go 侧裁决：**

- 目标 A（跑模型脚本、要超时）：**goja**。✅ 生产就绪，唯一风险是安全性被误认为隔离。
- 目标 B（真隔离）：**wazero + QuickJS-WASI**。⚠️ 可行但需自建，且绑定层年轻。

### 1.3 Rust 侧

| 方案         | Repo                          | Stars     | 最新版本              | 最后推送       | 状态                                   |
| ------------ | ----------------------------- | --------- | --------------------- | -------------- | -------------------------------------- |
| **rquickjs** | github.com/DelSkayn/rquickjs  | **1,030** | **v0.14.0**           | **2026-10-05** | ✅ 活跃，MIT，66 open issues           |
| **Boa**      | github.com/boa-dev/boa        | **7,589** | **v0.22**             | 2026-10-04     | ✅ 活跃，MIT，纯 Rust，223 open issues |
| quickjs-rs   | github.com/theduke/quickjs-rs | 617       | v0.4.1                | **2023-07-31** | ❌ **3 年未动**（即老 "quickjs-rs"）   |
| rusty_v8     | github.com/denoland/rusty_v8  | 3,967     | **v152.2.0**          | 2026-09-26     | ✅ 活跃，V8 绑定（V8 版本号即版本号）  |
| deno_core    | github.com/denoland/deno_core | **472**   | v0.412.0（crates.io） | **2026-02-27** | ⚠️ **GitHub repo 已 archived！**       |

**⚠️ 重要发现：`denoland/deno_core` 这个独立 GitHub repo 已被 archived**（`"archived": true`，最后推送 2026-02-27）。但 **crates.io 上的 `deno_core` crate 仍在发布**（v0.412.0，repo 字段指向 `github.com/denoland/deno`）——**开发已合并回 deno 主仓**。所以：

- ❌ "去 `denoland/deno_core` repo 提 issue / 看最新 code" —— 这条路径**已死**。
- ✅ crate 本身仍可用、仍在发版（8.4M downloads），但你要去 deno 主仓。
- ⭐ 含义：**deno_core 作为独立库嵌入的外部承诺变弱了**。把它当"Deno 的内部组件，恰好能被嵌入"，而不是"一个被承诺长期维护的嵌入库"。这降低了它的选型吸引力。

**Rust 侧最生产就绪的是 rquickjs**（对"嵌入引擎+超时"）**或 Boa**（对"纯 Rust、不要 C 依赖"）。

- **rquickjs v0.14.0**：活跃、API 成熟、有 async 支持。⚠️ **但它依赖 `rquickjs-sys` → 走 `cc` crate 编译 C 源码**（✅ 从 `sys/Cargo.toml` 验证，`build-dependencies: cc = "1"`）。即**有 C 编译依赖**，交叉编译时需要一个 C 交叉工具链。它提供 `bindgen` feature（可选）。
- **Boa v0.22**：**纯 Rust，无 C 依赖** → 交叉编译最干净。7.6k stars 是 Rust JS 引擎里最高的。⚠️ 但 Boa 的**规范完成度和性能历史上弱于 QuickJS/V8**，且 223 open issues 偏高。**你需要实测它对模型常见 JS 语法的兼容性**——这是本报告 ❓ 未能完全验证的一项。
- **rusty_v8**：最"真"的 JS 引擎（就是 V8）。⚠️ 但**构建代价极高**（下载/编译 V8 或依赖预编译二进制），且**内存足迹大**。对"启动快、二进制小"的 agent 后端是负担。
- **❓ quick-js vs rquickjs 的关系**：crates.io 上 `quick-js` v0.4.1（`theduke/quickjs-rs`，2023 停更）是**旧**绑定；`rquickjs` 是其现代继任。别装错。

**Rust 侧裁决：**

- 要活跃 + 成熟：**rquickjs**（接受 C 编译依赖）。
- 要纯 Rust/交叉编译干净：**Boa**（需实测兼容性）。
- 要真隔离：**wasmtime**（未在本次深挖，但为 Rust 生态标准 WASM 运行时）。

### 1.4 小结：Go vs Rust（JS 引擎）

|                    | Go                                         | Rust                                  |
| ------------------ | ------------------------------------------ | ------------------------------------- |
| 生产就绪的引擎     | ✅ goja                                    | ✅ rquickjs（C 依赖）/ Boa（纯 Rust） |
| 超时/中断          | ✅ **一流**（`vm.Interrupt` 是招牌）       | ✅ 支持（QuickJS interrupt handler）  |
| 并发模型           | ⚠️ Runtime 非 goroutine-safe，需按会话隔离 | ✅ 天然多实例（Send/Sync 需显式设计） |
| 纯语言实现（无 C） | ✅ modernc.org/quickjs（转译，非隔离）     | ✅ Boa                                |
| **真安全沙箱**     | ⚠️ 需 wazero+WASI（年轻）                  | ⚠️ 需 wasmtime                        |

**⚠️ 两边的共同真相**：**没有任何一个"嵌入 JS 引擎"是安全边界。** 若你的需求是"抵御恶意代码"，Go 和 Rust 在同一起跑线，都需要 WASM 或子进程——**这一项不构成选 Go 还是 Rust 的理由**。

---

## 2. MCP（Model Context Protocol）SDK 状态

### 2.1 官方 Go SDK 存在吗？→ **存在，且已稳定到 v1.8.0**

| Repo                                       | Stars     | 最新版本   | 最后推送   | 许可证                                                                                                                                    |
| ------------------------------------------ | --------- | ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **github.com/modelcontextprotocol/go-sdk** | **5,191** | **v1.8.0** | 2026-10-07 | NOASSERTION（仓库描述：_"The official Go SDK for Model Context Protocol servers and clients. Maintained in collaboration with Google."_） |

✅ **官方性已验证**：仓库全名在 `modelcontextprotocol` 组织下，描述自称 official，homepage 指向 modelcontextprotocol.io。

**成熟度（✅ 从 README 验证）：**

- **版本兼容矩阵**（README 原表）：

  | SDK 版本      | 最新 MCP 规范  | 支持的规范版本                                             |
  | ------------- | -------------- | ---------------------------------------------------------- |
  | **v1.7.0+**   | **2026-07-28** | 2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 |
  | v1.4.0–v1.6.1 | 2025-11-25     | 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05             |
  | v1.0.0–v1.1.0 | 2025-06-18     | 2025-06-18, 2025-03-26, 2024-11-05                         |

- **包结构**：`mcp`（核心 client/server）、`jsonrpc`（自建 transport 用）、`auth`（OAuth 原语）、`oauthex`。
- **有官方的"v2 待改进清单"**（`docs/rough_edges.md`）——**这是一个很强的成熟度正面信号**：维护者公开承认 v1 的 API 失误并承诺 v2 修正。已知粗糙点举例：
  - 默认 capabilities 非空（server 默认广告 `logging`，client 默认广告 `roots`）——反直觉；
  - `ToolAnnotations` 字段应为 `*bool`；
  - `CreateMessageResult.Content` 单数 vs 规范允许数组。
    ⚠️ **含义：v1 API 会冻结到 v2，v2 会有 breaking change。** 现在基于 v1 构建要有心理准备。

**规范版本 `2026-07-28` 是稳定版**（✅ 从规范站验证），且是**重大架构变更**：

- ✅ 引入 **stateless 模型**（SEP-2575）：**取消了 `initialize`/`notifications/initialized` 握手**，每个请求自带 protocol version 与 client capabilities（在 `_meta.io.modelcontextprotocol/*`）。这比旧的"connection-scoped session"更适合无状态/水平扩展部署。
- ✅ `roots`、`sampling`、`logging` 在 `2026-07-28` 被 **SEP-2577 deprecated**（SDK 仍兼容至少 12 个月）。

### 2.2 Rust：rmcp

| Repo / Crate                                 | Stars     | 最新版本        | 最后推送   | 许可证          |
| -------------------------------------------- | --------- | --------------- | ---------- | --------------- |
| **github.com/modelcontextprotocol/rust-sdk** | **3,987** | **rmcp v3.5.1** | 2026-10-06 | Apache-2.0      |
| crates.io `rmcp`                             | —         | **v3.5.1**      | —          | 33.4M downloads |

✅ **官方**（在 `modelcontextprotocol` 组织下，README 自称 _"An official Rust Model Context Protocol SDK implementation with tokio async runtime"_）。
⚠️ **注意**：`rmcp` **不是**你问题里写的"社区 rmcp 或类似"——它是**官方**的。这是一个容易搞错的点。

- 包结构：`rmcp`（核心）+ `rmcp-macros`（`#[tool]` 等过程宏）。
- `rust-version = "1.88"`，edition 2024。
- ✅ 实现稳定版 `2026-07-28`，并向后兼容 `2025-11-25` 及更早。
- ⚠️ **v3.x 有 breaking change**（README 指向 migration guide discussion #969）——和 Go 侧一样，v1→v2 类似的破坏性演进在 Rust 这里是 v2→v3。

### 2.3 Transport 与能力对照（这是问题 2 的核心）

| 能力                        | Go SDK (v1.8.0)                                                                                                 | Rust rmcp (v3.5.1)                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **stdio**                   | ✅ `mcp.StdioTransport`（README 示例即 stdio server）                                                           | ✅ `transport-io` feature                                                                                          |
| **Streamable HTTP**         | ✅ `StreamableClientTransport` + `StreamableHTTPHandler`（代码搜索命中 19 / 26 处）；含 `StreamableHTTPOptions` | ✅ server: `transport-streamable-http-server`（Tower service）；client: `transport-streamable-http-client-reqwest` |
| **Legacy SSE**              | ✅ 保留（docs 有独立小节）                                                                                      | ✅（隐含，向后兼容）                                                                                               |
| **工具列举**                | ✅ `mcp.AddTool` / tool handlers                                                                                | ✅ `#[tool]` 宏 + tool router                                                                                      |
| **工具结果流式**            | ✅ SSE stream 由 streamable transport 承载（`Event`/`EventStore` 是 SSE 实现细节，见 rough_edges）              | ✅ 有 progress notifications（`notify_progress`）；长期任务用 Tasks 扩展                                           |
| **取消**                    | ✅ Cancellation 章节                                                                                            | ✅ 双向 cancel                                                                                                     |
| **子进程 client transport** | ✅（README 示例 `exec.Cmd` + stdio）                                                                            | ✅ `transport-child-process`                                                                                       |
| **Worker/in-process**       | ✅（in-memory transports）                                                                                      | ✅ `transport-worker`                                                                                              |

⭐ **关键差异点**：规范 `2026-07-28` 把 Streamable HTTP 定义得**更彻底**——_"each message is an HTTP POST to a single MCP endpoint; replies arrive as a JSON object or a request-scoped SSE stream"_。rmcp 额外提供 **"Stateless Streamable HTTP"** 章节，与规范的 stateless 模型对齐。**两者都达标；rmcp 的文档对这个新模型展开更细。**

### 2.4 小结

**✅ 两个 SDK 都是官方、都已稳定、都覆盖 stdio + Streamable HTTP + 工具列举 + 流式。这一项对 Go 和 Rust 都完全不是阻塞项——这是 2026 年相比 2024/2025 最大的变化。**

需要注意的是**两者都处在大的 API 演进中**（Go: v1→v2；Rust: v3 breaking）。选型时锁版本，并预留一次迁移。

---

## 3. LLM Provider SDK

### 3.1 Anthropic

| 语言                                 | SDK                                        | Stars     | 最新版本                       | 官方性                  |
| ------------------------------------ | ------------------------------------------ | --------- | ------------------------------ | ----------------------- |
| **Go**                               | **github.com/anthropics/anthropic-sdk-go** | **1,214** | **v1.79.1**（2026-10-08 发布） | ✅ **官方**             |
| Python / TS / C# / Java / PHP / Ruby | —                                          | —         | —                              | ✅ 官方                 |
| **Rust**                             | —                                          | —         | —                              | ❌ **官方文档中不存在** |

✅ **"Anthropic 现在有 Go SDK 吗？"→ 有，且是官方的，且高频发版**（v1.79.1 与调研同日发布，说明 release 自动化程度高）。
✅ **官方文档验证**：SDK 矩阵列出 7 种官方语言——Python、TypeScript、C#、**Go**、Java、PHP、Ruby。Go 的标注是 _"Context-based cancellation, functional options"_。
✅ **Rust 明确缺席**：官方 SDK 页面**完全没有提到 Rust**。

**⚠️ 这是本报告对"倾向 Go"最重要的支撑点之一**：Anthropic 是 coding agent 的主要 provider 之一，官方 Go SDK 的存在意味着 Go 侧少一层"社区封装可能滞后/失修"的风险。Rust 侧只能自己写薄 HTTP 客户端，或用多 provider 抽象库（见 §3.3）间接访问。

### 3.2 OpenAI

| 语言     | SDK                             | Stars     | 最新版本    | 官方性                                                             |
| -------- | ------------------------------- | --------- | ----------- | ------------------------------------------------------------------ |
| **Go**   | **github.com/openai/openai-go** | **3,486** | **v3.73.0** | ✅ **官方**（描述 _"The official Go library for the OpenAI API"_） |
| **Rust** | —                               | —         | —           | ❌ 无官方                                                          |

✅ `openai-go` 官方、Apache-2.0、当日在推送。**注意版本已到 v3**（不是 v1）——说明经过多轮 major 演进，API 相对成熟。
❌ **Rust 无官方 OpenAI SDK**（这与 Anthropic 的情况一致：两大厂都**没有**官方 Rust SDK）。

⭐ **Go 侧因此拥有"两家主要 provider 的官方 SDK 全覆盖"**，Rust 侧两家都缺。**这是本报告 Go vs Rust 最不对称的一项。**

### 3.3 多 provider 抽象（Anthropic / OpenAI / OpenAI-compatible / GLM/Zhipu / models.dev 聚合）

这是你们项目的真实形态——**多 provider，不止一家**。这里 Go 和 Rust 的差距最大。

**Rust 侧：`rig` 是明确的状态之选。**

| Crate        | Repo                              | Stars     | 最新版本    | 最后推送       |
| ------------ | --------------------------------- | --------- | ----------- | -------------- |
| **rig-core** | github.com/0xPlaygrounds/rig      | **8,828** | **v0.44.0** | **2026-10-08** |
| genai        | github.com/jeremychone/rust-genai | 900       | v0.7.0-rc.4 | 2026-10-07     |
| async-openai | github.com/64bit/async-openai     | 2,017     | **v0.42.1** | 2026-09-28     |

- **rig** ✅ 官方自称 _"20+ model providers, all under one singular unified interface"_，并**明确分离 `rig-core`（provider 中立契约）与 agent 编排**。✅ 被真实产品采用（README 点名 Con 终端模拟器、ilert 事件平台用其做 multi-provider 抽象）。
  ⚠️ **关于 GLM/Zhipu**：我在 rig 的 README 里**没有直接找到 zhipu/GLM/deepseek/moonshot 的 provider 条目**——它明确列出的多是 **AWS Bedrock / Google Vertex / Gemini / Candle** 这类，外加向量库集成（Qdrant/LanceDB/SQLite…）。**这是本报告 ❓ 未能验证的一点**：rig 的 OpenAI-compatible provider 是否覆盖 GLM/Zhipu，需查它的 `rig::providers` 源码或 openai-compatible 章节确认。
- **genai** ⚠️ v0.7.0-**rc**.4 —— **还在 RC，未 GA**。设计目标就是多 provider 统一。**选它要接受 pre-1.0 的波动。**
- **async-openai** ✅ 成熟（v0.42.1，9M downloads），但**是 OpenAI 专用**；通过它的 base_url 覆盖可接 OpenAI-compatible 端点（GLM 等），但**不是**统一的跨 provider 抽象。

**Go 侧：⚠️ 没有与 rig 同量级的统一抽象。**

- ✅ 官方 `anthropic-sdk-go` + `openai-go` 都很强，但**它们各自独立**。多 provider 意味着你要**自己写一层 adapter 接口**（例如内部定义 `Provider` interface，下面挂 anthropic/openai/GLM 实现）。
- ⚠️ 我**没有在本次调研中找到**一个 Go 里等同于 rig 的、8k+ stars 的"20+ provider 统一抽象"。Go 生态习惯是"每家一个官方 SDK + 你自己做接口抽象"。
- ⭐ **不必然是缺点**：因为两家官方 SDK 都在，你自己写薄 adapter 的**风险其实比 Rust 低**（Rust 侧你连官方 Anthropic SDK 都没有，rig 是在替你做这层，但 rig 自己也还在 0.x）。
- ❓ **GLM/Zhipu 在 Go 官方**：不存在官方 GLM Go SDK（本次未查到）。GLM 的 OpenAI-compatible 端点可直接复用 `openai-go` + `base_url` 覆盖。

### 3.4 流式（SSE）+ 工具调用

- ✅ **两家官方 Go SDK 都原生支持 SSE 流式 + 工具调用**（这是 Messages API / Chat Completions 的一等能力，SDK 必然覆盖）。
- ⚠️ **需要你自己做的**：跨 provider 的**统一流式事件模型**（Anthropic 的 content block delta 事件 ≠ OpenAI 的 chunk delta）。**无论 Go 还是 Rust 都要做这层归一化。** rig 在 Rust 侧替你做了（价值所在），Go 侧要自己写。

### 3.5 小结（provider）

|                    | Go                                     | Rust                             |
| ------------------ | -------------------------------------- | -------------------------------- |
| 官方 Anthropic SDK | ✅ **有**（v1.79.1）                   | ❌ 无                            |
| 官方 OpenAI SDK    | ✅ **有**（v3.73.0）                   | ❌ 无                            |
| 多 provider 抽象   | ⚠️ 自建 adapter（但底层官方 SDK 齐全） | ✅ **rig v0.44.0**               |
| 流式 + 工具调用    | ✅ 官方 SDK 原生                       | ✅（依赖 rig / genai / 自建）    |
| "state of the art" | 官方 SDK + 自建薄层                    | **rig**（次要 genai，但仍在 RC） |

⭐ **不对称的权衡**：Rust 有 rig 这一层现成的统一抽象；Go 有官方 SDK 但没有现成统一抽象。**因为你是"倾向 Go"，请把"写一层 provider adapter"计入工作量**——但好消息是你底下垫的是官方 SDK，而不是社区封装。

---

## 4. PTY / 终端模拟

| 组件             | 语言 | Repo                              | Stars                  | 最新版本  | 最后推送       | 状态                                           |
| ---------------- | ---- | --------------------------------- | ---------------------- | --------- | -------------- | ---------------------------------------------- |
| **creack/pty**   | Go   | github.com/creack/pty             | **2,097**              | —         | 2026-06-01     | ✅ 事实标准，MIT，稳定（低频更新=成熟）        |
| **portable-pty** | Rust | 内嵌于 github.com/wezterm/wezterm | （随 wezterm 29,153★） | **0.9.0** | **2025-02-11** | ⚠️ crate 本身 1.5 年未发版，但 19.4M downloads |
| vte              | Rust | github.com/alacritty/vte          | 326                    | 0.15.0    | 2026-02-28     | ✅ 活跃，Apache-2.0，81M downloads             |
| ratatui          | Rust | github.com/ratatui/ratatui        | **22,897**             | 0.30.2    | 2026-10-07     | ✅ 极其活跃，MIT                               |

**Go 侧：creack/pty ✅ 生产就绪。**

- 它是 Go 里 PTY 的事实标准（被大量工具依赖）。**2,097 stars、低频提交是健康的信号**（接口稳定，无功能债）。
- ⚠️ **注意**：creack/pty **只提供 PTY 原语**（`pty.Start`、spawn 进程、拿到 `*os.File` 读写）。**它不做终端模拟**——不解析 ANSI/VT 转义序列、不维护屏幕缓冲。

**Rust 侧：portable-pty ✅ 可用，但维护节奏值得注意。**

- ✅ `portable-pty` 提供跨平台 PTY 抽象（Windows ConPTY + Unix），19.4M downloads 说明被广泛依赖。
- ⚠️ **0.9.0 发布于 2025-02-11，至今 1.5 年无新版**。它活在 wezterm 主仓里（wezterm 本身当日活跃），所以**不是被弃养，而是"在 wezterm 里演进、偶尔切版本给 crates.io"**。用它是安全的，但别期待快速响应你提的 crate 级 issue。

**问题："vte/ratatui 的生产成熟度（用于做终端模拟器功能）"**

⭐ **这里有一个 Go 侧的真空 —— 请特别注意：**

- ✅ **Rust 有完整的终端模拟栈**：`vte`（终端转义序列**解析器**，0.15.0，来自 alacritty）+ `ratatui`（TUI 渲染，22.9k★）。**这是被 alacritty/wezterm 这类生产终端验证过的组合。**
- ❌ **Go 侧没有同等成熟的"终端模拟器"库**。Go 有 creack/pty（PTY 原语），但你**要自己做终端模拟**（ANSI 解析 + 屏幕缓冲），或找一个小的 VT 解析库（生态里存在 `hinshun/vt10x` 之类，**本次未验证其成熟度 ❓**）。
- ⭐ **但请注意分清两个不同的东西**：
  1. **真·终端模拟器**（复刻 xterm 行为、网格屏幕缓冲、光标工程）→ Rust 强，Go 弱。
  2. **PTY 转发**（把 shell 的字节流原样转给前端 xterm.js 渲染）→ **这是 coding agent 更常见的需求**，此时 **Go 的 creack/pty 足够**，前端用 xterm.js 做渲染，后端不需要 VT 模拟。
     **你们的"终端功能"属于哪一类？如果属于 2（更可能），Go 侧没有短板。**

---

## 5. 嵌入浏览器 / CDP 客户端

| 组件              | 语言 | Repo                                                 | Stars      | 最后推送       | 状态                     |
| ----------------- | ---- | ---------------------------------------------------- | ---------- | -------------- | ------------------------ |
| **chromedp**      | Go   | github.com/chromedp/chromedp                         | **13,301** | **2026-10-05** | ✅ 生产就绪，MIT         |
| **rod**           | Go   | github.com/go-rod/rod                                | **7,124**  | 2026-08-11     | ✅ 生产就绪，MIT         |
| **chromiumoxide** | Rust | github.com/mattsse/chromiumoxide                     | 1,401      | **2026-04-03** | ⚠️ **半年未推送**        |
| headless_chrome   | Rust | github.com/rust-headless-chrome/rust-headless-chrome | 2,953      | 2026-06-11     | ⚠️ 4 个月未推送，v1.0.22 |
| **fern**          | Rust | ❓ 未找到该 repo                                     | —          | —              | ❓ **未能定位**          |

**Go 侧：chromedp ✅ 与 rod ✅ 双双生产就绪，且是这一项里 Go 最明显的优势。**

- **chromedp**（13.3k★，当日活跃）：Go 生态 CDP 客户端的事实标准。API 是 `cdp` context + action 组合。
- **rod**（7.1k★）：更高层的 API（更接近 Puppeteer 手感），自动管理浏览器生命周期。**对"agent 自动操作浏览器"这类用法，rod 的 ergonomics 常被认为更好。**
- ⭐ **两个都远成熟于 Rust 侧任何选项**（star 量级差 5-10 倍，活跃度也更高）。

**Rust 侧：⚠️ 明显弱于 Go。**

- **chromiumoxide** 0.9.1（1.4k★）：Rust 主要 CDP 客户端，但**最后推送 2026-04-03（半年）**，Apache-2.0，4.8M downloads。可用，但**维护活跃度是隐性风险**——CDP 是跟着 Chrome 演进的，客户端需要跟进。
- **headless_chrome** v1.0.22（2.9k★）：弃用/半维护状态（2026-06-11 后无动作）。历史上人气高但**演进慢**。
- ❓ **"fern"**：**我没能定位到你指的这个 Rust CDP 库**。fern 在 Rust 生态里更出名的是（a）日志库、（b）一个 S3 的库。若你指某个具体 CDP 项目，请给 repo 链接，我未能验证。

**裁决：这一项 Go 明确胜出。** 若 agent 需要"浏览器操作"能力（现在 coding agent 越来越多需要它），**Go 的 chromedp/rod 是更安全的赌注**。

---

## 6. SQLite（会话存储，中等写入量）

### 6.1 Go 侧

| 驱动                   | Repo                                                  | Stars       | 最新版本    | 类型                                   | 最后推送                  |
| ---------------------- | ----------------------------------------------------- | ----------- | ----------- | -------------------------------------- | ------------------------- |
| **mattn/go-sqlite3**   | github.com/mattn/go-sqlite3                           | **9,251**   | v1.14.52    | **cgo（C 编译）**                      | 2026-09-28                |
| **modernc.org/sqlite** | gitlab.com/cznic/sqlite（GH 镜像 modernc-org/sqlite） | 110（镜像） | **v1.60.1** | **纯 Go（ccgo 转译 C→Go）**            | 2026-10-05                |
| **ncruces/go-sqlite3** | github.com/ncruces/go-sqlite3                         | **1,115**   | v0.35.4     | **纯 Go（wasm2go）**                   | 2026-10-01                |
| sqlx                   | github.com/jmoiron/sqlx                               | **17,745**  | —           | **不是驱动**，是 `database/sql` 增强层 | ⚠️ **2024-08-15（2 年）** |

⭐ **性能有官方 benchmark（`modernc.org/sqlite-bench`，"SQLite Drivers 26.09 Benchmarks Game"，v1.1.16，Go 1.27）——这是本次调研里质量最高的一个来源：**

**Scorecard（每项测试最快者得 1 分，分高者胜）：**

| 排名  | 驱动                   | 总分    | Simple | Complex | Many | Large | Concurrent |
| ----- | ---------------------- | ------- | ------ | ------- | ---- | ----- | ---------- |
| **1** | **mattn**（CGO）       | **103** | 19     | 30      | 22   | 24    | 8          |
| **2** | **ncruces**（wasm2go） | **66**  | 9      | 1       | 16   | 13    | **27**     |
| **3** | **modernc**（纯 Go）   | **39**  | 4      | 1       | 10   | 11    | 13         |

**样例绝对耗时（ms，越小越好，linux/amd64，Ryzen 9 3900X，`*`=该行最快）：**

- Simple insert：mattn `*2391`，modernc `3189`，ncruces `3690`
- Complex insert：mattn `*1334`，modernc `1946`，ncruces `2370`
- Concurrent N=8：ncruces `*1483`，mattn `1754`，modernc `1863`

✅ **modernc 官方 doc.go 给出相对 C 的 CPU 时间倍数（2026-09 实测，Go 1.27）——这是权威的自陈数据：**

| 负载                                               | 对比原生 C |
| -------------------------------------------------- | ---------- |
| 无索引 `ORDER BY ... LIMIT 100`（584k 行 × 23 列） | **2.0x**   |
| `GROUP BY` 聚合（同表）                            | **1.9x**   |
| 走索引的相关子查询（文本比较）                     | **1.3x**   |

且原文说明："吞吐量在 4 连接下扩展性与 C 版一致，**因此倍数在并发下保持成立**"。

⭐ **对你"中等写入量会话存储"的直接建议：**

- **写入场景 mattn 最快，但差距对"中等写入量"多半无关紧要**（modernc 约 1.3–2.0x CPU 时间）。**中等写入量** = 你不会被这个倍数卡住，而**会**被 cgo 破坏交叉编译这件事卡住（见 §8）。
- ✅ **首选 `modernc.org/sqlite`**：纯 Go → **保住零 cgo、单静态二进制、从 macOS 交叉编译三平台**。代价是 CPU 密集查询慢 1.3–2.0x。
  - ⚠️ **modernc 官方自己警告两点**：(1) 缺索引的代价会同比放大，慢查询可能"跨过 deadline"——**务必对 `ORDER BY/GROUP BY/WHERE` 的列建索引**；(2) `database/sql` 默认**无限开连接**，每连接带自己的 page cache 与 libc 线程状态 → **必须 `db.SetMaxOpenConns(n)`**（对会话存储尤其重要）。
- ✅ **`ncruces/go-sqlite3` 值得认真考虑**：纯 Go、**并发读最强（27 分，唯一超过 mattn 的项目）**、写入也比 modernc 略好（Complex 2370 vs 1946 是 modernc 更快，但 Concurrent 明显 ncruces 胜）。⚠️ 但它用 wasm2go，**相对小众（1.1k★）**，且本次未验证其与 `database/sql` 生态的成熟度。
- ❌ **`mattn/go-sqlite3` 只在"愿意付 cgo 代价换最大写吞吐"时选**。
- ⚠️ **`sqlx` 最后推送 2024-08-15（2 年）** —— 它稳定（17.7k★，API 简单），但**你要知道它是低频维护的**。它是查询构造/扫描辅助，不替代驱动；对现代 `database/sql` 用法，很多人已改用纯 `database/sql` + `sqlc` 生成。

### 6.2 Rust 侧

| Crate        | Repo                                          | Stars      | 最新版本    | 下载量 | 状态                |
| ------------ | --------------------------------------------- | ---------- | ----------- | ------ | ------------------- |
| **rusqlite** | github.com/rusqlite/rusqlite                  | 4,431      | **v0.40.2** | 120M   | ✅ 活跃，MIT        |
| **sqlx**     | github.com/transact-rs/sqlx（原 launchbadge） | **17,551** | **v0.9.0**  | 160M   | ✅ 活跃，Apache-2.0 |

- **rusqlite** ✅ Rust 的 SQLite 绑定事实标准。⭐ **"bundled vs system" 有明确支持**：`bundled` feature 会**编译并静态链接 SQLite 源码**（无需系统库）→ **这是推荐选项**（可复现、无运行期依赖）。代价是需要 C 编译器 + 编译时间。它**总是需要 C 编译**（SQLite 是 C，绑定走 `-sys` crate），因此**交叉编译需要一个 C 交叉工具链**（与 Rust 的 rquickjs 同类问题）。
- **sqlx** ✅ 异步 SQL 工具包，支持编译期查询校验（`query!` 宏需连库）。**注意 repo 已从 `launchbadge/sqlx` 迁到 `transact-rs/sqlx`** —— 这是一个值得注意的维护权转移。v0.9.0 是当前版本（160M downloads，非常成熟）。
  ⚠️ **对 SQLite 场景的坑**：sqlx 的编译期检查 + SQLite 需要 `DATABASE_URL` 指向真实库文件，CI 里要准备它。**对"中等写入量会话存储"，用 rusqlite + 手写 SQL 往往比 sqlx 更简单直接**。
- ⭐ **重要 vs Go**：**Rust 侧 rusqlite 必然要求 C 工具链，而 Go 侧 `modernc.org/sqlite` 让"零 C 工具链"成为可能。** 这是你"倾向 Go"时 §8 交叉编译会兑现的一个实打实的红利。

---

## 7. 并发 / 运行时特性（流式 agent 相关）

### 7.1 goroutine vs tokio，跑大量并发 SSE 流

| 维度                     | Go（goroutine）                                                           | Rust（tokio）                                                                    |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 并发模型                 | goroutine + channel，运行时抢占式调度                                     | task + async/await，协作式（`.await` 处让出）                                    |
| 每个并发流的心智负担     | **极低**：直接 `go func()` + `for { select { ... } }`                     | **中**：需 `async` 传染、`Pin`/生命周期、`Send` 约束                             |
| 每任务内存               | 初始栈 ~2KB，按需增长                                                     | task 本身极小；但**闭包捕获的 buffer 才是实际占用**                              |
| 阻塞代码的后果           | ⚠️ 阻塞 goroutine 会占线程（Go 会起更多 OS 线程兜底，但大量阻塞仍会膨胀） | ⚠️ **阻塞 `.await` 会卡住整个 executor 线程**（更严重，必须用 `spawn_blocking`） |
| 背压                     | channel 天然                                                              | `mpsc` + `Semaphore`                                                             |
| 取消                     | `context.Context` 一等公民                                                | `CancellationToken` / drop                                                       |
| 上手速度（对流式 agent） | ✅ 快                                                                     | ⚠️ 慢（async 复杂度）                                                            |

⭐ **对"大量并发 SSE 流"的判断**：

- ✅ **两者都能轻松扛住"每个连接一条流"的量级**（几百到几千并发流对两者都不是问题）。**这不是选型瓶颈。**
- ⭐ **Go 的真实优势在"SSE 转发这类 I/O 密集、逻辑直白"的代码上，写起来显著简单**——`select` 多路复用 stdin/stdout/网络，几乎无心理负担。这对 agent 后端（大量"读流→转发→写流"）很契合。
- ⚠️ **Rust 的真实优势在"内存确定性 + 无 GC 停顿"**——若你有严格的尾延迟 SLA，tokio 更可预测。
- ⚠️ **诚实说明**：我**未能找到**针对"2026 年版本的 Go vs tokio 在高并发 SSE 流下的实测对照 benchmark"（这类 benchmark 结论高度依赖具体实现）。**故本节下结论时声明：这是基于运行时设计特性的推断，非实测数字 ❓。**

### 7.2 每个流的 memory footprint

- ❓ **具体字节数我未能验证**（取决于 buffer 大小、TLS、解析器）。**不要相信任何未经你实测的"每个流 X KB"的数字。**
- ✅ **可以确定的定性结论**：两者都不是瓶颈；**实际占用由你的 buffer 策略决定**（读取块大小、是否累积、是否保留历史）。**这项应通过你自己的压测确定，而不是选 Go 还是 Rust 的依据。**

### 7.3 冷启动 / 二进制大小

|            | Go                                                                                     | Rust                                                                    |
| ---------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 冷启动     | ✅ **极快**（无 GC 预热问题；静态二进制 mmap 即起）                                    | ✅ 极快（无运行时初始化）                                               |
| 二进制大小 | ⚠️ 中等（**典型 agent 后端 15–40MB**，含 HTTP/TLS/JSON；用 `-ldflags "-s -w"` 可减小） | ✅ **通常更小**（无 GC、无反射式 JSON 时会显著更小；LTO 后常见 5–15MB） |
| 构建时间   | ✅ 快                                                                                  | ⚠️ 慢（尤其带 LTO）；`rusty_v8`/V8 类依赖会爆炸                         |
| 运行时内存 | ⚠️ GC 有堆开销（但 Go 的 GC 已很省，通常不是问题）                                     | ✅ 更省且更可预测                                                       |

⭐ **必须注意的反例**：**若你在 Rust 侧选了 `rusty_v8`（V8），"二进制小/启动快"的优势会被彻底抹掉**——V8 会让二进制定子到几十上百 MB，构建也极重。**"Rust 二进制小"的前提是不引入 V8 级别的依赖。** 同理 Go 侧引入大依赖也会膨胀。

---

## 8. 构建与分发

### 8.1 交叉编译（从 macOS 编译三平台）

⭐ **这是 Go 在整个调研里最大的结构性优势，而且和你对 SQLite 的选择直接耦合。**

**Go：✅ 一流，但有前提。**

- ✅ **纯 Go 项目：`GOOS=darwin/linux/windows GOARCH=arm64/amd64 go build` 直接出产物，无需任何交叉工具链。** 这是 Go 的看家本领。
- ⚠️ **前提：`CGO_ENABLED=0`**（默认在交叉编译时即为 0）。
- ❌ **只要引入任何 cgo 依赖，这条流就废了**。而 `mattn/go-sqlite3` **就是 cgo**：
  - ✅ 从其 README 原文验证：_"Because this is a `CGO` enabled package, you are required to set `CGO_ENABLED=1` and have a `gcc` compiler present within your path."_
  - 交叉编译需按目标设置 `CC`/`CXX`（README 给出 `CC=arm-linux-gnueabihf-gcc CXX=... CGO_ENABLED=1 GOOS=linux GOARCH=arm`），**即需要完整交叉工具链**——从 macOS 直接编 Linux/Windows 会非常痛苦。
- ⭐ **因此：用 `modernc.org/sqlite`（纯 Go）→ 保住"从 macOS 一条命令出三平台静态二进制"。这是本报告对 Go 最重要的具体建议。** 代价仅是 CPU 密集查询慢 1.3–2.0x（§6.1），对中等写入量会话存储可忽略。

**Rust：⚠️ 可行但复杂得多。**

- Rust 本身交叉编译需要 target + linker 配置（`cargo build --target x86_64-pc-windows-gnu` 等）。
- ⚠️ **且一旦依赖 C 代码（rusqlite、rquickjs-sys），你必须为每个目标准备 C 交叉工具链**（`aarch64-apple-darwin` / `x86_64-unknown-linux-musl` / `x86_64-pc-windows-gnu` 各一套）。**这是 Rust 侧"嵌入 JS + SQLite"都要付的税**（因为 rquickjs→cc、rusqlite→C SQLite）。
- ✅ 缓解方案：`cargo-zigbuild`、`cross`（容器化交叉编译）、`cargo-dist`。**这些工具成熟，但比 Go 的"设两个环境变量"重得多。**

### 8.2 静态 vs 动态链接 / musl vs glibc

- **Go**：✅ `CGO_ENABLED=0` → **完全静态**（除少数 libc 相关 syscall 走纯 Go 实现）。**免 glibc 版本地狱**，可直接丢进 `scratch`/`distroless` 容器。
  - ⚠️ 若必须 cgo（如 mattn），则需 `-tags musl` + musl-gcc 才能静态，或用 `gcompat` 妥协。
- **Rust**：⚠️ **默认动态链接 glibc** → 会把"构建机 glibc 版本"变成运行期要求（典型的 "GLIBC_2.xx not found" 事故）。
  - ✅ 标准解法：target `x86_64-unknown-linux-musl` → 静态二进制。⚠️ 但 **musl target + C 依赖（rusqlite/rquickjs）需要 musl 交叉工具链**，配置更繁。
  - ✅ `rusqlite` 的 `bundled` feature 让 SQLite 静态编入（但仍需 C 编译器）。

### 8.3 单文件二进制嵌入（SEA 等价物）

⭐ **Go 与 Rust 都是"编译型单二进制"语言 —— 这一项两家都原生满足，没有 Node SEA / Bun compile 那种"打包运行时"的额外层。**

|                                 | Go                                | Rust                                       |
| ------------------------------- | --------------------------------- | ------------------------------------------ |
| 单二进制                        | ✅ 原生（默认就是）               | ✅ 原生                                    |
| 嵌入静态资源（前端 dist、模板） | ✅ `//go:embed`（一等公民，极简） | ✅ `include_bytes!` / `rust-embed`         |
| 嵌入 JS/资源到同一二进制        | ✅ `go:embed` + goja/wazero 加载  | ✅ 同上（rquickjs/wasmtime 从 bytes 加载） |

✅ **Go 的 `//go:embed` 在这种"一个二进制装下 UI + JS 运行时 + 会话存储"的 agent 形态里极其顺手**，是我认为 Go 被低估的一个实用优势。

### 8.4 构建分发的 gotcha 清单

| 陷阱                    | 语言 | 说明                                        | 规避                                       |
| ----------------------- | ---- | ------------------------------------------- | ------------------------------------------ |
| **cgo 破坏交叉编译**    | Go   | mattn/go-sqlite3、多数 QUICKJS cgo 绑定     | ✅ 用 modernc/ncruces sqlite + goja        |
| **glibc 版本耦合**      | Rust | 默认动态链接                                | ✅ musl target（但 +C 依赖要 musl 工具链） |
| **C 交叉工具链**        | Rust | rusqlite、rquickjs-sys 强制                 | ⚠️ cargo-zigbuild / cross                  |
| **macOS 签名/公证**     | 两者 | 分发到 macOS 需 code signing + notarization | 各自处理，非语言问题                       |
| **Windows 上的 ConPTY** | 两者 | 现代 Windows PTY 需要 ConPTY（Win10 1809+） | creack/pty / portable-pty 均已处理         |
| **V8 类依赖爆炸**       | Rust | rusty_v8 → 二进制/构建时间暴涨              | ✅ 用 rquickjs（QuickJS 小得多）或 Boa     |

⭐ **一句话**：**如果在 Go 侧坚持"零 cgo"，你会得到本报告里最省心的分发体验**——`GOOS/GOARCH` 出静态单二进制、`go:embed` 装资源、丢进 scratch 容器即跑，从 macOS 一条命令出三平台。**Go 的唯一门槛就是别引入 cgo，而 SQLite 恰好有成熟的纯 Go 替代。**

---

## 9. 总体裁决：生产就绪 vs 需投入

### ✅ 立即可用（生产就绪）

| 能力                            | 选择                            | 依据                                                                |
| ------------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| MCP server/client               | **Go: 官方 go-sdk v1.8.0**      | 官方、覆盖 stdio+Streamable HTTP+工具流式、按规范版本发布了兼容矩阵 |
| Anthropic 接入                  | **anthropic-sdk-go v1.79.1**    | 官方、当日发版                                                      |
| OpenAI / OpenAI-compatible 接入 | **openai-go v3.73.0**           | 官方                                                                |
| PTY（转发 shell 字节流）        | **creack/pty 2.1k★**            | 事实标准、稳定                                                      |
| 浏览器自动化                    | **chromedp 13.3k★ / rod 7.1k★** | 双方案成熟，远胜 Rust 侧                                            |
| 会话存储                        | **modernc.org/sqlite v1.60.1**  | 纯 Go、官方 benchmark 与自陈倍数均有，中等写入量足够                |
| 单二进制分发                    | **Go 原生 + go:embed**          | 零 cgo 时一条命令出三平台静态二进制                                 |

### ⚠️ 可用但需投入 / 有已知风险

| 能力                           | 问题                             | 建议                                                                                                   |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **沙箱化不可信 JS**            | goja/rquickjs **都不是安全边界** | 先定性：是 bug 风险还是攻击面？需要真隔离 → **wazero + QuickJS-WASI**（Go，需自建）或 wasmtime（Rust） |
| **多 provider 统一抽象（Go）** | 无 rig 等价物                    | 自建薄 adapter；底层垫官方 SDK 降低风险                                                                |
| **MCP SDK API 稳定性**         | Go v1→v2、Rust v3 均有 breaking  | 锁版本，预留一次迁移预算                                                                               |
| **Go 终端模拟器**              | 无成熟 VT 模拟库                 | 若只需 PTY 转发（配 xterm.js）→ 无缺口；若要真终端模拟 → 需自建或用 Rust                               |
| **Rust CDP**                   | chromiumoxide 半年未推送         | （不影响 Go 选型）                                                                                     |
| **sqlx（Go）**                 | 2024-08 后未更新                 | 可用，但考虑 `database/sql` + sqlc                                                                     |
| **libc 底线**                  | modernc 依赖 `modernc.org/libc`  | 不要把 libc 版本往下钉（官方明示其性能改进依赖新版 libc）                                              |

### ❌ / ❓ 未能验证或明确缺口

| 项                                    | 状态                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Rust 官方 Anthropic / OpenAI SDK**  | ❌ 确认不存在（官方 SDK 矩阵无 Rust）                                                             |
| **rig 是否原生支持 GLM/Zhipu**        | ❓ 未在 README 找到 provider 条目；需查其 `providers` 源码（可能通过 OpenAI-compatible 间接支持） |
| **Boa 对模型常见 JS 的语法兼容度**    | ❓ 未实测                                                                                         |
| **"fern" Rust CDP 库**                | ❓ 未能定位该 repo；请提供链接                                                                    |
| **Go vs tokio 高并发 SSE 实测对照**   | ❓ 未找到可信 benchmark；§7 结论为设计特性推断                                                    |
| **每流内存占用具体数字**              | ❓ 高度依赖实现；务必自行压测                                                                     |
| **Go 侧 VT 解析库成熟度**（如 vt10x） | ❓ 未验证                                                                                         |

---

## 10. 给"倾向 Go"的最终建议（含明确取舍）

**Go 对"AI coding agent 后端"在 2026-10 已经是一个没有硬阻塞的选择，并且有三处相对 Rust 的真实优势：**

1. **官方 SDK 覆盖更完整** —— MCP（官方 go-sdk）、Anthropic（官方）、OpenAI（官方）三家全齐。**Rust 缺官方 Anthropic 和 OpenAI SDK。**
2. **浏览器自动化强得多** —— chromedp 13.3k★ + rod 7.1k★ vs Rust 的 chromiumoxide（1.4k★、半年未更）。
3. **分发体验最省心** —— 零 cgo 时，`GOOS/GOARCH` + `go:embed` 出静态单二进制，从 macOS 一条命令出三平台。

**Go 侧你需要主动做的两个决策：**

1. **SQLite 选 `modernc.org/sqlite`（或评估 `ncruces/go-sqlite3`），而不是 `mattn/go-sqlite3`。** 这是保住"零 cgo 交叉编译"的关键。代价：CPU 密集查询慢 1.3–2.0x（对中等写入量会话存储可忽略）。**且务必 `SetMaxOpenConns` + 给排序/过滤列建索引**（modernc 官方明确警告）。
2. **JS 沙箱要定性。** 若"跑模型生成的脚本"（bug 风险）→ **goja**（`vm.Interrupt` 超时是它的强项）。若"跑第三方不可信代码"（攻击面）→ **goja 不够**，转 **wazero + QuickJS-WASI**（可用但需自建）或子进程隔离。**注意 Rust 在此同样不安全，这不是 Go 的短板。**

**Go 侧相对 Rust 需要自己补的一层：多 provider 统一抽象。** Rust 有 `rig` 现成；Go 没有同等品。**但因为 Go 有官方 Anthropic/OpenAI SDK 垫底，自建一层薄 adapter 的风险比 Rust 侧低。**

**唯一会让你后悔选 Go 的场景**：你需要一个**真正的终端模拟器**（VT 解析 + 屏幕缓冲），而不是 PTY 转发。那样 Rust 的 `vte` + `ratatui`（alacritty/wezterm 背书）明显更强。**但先确认这真的是你的需求——多数 agent 的"终端"其实是 PTY 转发 + 前端 xterm.js。**

---

### 附：本报告数据来源（均为调研当日抓取）

- GitHub REST API：`repos/{owner}/{repo}`（stars / archived / pushed_at / license）、`releases/latest`（版本号）；代码搜索 `search/code`（确认 `StreamableHTTPHandler` 等符号存在）。
- GitHub raw README / Cargo.toml：go-sdk README+`docs/rough_edges.md`+`docs/protocol.md`、rmcp README+Cargo.toml、goja README、rquickjs `sys/Cargo.toml`、mattn README、modernc doc.go。
- Go module proxy：`proxy.golang.org/{module}/@latest`、`@v/{ver}.mod`。
- crates.io API：`/api/v1/crates/{name}`（max_version / downloads / repository）。
- pkg.go.dev：`modernc.org/sqlite-bench` scorecard + modernc QUICKJS 搜索页。
- 规范：modelcontextprotocol.io `specification/latest`、`2026-07-28/basic/transports`。
- 官方 SDK 矩阵：platform.claude.com `docs/en/api/client-sdks`。

**版本时效性提醒**：以上版本号与 star 数截至于 **2026-10-08**。本领域（尤其 MCP 与多 provider 抽象）演进很快——**Go MCP SDK 已在筹备 v2（有 breaking change），rmcp 已到 v3**。复选型前请重新核对版本。
