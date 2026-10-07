import assert from "node:assert/strict";
import test from "node:test";
import { petWindowSize, resolvePetMenuOffset } from "../src/main/petWindowLayout.js";

const WORK = { x: 0, y: 0, width: 1920, height: 1080 };

test("窗口尺寸 = 精灵 + 控制行；精灵很窄时宽度保底容纳控制条", () => {
  assert.deepEqual(petWindowSize(160), { width: 160, height: 173 + 32 });
  assert.deepEqual(petWindowSize(80), { width: 96, height: 87 + 32 });
});

test("右键菜单：右侧放得下时贴着窗口右侧弹出，纵向取窗口高度的 1/4", () => {
  const offset = resolvePetMenuOffset({ x: 200, y: 200, width: 112, height: 153 }, WORK);
  assert.deepEqual(offset, { x: 112 + 4, y: 38 });
});

test("右键菜单：右侧放不下时改放左侧（偏移为负）", () => {
  const offset = resolvePetMenuOffset({ x: 1800, y: 200, width: 112, height: 153 }, WORK);
  assert.ok(offset.x < 0);
  assert.equal(offset.x, -(96 + 4));
});

test("右键菜单：恰好放得下的边界仍放右侧", () => {
  // 窗口右缘距工作区右缘 = 菜单宽 + 间隙 = 100。
  const offset = resolvePetMenuOffset({ x: 1920 - 112 - 100, y: 0, width: 112, height: 153 }, WORK);
  assert.ok(offset.x > 0);
});

test("右键菜单：找不到显示器时默认放右侧", () => {
  assert.ok(resolvePetMenuOffset({ x: 0, y: 0, width: 112, height: 153 }, null).x > 0);
});
