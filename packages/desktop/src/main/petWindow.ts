/**
 * 桌面宠物悬浮窗（单例）：透明、无边框、置顶、不抢焦点、可点击、可拖拽。
 *
 * 窗口性质踩坑结论沿用 cuaPermissionDragPanel.ts：
 * `type:"panel"` 管「app 不被激活」，`focusable:false` 管「窗口不拿焦点」，二者缺一不可。
 * 但宠物窗需要接受拖拽/点击，因此 focusable 必须为 true——折中方案：
 *   - 不抢焦点：showInactive() 展示；
 *   - 点击/拖拽可用：focusable:true + 不设 type:panel（普通窗口），
 *     点击后宠物窗短暂拿焦点，但不影响主窗口（同 app 内）。
 *
 * 状态流：renderer（PetRuntime）→ SyncPetState IPC → 本模块 → PetWindowState IPC → pet window。
 * 动作流：pet window → PetWindowAction IPC → main（点击聚焦 / drag-move 跟随 / moved 持久化）。
 * 详见 docs/specs/desktop-pets.md。
 */
import type { BrowserWindow, Rectangle, screen as ElectronScreen } from "electron";
import type { PetWindowAction, PetWindowState } from "@nex/shared";
import { PlatformChannels } from "@nex/shared";
import { logger } from "./logger.js";

const PET_WINDOW_WIDTH = 160;
const PET_WINDOW_HEIGHT = 140;
const PET_WINDOW_MARGIN = 24;

interface PetWindowDeps {
  BrowserWindow: typeof import("electron").BrowserWindow;
  screen: typeof ElectronScreen;
  app: Pick<typeof import("electron").app, "isPackaged">;
  preloadPath: string;
  rendererDir: string;
  rendererDevUrl?: string | undefined;
  /** 点击宠物时聚焦主窗口。 */
  focusPrimaryWindow: () => void;
}

export interface PetWindowController {
  /** 同步状态；null 表示销毁窗口。 */
  syncState(state: PetWindowState | null): void;
  destroy(): void;
  isActive(): boolean;
  /** 判断某窗口是否为宠物悬浮窗（用于应用窗口列表排除）。 */
  ownsWindow(candidate: BrowserWindow): boolean;
  /** 拖拽跟随：把窗口移到给定屏幕坐标（不做持久化，落定由 moved 动作负责）。 */
  moveTo(x: number, y: number): void;
}

function defaultBounds(screen: typeof ElectronScreen): Rectangle {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  return {
    x: x + width - PET_WINDOW_WIDTH - PET_WINDOW_MARGIN,
    y: y + height - PET_WINDOW_HEIGHT - PET_WINDOW_MARGIN,
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
  };
}

export function createPetWindowController(deps: PetWindowDeps): PetWindowController {
  let win: BrowserWindow | null = null;
  let lastState: PetWindowState | null = null;

  const ensureWindow = (position?: { x: number; y: number }): BrowserWindow => {
    if (win && !win.isDestroyed()) return win;

    const bounds = defaultBounds(deps.screen);
    const created = new deps.BrowserWindow({
      x: position?.x ?? bounds.x,
      y: position?.y ?? bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // 可点击可拖拽，但展示时不抢焦点。
      focusable: true,
      skipTaskbar: true,
      show: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    if (!deps.app.isPackaged && deps.rendererDevUrl) {
      void created.loadURL(`${deps.rendererDevUrl}/pet-window.html`);
    } else {
      void created.loadFile(`${deps.rendererDir}/pet-window.html`);
    }

    created.once("ready-to-show", () => {
      if (created.isDestroyed()) return;
      created.showInactive();
      created.setAlwaysOnTop(true, "screen-saver");
      created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    });

    created.on("closed", () => {
      win = null;
    });

    win = created;
    return created;
  };

  return {
    syncState(state) {
      lastState = state;
      if (!state) {
        if (win && !win.isDestroyed()) {
          win.destroy();
        }
        win = null;
        return;
      }
      const target = ensureWindow(state.position);
      if (target.isDestroyed()) return;
      // 位置仅在建窗时应用；运行中位置以用户拖拽为准（避免状态推送把窗口拽回去）。
      if (!target.webContents.isLoading()) {
        target.webContents.send(PlatformChannels.PetWindowState, state);
      } else {
        target.webContents.once("did-finish-load", () => {
          if (!target.isDestroyed() && lastState) {
            target.webContents.send(PlatformChannels.PetWindowState, lastState);
          }
        });
      }
    },
    destroy() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
    isActive() {
      return Boolean(win && !win.isDestroyed());
    },
    ownsWindow(candidate) {
      return Boolean(win && !win.isDestroyed() && win === candidate);
    },
    moveTo(x, y) {
      if (win && !win.isDestroyed()) {
        win.setPosition(Math.round(x), Math.round(y));
      }
    },
  };
}

/** 注册 pet-window → main 的动作通道（点击聚焦 / 拖拽跟随 / 落定持久化）。 */
export function registerPetWindowActionHandler(deps: {
  ipcMain: typeof import("electron").ipcMain;
  focusPrimaryWindow: () => void;
  getPetWindowController: () => PetWindowController | null;
  onPositionPersist: (position: { x: number; y: number }) => void;
}): void {
  deps.ipcMain.on(PlatformChannels.PetWindowAction, (_event, action: PetWindowAction) => {
    if (action.kind === "focus-main-window") {
      deps.focusPrimaryWindow();
      return;
    }
    if (action.kind === "drag-move") {
      deps.getPetWindowController()?.moveTo(action.x, action.y);
      return;
    }
    if (action.kind === "moved") {
      deps.onPositionPersist({ x: action.x, y: action.y });
    }
  });
  logger.info("[pets] pet window action channel registered");
}
