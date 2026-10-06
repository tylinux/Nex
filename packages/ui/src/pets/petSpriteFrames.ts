/**
 * 宠物精灵图帧切分（纯函数）：动画名 → 源矩形序列。
 * 行约定见 docs/specs/desktop-pets.md 与 @nex/shared 的 PET_DEFAULT_ANIMATIONS。
 */
import {
  PET_DEFAULT_ANIMATIONS,
  PET_DEFAULT_FRAME_GRID,
  type PetAnimationName,
  type PetFrameGrid,
  type PetManifest,
} from "@nex/shared";

export interface PetSpriteFrame {
  /** 源矩形（px，相对整图左上角）。 */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** 该帧展示时长（ms）。 */
  durationMs: number;
}

function gridOf(manifest: PetManifest | null): PetFrameGrid {
  return manifest?.frame ?? PET_DEFAULT_FRAME_GRID;
}

/** 行内连续帧（默认行约定）。 */
function framesFromRow(
  grid: PetFrameGrid,
  row: number,
  frameCount: number,
  durations: readonly number[],
): PetSpriteFrame[] {
  const frames: PetSpriteFrame[] = [];
  for (let column = 0; column < frameCount; column += 1) {
    frames.push({
      sx: column * grid.width,
      sy: row * grid.height,
      sw: grid.width,
      sh: grid.height,
      durationMs: durations[column] ?? 120,
    });
  }
  return frames;
}

/** manifest 自定义动画（帧索引行优先 + fps 折算）。 */
function framesFromSpec(
  grid: PetFrameGrid,
  spec: { frames: number[]; fps?: number },
): PetSpriteFrame[] {
  const durationMs = spec.fps ? 1000 / spec.fps : 125;
  return spec.frames.map((frameIndex) => {
    const row = Math.floor(frameIndex / grid.columns);
    const column = frameIndex % grid.columns;
    return {
      sx: column * grid.width,
      sy: row * grid.height,
      sw: grid.width,
      sh: grid.height,
      durationMs,
    };
  });
}

/**
 * 解析某只宠物某个动画的帧序列。
 * 优先 manifest.animations 覆盖；否则走默认行约定。
 * 动画名不存在时回退 idle。
 */
export function resolvePetAnimationFrames(
  manifest: PetManifest | null,
  animationName: string,
): PetSpriteFrame[] {
  const grid = gridOf(manifest);

  const custom = manifest?.animations?.[animationName];
  if (custom) {
    return framesFromSpec(grid, custom);
  }

  const defaultSpec = PET_DEFAULT_ANIMATIONS[animationName as PetAnimationName];
  if (defaultSpec) {
    // 默认行约定只在「网格与官方一致」时安全；自定义网格下帧行可能越界，
    // 越界时回退 idle（行 0 总是存在，因为网格校验要求铺满）。
    if (
      grid.width === PET_DEFAULT_FRAME_GRID.width &&
      grid.height === PET_DEFAULT_FRAME_GRID.height &&
      grid.columns === PET_DEFAULT_FRAME_GRID.columns &&
      grid.rows === PET_DEFAULT_FRAME_GRID.rows
    ) {
      return framesFromRow(
        grid,
        defaultSpec.row,
        defaultSpec.frameCount,
        defaultSpec.frameDurationsMs,
      );
    }
    if (animationName !== "idle") {
      return resolvePetAnimationFrames(manifest, "idle");
    }
    // 自定义网格 + idle：取行 0 的全部列。
    return framesFromRow(
      grid,
      0,
      grid.columns,
      Array.from({ length: grid.columns }, () => 200),
    );
  }

  // 未知动画名回退 idle。
  if (animationName !== "idle") {
    return resolvePetAnimationFrames(manifest, "idle");
  }
  return framesFromRow(grid, 0, Math.min(6, grid.columns), [280, 110, 110, 140, 140, 320]);
}
