import assert from "node:assert/strict";
import test from "node:test";
import {
  PET_MOMENTUM_MAX_MS,
  classifyPetSnapZone,
  clampPetToWorkArea,
  computePetReleaseVelocity,
  computePetSnapPosition,
  isPetMomentumSettled,
  petLookSectorCell,
  pickPetDisplay,
  resolvePetLookSector,
  restorePetPlacement,
  stepPetMomentum,
} from "@nex/shared";

const SIZE = { width: 100, height: 108 };
const WORK = { x: 0, y: 0, width: 1200, height: 800 };

test("松手速度：低于 320px/s 视为抖动", () => {
  const velocity = computePetReleaseVelocity([
    { x: 0, y: 0, timeMs: 0 },
    { x: 10, y: 0, timeMs: 100 },
  ]);
  assert.equal(velocity, null);
});

test("松手速度：有效速度乘 3，且原始速度上限 1600px/s", () => {
  const normal = computePetReleaseVelocity([
    { x: 0, y: 0, timeMs: 0 },
    { x: 80, y: 0, timeMs: 100 },
  ]);
  assert.deepEqual(normal, { x: 800 * 3, y: 0 });

  const fast = computePetReleaseVelocity([
    { x: 0, y: 0, timeMs: 0 },
    { x: 400, y: 0, timeMs: 100 },
  ]);
  assert.equal(fast?.x, 1600 * 3);
});

test("松手速度：只统计最近 160ms 的采样", () => {
  const velocity = computePetReleaseVelocity([
    { x: 0, y: 0, timeMs: 0 },
    { x: 500, y: 0, timeMs: 50 },
    { x: 500, y: 0, timeMs: 400 },
    { x: 500, y: 0, timeMs: 500 },
  ]);
  assert.equal(velocity, null);
});

test("动量：摩擦帧率无关（两个 8ms 步等价于一个 16ms 步的速度衰减）", () => {
  const start = { x: 500, y: 300, vx: 1000, vy: 0 };
  const once = stepPetMomentum(start, 16, SIZE, WORK);
  const twice = stepPetMomentum(stepPetMomentum(start, 8, SIZE, WORK), 8, SIZE, WORK);
  assert.ok(Math.abs(once.vx - twice.vx) < 1e-6);
});

test("动量：撞到右边缘以 0.7 弹性反弹", () => {
  const next = stepPetMomentum({ x: 1095, y: 300, vx: 1000, vy: 0 }, 16, SIZE, WORK);
  assert.equal(next.x, WORK.width - SIZE.width);
  assert.ok(next.vx < 0);
  assert.ok(Math.abs(next.vx) < 1000 * 0.7 + 1e-6);
});

test("动量结束条件：速度 <65px/s 或超过 900ms", () => {
  assert.equal(isPetMomentumSettled({ x: 0, y: 0, vx: 30, vy: 30 }, 10), true);
  assert.equal(isPetMomentumSettled({ x: 0, y: 0, vx: 500, vy: 0 }, 100), false);
  assert.equal(isPetMomentumSettled({ x: 0, y: 0, vx: 500, vy: 0 }, PET_MOMENTUM_MAX_MS), true);
});

test("吸附区：六个区域划分", () => {
  assert.equal(classifyPetSnapZone({ x: 100, y: 100 }, WORK), "top-left");
  assert.equal(classifyPetSnapZone({ x: 600, y: 100 }, WORK), "top-center");
  assert.equal(classifyPetSnapZone({ x: 1100, y: 100 }, WORK), "top-right");
  assert.equal(classifyPetSnapZone({ x: 100, y: 700 }, WORK), "bottom-left");
  assert.equal(classifyPetSnapZone({ x: 600, y: 700 }, WORK), "bottom-center");
  assert.equal(classifyPetSnapZone({ x: 1100, y: 700 }, WORK), "bottom-right");
});

test("吸附位置：16px 边距，居中区水平居中", () => {
  assert.deepEqual(computePetSnapPosition("top-left", WORK, SIZE), { x: 16, y: 16 });
  assert.deepEqual(computePetSnapPosition("bottom-right", WORK, SIZE), {
    x: 1200 - 100 - 16,
    y: 800 - 108 - 16,
  });
  assert.deepEqual(computePetSnapPosition("top-center", WORK, SIZE), { x: 550, y: 16 });
});

test("夹取：自由放置也不会落到工作区外", () => {
  assert.deepEqual(clampPetToWorkArea({ x: -50, y: 9999 }, SIZE, WORK), { x: 0, y: 800 - 108 });
});

test("选屏：取重叠面积最大的显示器，无重叠取最近", () => {
  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1000, height: 800 } },
    { id: 2, workArea: { x: 1000, y: 0, width: 1000, height: 800 } },
  ];
  assert.equal(pickPetDisplay({ x: 950, y: 100, ...SIZE }, displays)?.id, 1);
  assert.equal(pickPetDisplay({ x: 1100, y: 100, ...SIZE }, displays)?.id, 2);
  assert.equal(pickPetDisplay({ x: 5000, y: 100, ...SIZE }, displays)?.id, 2);
});

test("落点还原：无历史落点时落主显示器右下角（自由态，无吸附区）", () => {
  const restored = restorePetPlacement({
    placement: undefined,
    size: SIZE,
    displays: [{ id: 7, workArea: WORK }],
    primaryDisplayId: 7,
  });
  // 默认落右下角，但不记吸附区：宠物默认可被放在任意位置。
  assert.deepEqual(restored, { x: 1084, y: 676, displayId: 7 });
});

test("落点还原：吸附态在分辨率变化后按新工作区重新吸附", () => {
  const restored = restorePetPlacement({
    placement: { x: 1084, y: 676, displayId: 1, snapZone: "bottom-right" },
    size: SIZE,
    displays: [{ id: 1, workArea: { x: 0, y: 0, width: 800, height: 600 } }],
    primaryDisplayId: 1,
  });
  assert.deepEqual(restored, { x: 684, y: 476, displayId: 1, snapZone: "bottom-right" });
});

test("落点还原：显示器被拔除后迁移到仍存在的显示器并夹回可见区", () => {
  const restored = restorePetPlacement({
    placement: { x: 1500, y: 100, displayId: 2 },
    size: SIZE,
    displays: [{ id: 1, workArea: WORK }],
    primaryDisplayId: 1,
  });
  assert.deepEqual(restored, { x: 1100, y: 100, displayId: 1 });
});

test("看向光标：扇区由 atan2(dx,-dy) 决定，距中心 <1px 忽略", () => {
  assert.equal(resolvePetLookSector(0, -50), 0); // 正上
  assert.equal(resolvePetLookSector(50, 0), 4); // 正右
  assert.equal(resolvePetLookSector(0, 50), 8); // 正下
  assert.equal(resolvePetLookSector(-50, 0), 12); // 正左
  assert.equal(resolvePetLookSector(0.3, 0.3), null);
});

test("看向光标：扇区映射到第 9/10 行", () => {
  assert.deepEqual(petLookSectorCell(0), { row: 9, column: 0 });
  assert.deepEqual(petLookSectorCell(7), { row: 9, column: 7 });
  assert.deepEqual(petLookSectorCell(8), { row: 10, column: 0 });
  assert.deepEqual(petLookSectorCell(15), { row: 10, column: 7 });
});
