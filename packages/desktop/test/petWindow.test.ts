import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// main/logger.js 在 import 时会创建日志目录；指到临时数据根，避免写入真实 ~/.nex。
process.env["NEX_DATA_BASE_DIR"] = mkdtempSync(join(tmpdir(), "pet-window-test-"));
const { createPetWindowController } = await import("../src/main/petWindow.js");

type Rect = { x: number; y: number; width: number; height: number };

class FakeWindow extends EventEmitter {
  bounds: Rect;
  destroyed = false;
  webContents = { isLoading: () => false, send: () => {}, once: () => {} };
  constructor(options: Rect) {
    super();
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
  }
  loadFile() {}
  loadURL() {}
  visible = false;
  focused = false;
  showInactive() {
    this.visible = true;
  }
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  focus() {
    this.focused = true;
  }
  isVisible() {
    return this.visible;
  }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  isDestroyed() {
    return this.destroyed;
  }
  getBounds() {
    return { ...this.bounds };
  }
  setBounds(next: Rect) {
    this.bounds = { ...next };
  }
  setPosition(x: number, y: number) {
    this.bounds.x = x;
    this.bounds.y = y;
  }
  destroy() {
    this.destroyed = true;
  }
}

function setup(initialDisplays: Array<{ id: number; workArea: Rect }>, shortcutAvailable = true) {
  let displays = initialDisplays;
  const shortcuts = new Map<string, () => void>();
  const globalShortcut = {
    register: (accelerator: string, callback: () => void) => {
      if (!shortcutAvailable) return false;
      shortcuts.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator: string) => {
      shortcuts.delete(accelerator);
    },
  };
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0]!,
  });
  const instances: FakeWindow[] = [];
  const persisted: Array<Record<string, unknown>> = [];
  class Ctor extends FakeWindow {
    constructor(options: Rect) {
      super(options);
      instances.push(this);
    }
  }
  const controller = createPetWindowController({
    BrowserWindow: Ctor as never,
    screen: screen as never,
    app: { isPackaged: true },
    globalShortcut: globalShortcut as never,
    preloadPath: "",
    rendererDir: "",
    onPlacementPersist: (placement) => persisted.push({ ...placement }),
  });
  return {
    controller,
    screen,
    persisted,
    shortcuts,
    ready: () => instances.at(-1)!.emit("ready-to-show"),
    window: () => instances.at(-1)!,
    setDisplays: (next: typeof displays) => {
      displays = next;
    },
  };
}

const baseState = {
  petId: "p",
  animation: "idle" as const,
  spriteUrl: "x",
  manifest: null,
  spriteRows: 11,
  sizePx: 100,
  visibility: "always" as const,
};
const D1 = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const D2 = { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("建窗：无历史落点时贴主显示器右下角", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState });
  assert.deepEqual(env.window().bounds, {
    x: 1920 - 100 - 16,
    y: 1080 - 108 - 16,
    width: 100,
    height: 108,
  });
});

test("显示器被拔除：吸附在副屏的宠物迁到仍存在的显示器并持久化", () => {
  const env = setup([D1, D2]);
  env.controller.syncState({
    ...baseState,
    placement: { x: 3804, y: 956, displayId: 2, snapZone: "bottom-right" },
  });
  assert.equal(env.window().bounds.x, 3840 - 100 - 16);
  env.setDisplays([D1]);
  env.screen.emit("display-removed");
  assert.deepEqual(env.window().bounds, { x: 1804, y: 956, width: 100, height: 108 });
  assert.deepEqual(env.persisted.at(-1), {
    x: 1804,
    y: 956,
    displayId: 1,
    snapZone: "bottom-right",
  });
});

test("分辨率变化：吸附态按新工作区重新贴边", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState });
  env.setDisplays([{ id: 1, workArea: { x: 0, y: 0, width: 1280, height: 720 } }]);
  env.screen.emit("display-metrics-changed");
  assert.deepEqual(env.window().bounds, {
    x: 1280 - 116,
    y: 720 - 108 - 16,
    width: 100,
    height: 108,
  });
});

test("分辨率变化：自由放置的宠物被夹回可见区且不带吸附区", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState, placement: { x: 1700, y: 900, displayId: 1 } });
  env.setDisplays([{ id: 1, workArea: { x: 0, y: 0, width: 1000, height: 600 } }]);
  env.screen.emit("display-metrics-changed");
  assert.deepEqual(env.persisted.at(-1), { x: 900, y: 492, displayId: 1 });
});

test("改大小：窗口按新尺寸重排并保持吸附", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState });
  env.controller.syncState({ ...baseState, sizePx: 200 });
  assert.deepEqual(env.window().bounds, {
    x: 1920 - 216,
    y: 1080 - 217 - 16,
    width: 200,
    height: 217,
  });
});

test("拖拽松手（无速度）：缓动后吸附到最近的区；Alt 则自由放置", async () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState });
  env.controller.handleDragAction({ kind: "drag-start", pointerX: 1850, pointerY: 1000 });
  env.controller.handleDragAction({ kind: "drag-move", pointerX: 300, pointerY: 200 });
  env.controller.handleDragAction({
    kind: "drag-end",
    pointerX: 300,
    pointerY: 200,
    altKey: false,
  });
  await sleep(400);
  assert.equal(env.persisted.at(-1)?.["snapZone"], "top-left");

  env.controller.handleDragAction({ kind: "drag-start", pointerX: 50, pointerY: 50 });
  env.controller.handleDragAction({ kind: "drag-end", pointerX: 700, pointerY: 500, altKey: true });
  await sleep(400);
  assert.equal(env.persisted.at(-1)?.["snapZone"], undefined);
});

test("销毁后移除显示器监听，事件不再触发重排", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState });
  assert.ok(env.screen.listenerCount("display-removed") > 0);
  env.controller.syncState(null);
  assert.equal(env.screen.listenerCount("display-removed"), 0);
  assert.equal(env.screen.listenerCount("display-metrics-changed"), 0);
});

test("on-demand：建窗后默认隐藏，快捷键唤出，再按一次隐藏", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState, visibility: "on-demand" });
  env.ready();
  assert.equal(env.window().visible, false);
  assert.ok(env.shortcuts.has("CommandOrControl+Alt+P"));
  env.shortcuts.get("CommandOrControl+Alt+P")!();
  assert.equal(env.window().visible, true);
  assert.equal(env.window().focused, true);
  env.shortcuts.get("CommandOrControl+Alt+P")!();
  assert.equal(env.window().visible, false);
});

test("on-demand：唤出后失焦（点击窗口外）隐藏，刚唤出的 300ms 内忽略", async () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState, visibility: "on-demand" });
  env.ready();
  env.shortcuts.get("CommandOrControl+Alt+P")!();
  env.window().emit("blur");
  assert.equal(env.window().visible, true);
  await sleep(350);
  env.window().emit("blur");
  assert.equal(env.window().visible, false);
});

test("切回 always：注销快捷键并立即显示", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState, visibility: "on-demand" });
  env.ready();
  env.controller.syncState({ ...baseState, visibility: "always" });
  assert.equal(env.shortcuts.size, 0);
  assert.equal(env.window().visible, true);
});

test("on-demand 快捷键注册失败：回退为常显，避免宠物无法唤出", () => {
  const env = setup([D1], false);
  env.controller.syncState({ ...baseState, visibility: "on-demand" });
  env.ready();
  assert.equal(env.window().visible, true);
});

test("销毁窗口会注销快捷键", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState, visibility: "on-demand" });
  env.controller.syncState(null);
  assert.equal(env.shortcuts.size, 0);
});
