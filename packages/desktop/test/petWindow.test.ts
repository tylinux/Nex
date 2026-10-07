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

const labels = { newChat: "New chat", voice: "Voice", comingSoon: "Coming soon" };
const baseState = {
  labels,
  petId: "p",
  animation: "idle" as const,
  spriteUrl: "x",
  manifest: null,
  spriteRows: 11,
  sizePx: 160,
  visibility: "always" as const,
};
const D1 = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const D2 = { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("建窗：无历史落点时落主显示器右下角（自由态，不吸附）", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState });
  assert.deepEqual(env.window().bounds, {
    x: 1920 - 160 - 16,
    y: 1080 - 205 - 16,
    width: 160,
    height: 205,
  });
  assert.equal(env.persisted.length, 0);
});

test("窗口尺寸 = 精灵 + 控制行；精灵很小时宽度保底容纳控制条", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState, sizePx: 80 });
  // 80px 精灵：高 87 + 控制行 32；宽度保底 96（容纳控制条）。
  assert.deepEqual(
    { w: env.window().bounds.width, h: env.window().bounds.height },
    { w: 96, h: 87 + 32 },
  );
});

test("显示器被拔除：吸附在副屏的宠物迁到仍存在的显示器并持久化", () => {
  const env = setup([D1, D2]);
  env.controller.syncState({
    ...baseState,
    placement: { x: 3664, y: 859, displayId: 2, snapZone: "bottom-right" },
  });
  env.setDisplays([D1]);
  env.screen.emit("display-removed");
  assert.deepEqual(env.window().bounds, { x: 1744, y: 859, width: 160, height: 205 });
  assert.deepEqual(env.persisted.at(-1), {
    x: 1744,
    y: 859,
    displayId: 1,
    snapZone: "bottom-right",
  });
});

test("分辨率变化：吸附态按新工作区重新贴边", () => {
  const env = setup([D1]);
  env.controller.syncState({
    ...baseState,
    placement: { x: 1744, y: 859, displayId: 1, snapZone: "bottom-right" },
  });
  env.setDisplays([{ id: 1, workArea: { x: 0, y: 0, width: 1280, height: 720 } }]);
  env.screen.emit("display-metrics-changed");
  assert.deepEqual(env.window().bounds, {
    x: 1280 - 176,
    y: 720 - 205 - 16,
    width: 160,
    height: 205,
  });
});

test("分辨率变化：自由放置的宠物被夹回可见区且不带吸附区", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState, placement: { x: 1700, y: 900, displayId: 1 } });
  env.setDisplays([{ id: 1, workArea: { x: 0, y: 0, width: 1000, height: 600 } }]);
  env.screen.emit("display-metrics-changed");
  assert.deepEqual(env.persisted.at(-1), { x: 840, y: 395, displayId: 1 });
});

test("改大小：窗口按新尺寸重排并保持当前落点", () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState });
  env.controller.syncState({ ...baseState, sizePx: 200 });
  // 200px 精灵：高 217 + 32 = 249；自由态右下角贴边的位置被夹回可见区。
  assert.equal(env.window().bounds.width, 200);
  assert.equal(env.window().bounds.height, 249);
  assert.ok(env.window().bounds.x + 200 <= 1920 && env.window().bounds.y + 249 <= 1080);
});

test("拖拽松手：默认自由放置（不吸附）；Alt 松手才吸附到最近的边缘区", async () => {
  const env = setup([D1]);
  env.controller.syncState({ ...baseState });
  env.controller.handleDragAction({ kind: "drag-start", pointerX: 1850, pointerY: 1000 });
  env.controller.handleDragAction({ kind: "drag-move", pointerX: 700, pointerY: 500 });
  env.controller.handleDragAction({
    kind: "drag-end",
    pointerX: 700,
    pointerY: 500,
    altKey: false,
  });
  await sleep(100);
  const free = env.persisted.at(-1);
  assert.equal(free?.["snapZone"], undefined);
  // 落点保持在松手位置（屏幕中部），没有被吸到边缘。
  assert.ok((free?.["x"] as number) > 400 && (free?.["x"] as number) < 1500);
  assert.ok((free?.["y"] as number) > 200 && (free?.["y"] as number) < 800);

  env.controller.handleDragAction({ kind: "drag-start", pointerX: 700, pointerY: 500 });
  env.controller.handleDragAction({ kind: "drag-end", pointerX: 300, pointerY: 200, altKey: true });
  await sleep(400);
  assert.equal(env.persisted.at(-1)?.["snapZone"], "top-left");
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

test("右键菜单：贴着宠物窗右侧弹出，右侧放不下才放左侧（避免被宠物自己盖住）", () => {
  const popups: Array<{ x?: number; y?: number; window?: unknown } | undefined> = [];
  const menu = {
    popup: (options?: { x?: number; y?: number; window?: unknown }) => popups.push(options),
  };

  const right = setup([D1]);
  right.controller.syncState({ ...baseState, placement: { x: 200, y: 200, displayId: 1 } });
  right.controller.popupMenu(menu);
  const rightPopup = popups.at(-1);
  assert.equal(rightPopup?.window, right.window());
  assert.equal(rightPopup?.x, right.window().bounds.width + 4);
  assert.equal(rightPopup?.y, Math.round(right.window().bounds.height / 4));

  const edge = setup([D1]);
  edge.controller.syncState({ ...baseState, placement: { x: 1700, y: 200, displayId: 1 } });
  edge.controller.popupMenu(menu);
  assert.ok((popups.at(-1)?.x ?? 0) < 0);
});

test("右键菜单：窗口不存在时退回默认弹出", () => {
  const env = setup([D1]);
  let called = 0;
  env.controller.popupMenu({ popup: () => void (called += 1) });
  assert.equal(called, 1);
});
