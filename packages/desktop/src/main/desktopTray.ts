import { app, Menu, nativeImage, Tray } from "electron";
import { join } from "node:path";
import {
  DesktopCommandIds,
  desktopMenuMessageIds,
  getDesktopMenuMessage,
  NEX_PRODUCT_FLAVOR,
  type DesktopCommandId,
  type Locale,
} from "@nex/shared";

let desktopTray: Tray | null = null;
let rebuildDesktopTrayContextMenu: (() => void) | null = null;

function resolveDesktopTrayIconPath() {
  // macOS 使用单色 template 图（旁边的 @2x 由 Electron 按文件名自动选取），随菜单栏深浅反色。
  const fileName = process.platform === "darwin" ? "trayTemplate.png" : "tray_icon.ico";
  if (app.isPackaged) {
    return join(process.resourcesPath, fileName);
  }
  const devFileName = process.platform === "darwin" ? fileName : "icon.ico";
  return join(import.meta.dirname, "../../build", devFileName);
}

function createDesktopTrayIcon() {
  const iconPath = resolveDesktopTrayIconPath();
  if (process.platform !== "darwin") {
    return iconPath;
  }
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    throw new Error(`tray template icon missing or unreadable: ${iconPath}`);
  }
  image.setTemplateImage(true);
  return image;
}

/** Windows 通知区域托盘与 macOS 菜单栏图标共用同一套菜单；其它平台不创建。 */
export function createDesktopTray(options: {
  getLocale: () => Locale;
  showCurrentWindow: () => Promise<void> | void;
  executeDesktopCommand: (command: DesktopCommandId) => Promise<unknown>;
  quitApp: () => void;
  logger: { warn: (...args: unknown[]) => void };
}) {
  if (process.platform !== "win32" && process.platform !== "darwin") {
    return null;
  }

  if (desktopTray) {
    return desktopTray;
  }

  try {
    desktopTray = new Tray(createDesktopTrayIcon());
  } catch (error) {
    options.logger.warn("[desktop-tray] failed to create tray icon", error);
    return null;
  }

  const getLabel = (id: (typeof desktopMenuMessageIds)[keyof typeof desktopMenuMessageIds]) =>
    getDesktopMenuMessage(options.getLocale(), id);
  const showTrayWindow = () => {
    void Promise.resolve(options.showCurrentWindow()).catch((error) => {
      options.logger.warn("[desktop-tray] failed to show current window", error);
    });
  };
  const executeTrayCommand = (command: DesktopCommandId) => {
    void Promise.resolve(options.showCurrentWindow())
      .then(() => options.executeDesktopCommand(command))
      .catch((error) => {
        options.logger.warn(`[desktop-tray] failed to execute tray command ${command}`, error);
      });
  };
  let contextMenu: Menu | null = null;
  const rebuildContextMenu = () => {
    desktopTray?.setToolTip(getLabel(desktopMenuMessageIds.trayTooltip));
    contextMenu = Menu.buildFromTemplate([
      {
        label: getLabel(desktopMenuMessageIds.trayOpenNex),
        click: showTrayWindow,
      },
      { type: "separator" },
      {
        label: getLabel(desktopMenuMessageIds.fileNewTask),
        click: () => executeTrayCommand(DesktopCommandIds.NewTask),
      },
      {
        label: getLabel(desktopMenuMessageIds.fileOpenWorkspace),
        click: () => executeTrayCommand(DesktopCommandIds.OpenWorkspace),
      },
      { type: "separator" },
      // 更新入口跟随产品身份：Preview（含生产后端的 Preview）禁用更新器，托盘也不能露出入口。
      ...(NEX_PRODUCT_FLAVOR === "production"
        ? [
            {
              label: getLabel(desktopMenuMessageIds.helpCheckForUpdates),
              click: () => executeTrayCommand(DesktopCommandIds.CheckForUpdates),
            },
          ]
        : []),
      {
        label: getLabel(desktopMenuMessageIds.helpAbout),
        click: () => executeTrayCommand(DesktopCommandIds.ShowAbout),
      },
      {
        label: getLabel(desktopMenuMessageIds.helpClearAllData),
        click: () => executeTrayCommand(DesktopCommandIds.ClearAllData),
      },
      { type: "separator" },
      {
        label: getLabel(desktopMenuMessageIds.trayQuit),
        click: () => options.quitApp(),
      },
    ]);
    // macOS 上 setContextMenu 会让左键也弹菜单，而菜单栏图标的左键要直接显示主窗口，
    // 所以只在 Windows 挂载菜单，macOS 改在 right-click 时手动弹出。
    if (process.platform === "win32") {
      desktopTray?.setContextMenu(contextMenu);
    }
  };

  rebuildDesktopTrayContextMenu = rebuildContextMenu;
  desktopTray.on("click", showTrayWindow);
  desktopTray.on("double-click", showTrayWindow);
  if (process.platform === "darwin") {
    desktopTray.on("right-click", () => {
      if (contextMenu) {
        desktopTray?.popUpContextMenu(contextMenu);
      }
    });
  }
  rebuildContextMenu();

  return desktopTray;
}

export function updateDesktopTrayMenu() {
  rebuildDesktopTrayContextMenu?.();
}
