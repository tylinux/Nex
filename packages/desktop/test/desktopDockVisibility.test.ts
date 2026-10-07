import assert from "node:assert/strict";
import test from "node:test";
import { createDockVisibilityController } from "../src/main/desktopDockVisibility.js";

function setup(platform: NodeJS.Platform = "darwin") {
  const calls: string[] = [];
  const dock = {
    show: () => {
      calls.push("show");
    },
    hide: () => {
      calls.push("hide");
    },
  };
  const controller = createDockVisibilityController({
    platform,
    dock,
    logger: { warn: () => {} },
  });
  return { calls, controller };
}

test("没有菜单栏入口时，关闭 Dock 图标的设置不生效", () => {
  const { calls, controller } = setup();
  controller.setPreference(false);
  assert.deepEqual(calls, []);
  controller.setMenuBarEntryAvailable(true);
  assert.deepEqual(calls, ["hide"]);
});

test("重复应用同一状态不会重复调用原生 API", () => {
  const { calls, controller } = setup();
  controller.setMenuBarEntryAvailable(true);
  controller.setPreference(false);
  controller.setPreference(false);
  controller.setPreference(true);
  controller.setPreference(true);
  assert.deepEqual(calls, ["hide", "show"]);
});

test("菜单栏图标消失后 Dock 图标自动恢复，避免应用失去入口", () => {
  const { calls, controller } = setup();
  controller.setMenuBarEntryAvailable(true);
  controller.setPreference(false);
  controller.setMenuBarEntryAvailable(false);
  assert.deepEqual(calls, ["hide", "show"]);
});

test("前台展示在用户隐藏 Dock 时不会把图标重新带回来", () => {
  const { calls, controller } = setup();
  controller.setMenuBarEntryAvailable(true);
  controller.setPreference(false);
  controller.revealForForeground();
  assert.deepEqual(calls, ["hide"]);
});

test("前台展示在 Dock 可见时会重新 show，修复被系统隐藏的图标", () => {
  const { calls, controller } = setup();
  controller.revealForForeground();
  assert.deepEqual(calls, ["show"]);
});

test("非 macOS 平台是空操作", () => {
  const { calls, controller } = setup("win32");
  controller.setMenuBarEntryAvailable(true);
  controller.setPreference(false);
  controller.revealForForeground();
  assert.deepEqual(calls, []);
});
