# 桌面宠物（Pets）：Codex 宠物格式兼容

Status: accepted
Owner: packages/ui (pets runtime + settings pets section), packages/services/src/pets (pet catalog)
Related: `packages/shared/src/nex-protocol-v4/sessions-index.ts`（状态数据源）、`docs/specs/memory-panel-preview.md`（设置分区模式参考）

## 产品规则

- 宠物是 agent 工作状态的桌面级伴侣：一张动画精灵图，聚合当前窗口**所有 workspace** 的会话状态（任一 workspace 有待处理审批即整体 waiting），不随单个 workspace 切换重置。
- 兼容 Codex 宠物资产格式：目录 `<petId>/` 内含 `pet.json`（manifest）+ 精灵图（默认 `spritesheet.webp`），固定 8 列、帧尺寸 192×208。v1 为 9 行（整图 1536×1872），v2 为 11 行（1536×2288，官方内置宠物全是 v2；社区宠物按整图高度判定）。动画靠**行约定**（第 0 行 idle、1/2 行左右移动、3 行挥手、4 行跳跃、5 行 failed、6 行 waiting、7 行 running、8 行 review；v2 另有 9/10 行共 16 帧的「看向光标」环），manifest 可选覆盖 `frame` 网格与 `animations` 帧序列。
- 宠物目录统一放 **`~/.nex/pets/`**（即 `{getNexDataRootDir()}/pets/`，尊重 `NEX_DATA_BASE_DIR` 与自定义数据根）。**不读** `~/.codex/pets/`。
- 本期**不提供官方内置宠物**、不接任何 CDN。首次进入为空态，设置页引导用户自行把社区宠物目录放入 `~/.nex/pets/` 后点「刷新」。
- 语义状态四档（优先级从高到低）：`waiting`（有待处理审批/用户输入）> `failed`（会话出错，1 小时回落）> `review`（有后台完成未读会话，7 天回落）> `running`（有会话运行中，3 分钟回落）> 默认 `idle`。
- 呈现分平台：
  - **Desktop**：独立透明置顶悬浮窗（always-on-top，不抢焦点，可点击聚焦主窗口）。位置由用户拖拽，重启后记忆。
  - **Web**：应用内 `fixed` 定位浮动挂件（右下角默认，可拖拽换位）。不做系统级悬浮窗、不做 Document PiP。
- 设置页新增独立分区「宠物」（`agentCapabilities` 组）：顶部当前宠物预览卡 + 开/关、宠物网格选择、刷新、「创建宠物」按钮本期禁用占位（等图片生成能力）。
- 「无可用宠物」或「开关关闭」时，挂件与悬浮窗完全静默（不渲染任何占位 UI）。
- 尊重系统 reduce-motion：命中时只渲染动画首帧静止图。
- 播放语义（对齐 Codex）：`idle` 循环，逐帧时长 ×6（缓慢呼吸）；其余状态动画播放 3 遍后落回 idle 循环。
- 交互动画（优先级从高到低）：拖拽中 `running-left/right`（按水平位移方向）> 悬停：v2 宠物且语义状态为 idle 时「看向光标」，其余情况 `jumping` > 语义状态。
- 看向光标：以宠物中心为原点，`angle = atan2(dx, -dy)`，16 个 22.5° 扇区，`sector = round(angle/22.5) % 16`，`column = sector % 8`、`row = 9 + floor(sector/8)`；距中心 < 1px 时忽略。仅 v2 精灵图（≥11 行）启用。
- 宠物大小：`pet.size`（宽度 px，80–224，默认 112），高度按 192:208 推导；设置页提供滑杆与重置。
- 桌面悬浮窗拖拽（main 持有拖拽状态机，renderer 只上报指针事件）：
  - renderer 用 pointer capture + 4px 死区区分点击与拖拽，上报 `drag-start/move/end`（屏幕坐标）；拖拽期间窗口跟手，指针移出窗口不丢拖拽。
  - 松手速度取最近 ≤160ms 的采样，低于 320px/s 视为抖动丢弃，上限 1600px/s，发送时 ×3；有速度则进入动量（16ms tick，摩擦 `0.88^(dt/16)`，边缘碰撞弹性 0.7，速度 <65px/s 或 900ms 结束）。
  - **默认自由放置**：宠物可被放在屏幕任意位置，落定时只夹回可见工作区、不吸附。按住 Alt 松手才吸附到最近的 6 个边缘区（左/中/右 × 上/下，边距 16px，160ms 缓动）。首次出现的默认落点是主显示器右下角（自由态）。
  - 位置按显示器持久化（`pet.windowPosition` + `windowDisplayId`，Alt 吸附时另记 `windowSnapZone`）。吸附态在显示器分辨率变化后按新工作区重算；自由态与显示器被拔除时窗口夹回可见区域。
- 右键菜单（仅 Desktop，原生菜单，跟随应用语言；**贴着宠物窗右侧弹出**，右侧放不下才放左侧——宠物窗层级更高，在光标处弹出会被宠物自己盖住一半）：「隐藏」= 关闭宠物开关（与设置页开关同一份 `pet.enabled`，落盘后通知主窗口刷新）；「设置」= 把主窗口带到前台并打开设置页「宠物」分区。
- 悬停控制行（仅 Desktop 悬浮窗）：精灵下方固定 32px 的控制行，鼠标悬停时淡入一个胶囊，内含「新对话」「语音」两个**纯图标**按钮（中间一条分隔线；文案只在 tooltip / aria-label，窗口很窄放不下文字）。胶囊自带深色底，浅色和深色桌面都可读。**本期按钮禁用占位，不接任何行为**（tooltip 标注「即将推出」）；悬浮窗宽度至少 96px 以容纳控制条，窗口高度 = 精灵高度 + 控制行。
- 显示方式（`pet.visibility`，仅 Desktop）：`always`（默认，常驻）或 `on-demand`——悬浮窗默认隐藏，按全局快捷键 `CommandOrControl+Alt+P` 唤出并获得焦点，再按一次或点击窗口外（失焦，唤出后 300ms 内忽略）隐藏。快捷键注册失败（被占用）时回退为常显。快捷键固定，本期不可自定义。
- 明确不做（研究报告第 8 节取舍）：`setInputShape` 命中测试（窗口与精灵等大，无透明死区）、macOS 私有 AppKit 桥与 `sky.node` 原生拖拽（私有 API，JS 拖拽已足够流畅）、通知托盘 / Quick Chat / 听写复用（属 Codex Mini 悬浮层，另立功能）、`codex://` deep-link 安装（引入下载与安全面，用户手动放置目录即可）。
- 本期不做：宠物游戏化行为、`~/.codex` 目录读取、官方宠物分发、创建宠物 skill、通知托盘 / Quick Chat / 听写复用、deep-link 安装、macOS 私有 AppKit 桥与原生拖拽（悬浮窗紧贴精灵，无需 input shape 命中测试）。

## 状态所有者与数据流

```
~/.nex/pets/<id>/{pet.json, spritesheet.webp}
   │  IPetService.listPets()：扫描 + zod 校验 + 精灵图存在性检查
   │  （services 层，desktop host 与 nex serve 各自持有一份实例）
   ▼
设置页 Pets 分区：选择/开关 → ISettingService.update（setting.json 的 pet 字段，
   │                 复用现有 settings 广播通道；不改 BROADCAST_FIELDS）
   ▼
宠物运行时（packages/ui/src/pets/，纯 UI 派生态，不落盘）
   acquireSessionsIndex(scope, nexAgentService)  ← 与系统通知同一条订阅路径
   SessionSummary.phase + pendingInteraction + lastActivityAt
     ──▶ petStateMachine（纯函数）──▶ PetAnimationName
   │
   ├─ Web/Desktop 主窗口：PetFloatingWidget（React canvas 播放）
   └─ Desktop 悬浮窗：IPlatformService.syncPetState → main 进程
                        → pet BrowserWindow（独立 renderer，单向状态推送）
```

- **宠物目录唯一读写者**：`IPetService`（`packages/services/src/pets`）。UI 不直接访问文件系统。
- **选中宠物与开关唯一所有者**：`setting.json`（经 `ISettingService`），键 `pet: { enabled: boolean; petId: string | null; anchor?: PetAnchor }`。UI 局部拖拽位置属于展示态，桌面悬浮窗位置由 desktop main 持久化到 setting.json 同一字段。
- **宠物语义状态**：纯派生，唯一来源是 sessions-index 的 `SessionSummary` 流；不写回任何服务端或本地持久层。切换 workspace / 断连时重置为 `idle`。
- **桌面悬浮窗生命周期所有者**：desktop main（创建/销毁/置顶级别/位置记忆）。pet 状态经 IPC 单向 main → pet window；pet window 只回传用户动作（点击聚焦）。
- 精灵图访问：desktop 用 `createLocalMediaPreviewUrl`（nex-media 授权协议）；web 由 server 提供 `/api/pets/:id/spritesheet`（token 保护，复用 `isTokenProtectedPath` 既有规则）。

## 接口

- `IPetService`（services 公开契约，RPC 注册频道 `ServiceChannels.Pets`）：
  - `listPets(): Promise<{ pets: PetSummary[]; errors: PetLoadError[] }>`
  - `getPetSpritesheetPath(params: { petId: string }): Promise<{ path: string } | null>`
  - `refreshPets(): Promise<{ pets: PetSummary[]; errors: PetLoadError[] }>`（清缓存后重扫）
- `PetSummary = { id, displayName, description, dirPath, spritesheetFileName, manifest, spriteRows }`（`@nex/shared`）；`spriteRows` = 图高 / 帧高，≥ 11 表示带看向光标环。
- `PetLoadError = { dirName, reason }`：单个目录非法不阻塞其他宠物。
- `PetWindowAction`（pet-window → main，经 zod 校验）：`focus-main-window`、`show-context-menu`、`drag-start`、`drag-move`、`drag-end`（含 `altKey` 与可选 `velocity`），指针坐标均为屏幕坐标。
- `IPlatformService` 新增（可选方法）：
  - `syncPetState?(state: PetWindowState | null): void`——`null` 表示销毁/隐藏悬浮窗。
  - `onPetWindowAction?(handler: (action: PetWindowAction) => void): () => void`——pet window 点击等动作回传。
- IPC：`PlatformChannels.SyncPetState`（renderer→main invoke）、`PlatformChannels.PetWindowState`（main→pet-window send）、`PlatformChannels.PetWindowAction`（pet-window→main send）。

## 不变量

- 宠物悬浮窗**不得改变应用的激活策略**：窗口层级用 `floating`，用 `setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true })` 跟随所有桌面空间，且**不**设置 `visibleOnFullScreen`。Electron 在 `visibleOnFullScreen: true` 时会把整个进程转成 accessory（UIElement）应用：Dock 图标消失（与「在 Dock 中显示图标」设置冲突）、Nex 窗口会盖在全屏 app 上，并且从全屏 app 返回 Nex 后该屏幕的菜单栏整条消失（用户实测：关闭宠物后恢复正常）。代价是宠物不会浮在全屏 app 之上，与 Codex 一致（`floating`，无全屏标志）。
- 精灵图网格必须铺满：`frameWidth × columns == 图宽`，图高为 `frameHeight` 整数倍且不少于声明行数；默认 192×208 / 8×9，官方 v1 1536×1872、v2 1536×2288。
- `pet.json` 中 `spritesheetPath` 只允许**目录内相对路径**；绝对路径与任何 `..` 段一律拒绝。
- manifest `animations` 覆盖时：帧索引 `< columns × rows`、帧总数 ≤ 256、`fps ∈ (0, 60]`、`fallback` 必须指向已定义动画。
- 单个宠物目录非法只计入 `errors[]`，不影响其他宠物加载；设置页展示错误列表。
- 宠物状态是派生只读：任何组件不得把宠物动画状态写回 setting/sessions-index。
- 无宠物 / 开关关闭 / workspace 未就绪（rpcReady=false）时，双端均不渲染任何宠物 UI。
- 遵循 `workspaceIdentity?.trim() || workspacePath` 作为订阅 scope 键（与既有 sessions-index 消费方一致）。

## 失败语义

- `~/.nex/pets/` 不存在：返回空列表，非错误。
- `pet.json` 缺失或 JSON/zod 校验失败：该目录进 `errors[]`，跳过。
- 精灵图文件缺失或尺寸不满足网格不变量：该目录进 `errors[]`，跳过。
- 选中的 petId 之后被删除：运行时回退为「无宠物」静默态；设置页网格高亮消失。
- 精灵图图片解码失败（损坏的 WebP）：挂件/悬浮窗显示静止占位（首帧区域空白），不崩溃、不重试刷屏。
- 桌面悬浮窗创建失败（如 Linux 合成器不支持透明）：降级为主窗口内浮动挂件，并在设置页提示。

## 验收场景

1. 桌面端：`~/.nex/pets/tater/` 放入合法宠物（pet.json + spritesheet.webp）→ 设置页「宠物」分区出现该宠物卡片 → 选中并开启 → 桌面出现透明置顶悬浮窗，播放 idle 动画。
2. 桌面端触发一次 turn：悬浮窗动画切到 `running`；turn 后台完成且窗口未聚焦 → 切到 `review`；出现权限请求 → 切到 `waiting`（最高优先级）；runtime 报错 → 切到 `failed`。
3. 关闭开关或删除宠物目录并刷新：悬浮窗销毁，无残留 UI。
4. Web 端（含远程 workspace）：同一宠物出现在网格；选中开启后右下角出现浮动挂件；触发 turn 状态同步切换；切换 workspace 后状态回落 `idle`。
5. 非法目录（缺 manifest / 精灵图尺寸错误 / spritesheetPath 越界）→ 不出现在网格，错误原因列在设置页。
6. 系统开启 reduce-motion：双端只渲染静止首帧。
7. 拖拽悬浮窗换位，重启桌面端后位置保持；Web 挂件拖拽换位当次会话内保持。
8. 社区 Codex 宠物包（如 `codex-pets` 仓库任选一只）原样放入 `~/.nex/pets/` 即可被识别播放，无需任何转换。
