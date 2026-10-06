/**
 * Codex 兼容宠物精灵图格式常量与默认动画表（行约定）。
 *
 * 事实来源：openai/codex `codex-rs/tui/src/pets/model.rs`（默认动画集）与
 * 社区 atlas 还原（codex-pets-react）。注意 Rust TUI 的 idle 帧时长
 * （[1680,660,660,840,840,1920]ms）与社区还原的官方 atlas（[280,110,110,140,140,320]ms）
 * 存在 6× 分歧；这里采用 atlas 值作为默认（App/Web 侧观感），并在 spec 中注明分歧。
 * 详见 docs/specs/desktop-pets.md。
 */

/** 默认整图尺寸（px）。 */
export const PET_SPRITESHEET_WIDTH = 1536;
export const PET_SPRITESHEET_HEIGHT = 1872;
/** 默认网格。 */
export const PET_FRAME_WIDTH = 192;
export const PET_FRAME_HEIGHT = 208;
export const PET_FRAME_COLUMNS = 8;
export const PET_FRAME_ROWS = 9;
/** 单只宠物帧索引上限（与 codex model.rs 的 MAX_PET_FRAMES 对齐）。 */
export const PET_MAX_FRAMES = 256;
/** 自定义动画 fps 上限。 */
export const PET_MAX_FPS = 60;

export const PET_MANIFEST_FILE_NAME = "pet.json";
export const PET_DEFAULT_SPRITESHEET_FILE_NAME = "spritesheet.webp";

/** 宠物动画名（与 codex TUI 命名对齐；App 侧别名见 PET_ANIMATION_ALIASES）。 */
export type PetAnimationName =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

/** App 侧别名 → 行约定动画名。 */
export const PET_ANIMATION_ALIASES: Record<string, PetAnimationName> = {
  move_right: "running-right",
  move_left: "running-left",
  wave: "waving",
  bounce: "jumping",
  sad: "failed",
};

export interface PetDefaultAnimation {
  /** 精灵图行号（0..8）。 */
  row: number;
  /** 该行有效帧数（行内连续帧，从列 0 开始）。 */
  frameCount: number;
  /** 逐帧时长（ms），长度等于 frameCount。 */
  frameDurationsMs: readonly number[];
}

/**
 * 行约定默认动画表。manifest 未声明 animations 时使用。
 * 帧时长取社区还原的官方 atlas 值。
 */
export const PET_DEFAULT_ANIMATIONS: Readonly<Record<PetAnimationName, PetDefaultAnimation>> = {
  idle: { row: 0, frameCount: 6, frameDurationsMs: [280, 110, 110, 140, 140, 320] },
  "running-right": {
    row: 1,
    frameCount: 8,
    frameDurationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  "running-left": {
    row: 2,
    frameCount: 8,
    frameDurationsMs: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  waving: { row: 3, frameCount: 4, frameDurationsMs: [140, 140, 140, 280] },
  jumping: { row: 4, frameCount: 5, frameDurationsMs: [140, 140, 140, 140, 280] },
  failed: {
    row: 5,
    frameCount: 8,
    frameDurationsMs: [140, 140, 140, 140, 140, 140, 140, 240],
  },
  waiting: { row: 6, frameCount: 6, frameDurationsMs: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, frameCount: 6, frameDurationsMs: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, frameCount: 6, frameDurationsMs: [150, 150, 150, 150, 150, 280] },
};

export const PET_ANIMATION_NAMES = Object.keys(PET_DEFAULT_ANIMATIONS) as PetAnimationName[];

/** 宠物语义状态的生命周期（超时回落 idle），与 Codex ambient.rs 对齐。 */
export const PET_STATE_LIFETIMES_MS = {
  running: 3 * 60 * 1000,
  waiting: 24 * 60 * 60 * 1000,
  review: 7 * 24 * 60 * 60 * 1000,
  failed: 60 * 60 * 1000,
} as const;

/** 宠物展示尺寸（px）：挂件/悬浮窗中的目标高度。帧高 208 → 缩放比例由此推导。 */
export const PET_DISPLAY_HEIGHT_PX = 96;
