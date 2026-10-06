/**
 * 桌面宠物跨进程/跨层共享类型。详见 docs/specs/desktop-pets.md。
 */

/** 宠物语义状态（与 PetAnimationName 对应的状态机输出）。 */
export type PetSemanticState = "idle" | "running" | "waiting" | "review" | "failed";

/** 宠物挂件/悬浮窗锚点。 */
export type PetAnchor = "bottom-right" | "bottom-left" | "top-right" | "top-left";

/** setting.json 中的宠物偏好（唯一所有者：ISettingService）。 */
export interface PetSettings {
  enabled: boolean;
  /** 选中的宠物目录 id；null = 未选择。 */
  petId: string | null;
  /** 挂件锚点（Web/Desktop 主窗口内）；悬浮窗位置由 desktop main 另行持久化。 */
  anchor?: PetAnchor;
  /** 桌面悬浮窗位置（CSS px，相对主屏幕左上角）；由 main 进程拖拽后写回。 */
  windowPosition?: { x: number; y: number };
}

/** 设置页网格条目。 */
export interface PetSummary {
  id: string;
  displayName: string;
  description: string;
  /** 宠物目录绝对路径（仅服务端/host 使用；不直接暴露给 renderer 渲染）。 */
  dirPath: string;
  /** 精灵图文件名（目录内相对）。 */
  spritesheetFileName: string;
  /** 校验通过的 manifest（含可选 frame/animations 覆盖）。 */
  manifest: import("./petManifest.js").PetManifest;
}

/** 单个宠物目录加载失败。 */
export interface PetLoadError {
  dirName: string;
  reason: string;
}

export interface PetListResult {
  pets: PetSummary[];
  errors: PetLoadError[];
}

/** renderer → main：悬浮窗状态（null 表示销毁/隐藏）。 */
export interface PetWindowState {
  petId: string;
  animation: PetSemanticState;
  /** 精灵图可访问 URL（desktop: nex-media:// 授权 URL；web: /api/pets/... ）。 */
  spriteUrl: string;
  position?: { x: number; y: number };
  /**
   * 拖拽覆盖动画（renderer 本地拖拽时置为 running-left/running-right，
   * main 侧不消费，仅 pet-window 本地展示；语义状态恢复后清除）。
   */
  dragAnimationOverride?: "running-left" | "running-right" | null;
}

/** pet-window → main：用户动作。 */
export type PetWindowAction =
  | { kind: "focus-main-window" }
  | { kind: "moved"; x: number; y: number }
  /** 拖拽中：请求 main 把窗口移到给定屏幕坐标（拖拽跟随）。 */
  | { kind: "drag-move"; x: number; y: number };
