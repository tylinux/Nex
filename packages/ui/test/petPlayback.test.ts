import assert from "node:assert/strict";
import test from "node:test";
import {
  PET_DEFAULT_ANIMATIONS,
  PET_FRAME_HEIGHT,
  PET_ONE_SHOT_REPEAT_COUNT,
  clampPetSize,
  mergePetPlacement,
  mergePetSettings,
  petWindowActionSchema,
} from "@nex/shared";
import {
  appendPetPointerSample,
  resolvePetPresentation,
  updatePetDragDirection,
} from "../src/pets/petInteraction.js";
import { buildPetPlaybackSequence, resolvePetLookFrame } from "../src/pets/petSpriteFrames.js";

test("idle 播放序列：逐帧时长 ×6 并从头循环", () => {
  const sequence = buildPetPlaybackSequence(null, "idle");
  assert.equal(sequence.loopStartIndex, 0);
  assert.equal(
    sequence.frames[0]?.durationMs,
    PET_DEFAULT_ANIMATIONS.idle.frameDurationsMs[0]! * 6,
  );
});

test("一次性动画：播放 3 遍后落入 idle 循环段", () => {
  const sequence = buildPetPlaybackSequence(null, "running");
  const runningFrames = PET_DEFAULT_ANIMATIONS.running.frameCount;
  const idleFrames = PET_DEFAULT_ANIMATIONS.idle.frameCount;
  assert.equal(sequence.loopStartIndex, runningFrames * PET_ONE_SHOT_REPEAT_COUNT);
  assert.equal(sequence.frames.length, runningFrames * PET_ONE_SHOT_REPEAT_COUNT + idleFrames);
  assert.equal(sequence.frames[sequence.loopStartIndex]?.sy, 0);
});

test("看向光标帧：v2 才可用，取第 9/10 行", () => {
  assert.equal(resolvePetLookFrame(null, 9, 3), null);
  const frame = resolvePetLookFrame(null, 11, 8);
  assert.equal(frame?.sy, 10 * PET_FRAME_HEIGHT);
  assert.equal(frame?.sx, 0);
});

test("动画优先级：拖拽 > 悬停 > 语义状态", () => {
  const base = { spriteRows: 11, lookSector: 4 };
  assert.deepEqual(
    resolvePetPresentation({
      ...base,
      semantic: "waiting",
      dragDirection: "running-left",
      hovering: true,
    }),
    { animationName: "running-left", lookSector: null },
  );
  assert.deepEqual(
    resolvePetPresentation({ ...base, semantic: "idle", dragDirection: null, hovering: true }),
    { animationName: "idle", lookSector: 4 },
  );
  assert.deepEqual(
    resolvePetPresentation({ ...base, semantic: "running", dragDirection: null, hovering: true }),
    { animationName: "jumping", lookSector: null },
  );
  assert.deepEqual(
    resolvePetPresentation({
      spriteRows: 9,
      lookSector: 4,
      semantic: "idle",
      dragDirection: null,
      hovering: true,
    }),
    { animationName: "jumping", lookSector: null },
  );
  assert.deepEqual(
    resolvePetPresentation({ ...base, semantic: "failed", dragDirection: null, hovering: false }),
    { animationName: "failed", lookSector: null },
  );
});

test("拖拽方向：水平位移不足 4px 保持原方向，超过则翻转", () => {
  let current = { direction: null as "running-left" | "running-right" | null, anchorX: 100 };
  current = updatePetDragDirection(current, 102);
  assert.equal(current.direction, null);
  current = updatePetDragDirection(current, 110);
  assert.equal(current.direction, "running-right");
  current = updatePetDragDirection(current, 108);
  assert.equal(current.direction, "running-right");
  current = updatePetDragDirection(current, 100);
  assert.equal(current.direction, "running-left");
});

test("指针采样只保留窗口内样本", () => {
  const samples = appendPetPointerSample(
    [
      { x: 0, y: 0, timeMs: 0 },
      { x: 1, y: 0, timeMs: 150 },
    ],
    { x: 2, y: 0, timeMs: 300 },
    160,
  );
  assert.deepEqual(
    samples.map((sample) => sample.timeMs),
    [150, 300],
  );
});

test("宠物大小夹取到 80–224，缺省 112", () => {
  assert.equal(clampPetSize(undefined), 112);
  assert.equal(clampPetSize(10), 80);
  assert.equal(clampPetSize(999), 224);
  assert.equal(clampPetSize(130.4), 130);
});

test("mergePetSettings：保留既有字段，undefined 表示清除", () => {
  const merged = mergePetSettings(
    {
      enabled: true,
      petId: "bubu",
      windowPosition: { x: 1, y: 2 },
      windowSnapZone: "top-left",
      size: 150,
    },
    { windowSnapZone: undefined, size: 160 },
  );
  assert.deepEqual(merged, {
    enabled: true,
    petId: "bubu",
    windowPosition: { x: 1, y: 2 },
    size: 160,
  });
  assert.deepEqual(mergePetSettings(undefined, { enabled: true }), { enabled: true, petId: null });
});

test("pet window 动作 schema：拒绝非法载荷", () => {
  assert.ok(petWindowActionSchema.safeParse({ kind: "focus-main-window" }).success);
  assert.ok(
    petWindowActionSchema.safeParse({
      kind: "drag-end",
      pointerX: 1,
      pointerY: 2,
      altKey: false,
      velocity: { x: 3, y: 4 },
    }).success,
  );
  assert.equal(
    petWindowActionSchema.safeParse({ kind: "drag-move", pointerX: "1", pointerY: 2 }).success,
    false,
  );
  assert.equal(
    petWindowActionSchema.safeParse({ kind: "drag-move", pointerX: Infinity, pointerY: 2 }).success,
    false,
  );
  assert.ok(petWindowActionSchema.safeParse({ kind: "show-context-menu" }).success);
  assert.equal(petWindowActionSchema.safeParse({ kind: "moved", x: 1, y: 2 }).success, false);
});

test("mergePetPlacement：只写落点字段，不改 enabled / petId", () => {
  const merged = mergePetPlacement(
    { enabled: true, petId: "bubu", size: 150 },
    { x: 10, y: 20, displayId: 2 },
  );
  assert.deepEqual(merged, {
    enabled: true,
    petId: "bubu",
    size: 150,
    windowPosition: { x: 10, y: 20 },
    windowDisplayId: 2,
  });
});

test("mergePetPlacement：没有宠物设置时放弃写入，避免把宠物静默关掉", () => {
  assert.equal(mergePetPlacement(undefined, { x: 1, y: 2 }), null);
});
