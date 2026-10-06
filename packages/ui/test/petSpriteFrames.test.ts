import assert from "node:assert/strict";
import test from "node:test";
import { PET_DEFAULT_ANIMATIONS, PET_DEFAULT_FRAME_GRID } from "@nex/shared";
import { resolvePetAnimationFrames } from "../src/pets/petSpriteFrames.js";

test("默认行约定：idle 取第 0 行前 6 帧", () => {
  const frames = resolvePetAnimationFrames(null, "idle");
  assert.equal(frames.length, 6);
  assert.deepEqual(frames[0], {
    sx: 0,
    sy: 0,
    sw: PET_DEFAULT_FRAME_GRID.width,
    sh: PET_DEFAULT_FRAME_GRID.height,
    durationMs: 280,
  });
  assert.equal(frames[5]?.sx, 5 * PET_DEFAULT_FRAME_GRID.width);
});

test("默认行约定：review 取第 8 行", () => {
  const frames = resolvePetAnimationFrames(null, "review");
  assert.equal(frames.length, 6);
  assert.equal(frames[0]?.sy, 8 * PET_DEFAULT_FRAME_GRID.height);
});

test("未知动画名回退 idle", () => {
  const frames = resolvePetAnimationFrames(null, "nonexistent");
  const idle = resolvePetAnimationFrames(null, "idle");
  assert.deepEqual(frames, idle);
});

test("manifest.animations 覆盖默认行约定（帧索引行优先）", () => {
  const frames = resolvePetAnimationFrames(
    {
      animations: {
        custom: { frames: [0, 1, 8], fps: 10 },
      },
    },
    "custom",
  );
  // 帧索引 8 = 第 1 行第 0 列。
  assert.equal(frames.length, 3);
  assert.equal(frames[2]?.sy, PET_DEFAULT_FRAME_GRID.height);
  assert.equal(frames[2]?.sx, 0);
  assert.equal(frames[0]?.durationMs, 100);
});

test("行约定与官方常量一致（8 列 9 行，行映射不漂移）", () => {
  // 防漂移：PET_DEFAULT_ANIMATIONS 的行号约定一旦与 codex 不一致，
  // 兼容宠物就会播放错行动画。锁定关键映射。
  assert.equal(PET_DEFAULT_ANIMATIONS["running-right"].row, 1);
  assert.equal(PET_DEFAULT_ANIMATIONS["running-left"].row, 2);
  assert.equal(PET_DEFAULT_ANIMATIONS.failed.row, 5);
  assert.equal(PET_DEFAULT_ANIMATIONS.waiting.row, 6);
  assert.equal(PET_DEFAULT_ANIMATIONS.running.row, 7);
  assert.equal(PET_DEFAULT_ANIMATIONS.review.row, 8);
});
