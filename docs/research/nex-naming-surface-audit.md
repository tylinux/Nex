# Nex 代码库命名面审计：NEX\_ 环境变量 与 zcode/z.ai 字样

> 日期：2026-10-08
> 范围：`packages/*/src`、`apps/nex-cli/packages/*/src`、`scripts/`、打包配置与 i18n 文案
> 排除：`node_modules`、`dist`、`out`、`.git`

---

## 一、NEX\_ 环境变量

### 1.1 关键结论：真实环境变量是 **55 个**，不是 269 个

朴素做法（`grep -oE '\bNEX_[A-Z0-9_]+'`）会得到 **269 个唯一串**，但这个数字严重失真，原因是 `NEX_` 在本仓库是一个**命名空间前缀**，被复用于三种完全不同的东西：

| 类别         | 示例                                                                  | 是否环境变量      |
| ------------ | --------------------------------------------------------------------- | ----------------- |
| 真环境变量   | `NEX_DATA_BASE_DIR`、`NEX_SERVER_AUTH_TOKEN`                          | ✅                |
| 错误码常量   | `NEX_CREDENTIAL_DECRYPT_FAILED`、`NEX_AGENT_RUNTIME_UNAVAILABLE_CODE` | ❌ 是字符串常量   |
| 普通命名常量 | `NEX_AGENT_PROVIDER = "glm"`、`NEX_PROTOCOL_VERSION`                  | ❌ 是 TS 常量     |
| 正则误匹配   | `NEX_A`、`NEX_C`、`NEX_D`、`NEX_P`                                    | ❌ 根本不是标识符 |

### 1.2 精确统计方法与结果

真实环境变量有两个可靠来源，合并去重后得到准确数字：

**来源 A — `process.env.<NAME>` 直接读取：60 个**（其中 `NEX_` 前缀 **39 个**，其余为 `HOME`/`PATH`/`PORT` 等通用变量）

**来源 B — `packages/shared/src/runtimeEnv.ts`（249 行）集中声明：16 个 `NEX_` key**

该文件是运行时环境变量的权威白名单，形态是 `export const NEX_XXX_ENV_KEY = "NEX_XXX"` 常量对，供跨进程传递时动态读取（`env[NEX_CUA_DEV_MODE_ENV_KEY]`），因此不会出现在来源 A 里。**这是朴素 grep 会整类漏掉的部分。**

> **合并去重后：55 个 `NEX_` 环境变量**（39 直读 + 16 集中声明，其中无交集重叠）。

### 1.3 这 55 个的分布（按用途）

| 用途分组            | 代表变量                                                                                                                                                                  | 说明                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **数据目录 / 路径** | `NEX_DATA_BASE_DIR`、`NEX_HOME`、`NEX_LOG_DIR`、`NEX_STORAGE_DIR`、`NEX_DESKTOP_HOME_DIR`、`NEX_SERVER_ROOT`、`NEX_WEB_STATIC_ROOT`                                       | 决定数据落盘位置，**最影响用户迁移** |
| **Agent 进程启动**  | `NEX_AGENT_SERVER_COMMAND`、`NEX_AGENT_SERVER_ARGS_JSON`、`NEX_AGENT_SERVER_CWD`、`NEX_SEA_AGENT_ROLE`、`NEX_SEA_AGENT_ENTRY`、`NEX_LEGACY_CLI_ENTRY`                     | 子进程拉起协议，重写时必须逐个对齐   |
| **服务端 / 部署**   | `NEX_SERVER_HOST`、`NEX_SERVER_AUTH_TOKEN`、`NEX_BOOTSTRAP_WITH_REMOTE`、`NEX_TARGET_OS`、`NEX_TARGET_ARCH`                                                               | 远端部署面                           |
| **网络 / 代理**     | `NEX_HTTP_PROXY`、`NEX_NO_PROXY`、`NEX_REMOTE_HTTP_PROXY`、`NEX_REMOTE_NO_PROXY`、`NEX_REMOTE_RUNTIME_NETWORK_AUTHORITY`、`NEX_AGENT_CA_CERT`                             | 集中在 runtimeEnv，属跨进程传递      |
| **CUA 子系统**      | `NEX_CUA_PERMISSION_BROKER_SOCKET`、`NEX_CUA_PERMISSION_BROKER_TOKEN`、`NEX_CUA_DEV_MODE`、`NEX_CUA_PRODUCT_HELPER`、`NEX_CUA_PLUGIN_AUTHORITY`、`NEX_CUA_NODE_REPL_HOST` | 6 个，且**集中在 runtimeEnv**        |
| **构建 / 调试**     | `NEX_DEBUG`、`NEX_E2E_COVERAGE`、`NEX_E2E_RUN_ID`、`NEX_DESKTOP_AGENT_BYTECODE`、`NEX_SKIP_BUILD`                                                                         | 开发态开关                           |
| **CDN / 端点**      | `NEX_BASE_URL`、`NEX_CDN_BASE_URL`、`NEX_ENDPOINT_ORIGIN`、`NEX_FEEDBACK_API_BASE`                                                                                        | ⚠️ 默认值指向 `zcode.z.ai`，见第二节 |
| **二进制覆盖**      | `NEX_GIT_BINARY`、`NEX_PTY_ENTRY`、`NEX_PLUGIN_ROOT`、`NEX_CUA_PLUGIN_ROOT`                                                                                               | 依赖注入点                           |

### 1.4 值得注意的结构性特征

**a) 存在集中式白名单，但只覆盖了一部分。** `runtimeEnv.ts` 规范地管理了 16 个「需要跨 Host 边界传递」的环境变量（尤其 CUA 和网络配置），而另外 39 个是散落的 `process.env.X` 直读。**这意味着没有单一的「全部环境变量清单」可供迁移对照**——Go/Rust 重写时必须逐个 grep，这是一处真实的迁移摩擦点（规模不大，但缺少权威来源）。

**b) `NEX_CUA_DEV_MODE` 是刻意的单开关。** 源码注释说明它替代了「历史上的四变量咒语」，用于一键启动本地 CUA 全链路；且**在正式 desktop/Helper 构建中于编译期关闭并在 main→host 边界删除**，不能用于 signed release 的运行时覆盖。**这类编译期裁剪逻辑在移植时极易遗漏。**

**c) CUA 相关变量虽多，但本 build 中 CUA 是 fail-closed 占位实现**（`packages/nex-cua` 每个运行面都报告不可用）。所以 `NEX_CUA_*` 这 6 个变量目前**实际不生效**，属于为未来预留。

---

## 二、zcode / z.ai 字样

### 2.1 总体规模

`zcode` / `z.ai` / `zai-org` 在源码中共命中 **52 个文件**（不含 node_modules 与构建产物）。但**这个数字几乎无意义**——它们的性质差异极大，从「用户可见的错误文案」到「Apache-2.0 归属声明」都算在一起。

按性质分类后，真正需要关注的只有一小部分：

### 2.2 分类清单

#### 🟥 A 类：面向用户的界面文案（**最需要处理**）

共 **16 处**，全部在 i18n 文案表与落地页：

| 文件                                                         | 内容                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui/src/i18n/locales/en-US.ts`（8 处）              | 订阅/额度相关文案，如 `"Connect Z.ai"`、`"In-app subscription is only connected for Z.ai / BigModel Coding Plan right now."`、Stripe 订阅同意条款 `"You agree that Z.ai will charge your card..."` |
| `packages/ui/src/i18n/locales/zh-CN.ts`（7 处）              | 同上的中文版本                                                                                                                                                                                     |
| `packages/web/src/share/ConversationShareLandingPage.tsx:77` | `NEX_DOWNLOAD_URL = "https://zcode.z.ai"`                                                                                                                                                          |

⚠️ **注意其中 2 条是未本地化的英文残留**，混在 zh-CN 表里：

- `zh-CN.ts:2931` `"Amount due: {price}. Choose PayPal or continue on the official Z.ai payment page."`
- `zh-CN.ts:3013` `"You agree that Z.ai will charge your card the above amount now and on a recurring basis..."`

已核实：两条在 `en-US.ts` 中均有对应条目（`3139` / `3221`），说明是**漏翻而非有意保留**。

**这两条同时含未翻译文案与 `Z.ai` 字样，是 A 类里唯一同时命中两个问题的地方。**

#### 🟧 B 类：硬编码的官方端点 URL（**功能性依赖，改动有风险**）

**6 处，全部指向 `zcode.z.ai` / `cdn-zcode.z.ai`：**

| 文件                                                                        | 常量                              | 用途                  |
| --------------------------------------------------------------------------- | --------------------------------- | --------------------- |
| `packages/shared/src/nexEndpoint.ts:3`                                      | `DEFAULT_NEX_ENDPOINT_ORIGIN`     | **默认生产 API 端点** |
| `packages/desktop/src/main/remoteCdn.ts:4`                                  | `DEFAULT_CDN_BASE_URL`            | 远程资产 CDN          |
| `apps/nex-cli/packages/bootstrap/src/app/official-plugin-definitions.ts:58` | `OFFICIAL_PLUGIN_ASSETS_BASE_URL` | 官方插件资产          |
| `packages/ui/src/v4/featureSuggestedPrompts.ts:11`                          | `ASSETS`                          | 推荐提示词资产        |
| `packages/ui/src/lib/productDocs.ts:2`                                      | `NEX_PRODUCT_DOCS_URL`            | 文档链接              |
| `packages/services/src/conversation-share/conversationShareService.ts:721`  | 注释：兜底写死生产站              | 会话分享              |

⚠️ **这些不是「残留」，而是 Nex 仍在使用的上游基础设施。** 域名是 `zcode.z.ai` 但路径已是 nex（`cdn-zcode.z.ai/nex/...`）。**不能简单替换域名**——除非上游已提供对应域名。

#### 🟨 C 类：打包元数据

`packages/desktop/electron-builder.config.js` 3 处：`homepage: "https://zcode.z.ai"`、`email: "dev@zcode.z.ai"`、`maintainer: "Nex <dev@zcode.z.ai>"`。

**产物名本身已是 `Nex Preview` / `Nex`，不是 ZCode**（实测 DMG 为 `Nex Preview-1.0.0-mac-arm64_TEST.dmg`）。所以这是**联系信息沿用上游**，不是品牌残留。

#### 🟩 D 类：迁移兼容代码（**必须保留，不可清理**）

6 处 `copyLegacyDataDirOnce(..., ".zcode")`——首次运行时把旧 `~/.zcode` 数据复制到 `~/.nex`：

```
packages/services/src/paths.ts:45
packages/desktop/src/main/desktopDataBaseDirBootstrap.ts:43
apps/nex-cli/packages/adapters/src/storage/legacy-home-migration.ts:11
packages/services/src/subagents/subagentStorage.ts:27
apps/nex-cli/packages/core/src/runtime/helpers/plan-file-continuity.ts:20
packages/services/test/legacyDataDirCopy.test.ts（+1）
```

**这是给真实用户的升级路径，删掉会导致老用户数据丢失。** 其中 `plan-file-continuity.ts` 是唯一带测试保护的（`packages/services/test/legacyDataDirCopy.test.ts`）。

#### 🟩 E 类：配置键 / 插件命名空间

```
packages/shared/src/plugin-marketplaces.ts:45   "zcode-plugins-official"
apps/nex-cli/packages/adapters/src/config/schema.ts:181-182
  "nex-cua@zcode-plugins-official" / "computer-use@zcode-plugins-official"
```

**这些是持久化配置中的键名，改名会导致已有用户配置失效**，与 D 类同理需保留。

#### ⚪ F 类：上游署名与文档（**正确，不应改**）

- `NOTICE.md` 9 处、`LICENSE`、`THIRD-PARTY-NOTICES.md` — Apache-2.0 归属声明
- `README.md` / `README.zh-CN.md` 各 2 处 — 「本项目 fork 自 ZCode v3.14.3」的来源说明
- `CHANGELOG.md` 17 处、`docs/zcode-vs-nex-diff.md` 24 处、`docs/cua-product-implementation-analysis.md` 23 处、`docs/research/*.md` — 变更历史与分析文档

**这些是合规必需和历史记录，改动反而是错误的。**

#### ⚪ G 类：供应商品牌（**正确，不应改**）

`packages/shared/src/model-provider-family.ts` 中的 `label: "Z.ai"`、`rootDomain: "z.ai"`、`teamCodingPlanManageUrl`；`nex-slash-command-help.ts` 的登录/登出帮助文案；`official-coding-plan-gateway.ts` 的注释。

**Z.ai 是 Nex 实际接入的模型供应商（GLM / BigModel Coding Plan），这是真实业务依赖。** 与 Nex 品牌无关，不在清理范围。

---

## 三、结论与建议

### 3.1 数字总结

| 项                         |   数量 | 说明                                 |
| -------------------------- | -----: | ------------------------------------ |
| `NEX_` 唯一串（朴素 grep） |    269 | **失真**，含错误码/常量/误匹配       |
| **`NEX_` 真实环境变量**    | **55** | 39 直读 + 16 集中声明                |
| `zcode`/`z.ai` 命中文件    |     52 | **几乎无意义**，性质从文案到合规声明 |
| └ A 类 用户可见文案        |  16 处 | 唯一真正需要产品决策的               |
| └ B 类 硬编码端点 URL      |   6 处 | 功能依赖，改动需上游配合             |
| └ C 类 打包元数据          |   3 处 | 联系信息沿用上游                     |
| └ D+E 类 迁移兼容/配置键   |  12 处 | **不可清理**                         |
| └ F+G 类 署名/供应商       | 30+ 处 | **不应改动**                         |

### 3.2 三条可执行建议

1. **A 类的 16 处文案值得处理**——这是唯一「用户能看见、且 Nex 品牌上确实该改」的部分。其中 zh-CN 表里那 2 条未翻译的英文（`Amount due` / `You agree that Z.ai will charge...`）是顺带发现的独立缺陷，建议一并修。

2. **B 类的 6 个 URL 需要产品决策，不是清理任务**——`zcode.z.ai` 是 Nex 仍在用的上游基础设施。**如果 Nex 计划长期独立运营，需要先确认是否有自有域名**；在那之前这些 URL 不能动，否则会直接打断生产链路。

3. **D/E 类的 12 处必须保留**——`.zcode` 目录复制和 `zcode-plugins-official` 配置键是真实用户的升级路径与现有配置载体，清理会造成数据丢失或配置失效。**任何批量替换 zcode 字样的操作都必须显式排除这 12 处。**

### 3.3 与重写分析的一个交叉发现

第一节的 `NEX_` 环境变量分布，对上一轮的 Go/Rust 重写评估有直接影响：

- **缺少集中式 env 清单**。`runtimeEnv.ts` 只规范了 16 个跨进程传递用的变量，另外 39 个散落各处。移植到 Go/Rust 时没有单一权威来源可对照，**必须逐个 grep 重建清单**。
- **`NEX_AGENT_SERVER_COMMAND` / `_ARGS_JSON` / `_CWD` 这组 3 个变量定义了 Go/Rust 版 agent 子进程的启动协议**，语义上等价于当前 `app-server --stdio --surface desktop`。这一组是迁移时**行为一致性风险最集中的点**——它同时影响桌面本地、远端 SEA、以及开发态三条路径。
- **`NEX_CUA_DEV_MODE` 的编译期裁剪逻辑**（正式构建中关闭并在进程边界删除）说明：环境变量在本项目里不只是「读」，还有「构建期消除」的语义。这类逻辑在移植时极易遗漏，且**遗漏后不会立刻报错**——与第六部分说的测试覆盖缺口是同一类风险。
