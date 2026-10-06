import { DesktopCommandIds, buildLocalMediaPreviewUrl, type IPlatformService } from "@nex/shared";

import { desktopBrowserPlatformBridge } from "./desktopBrowserPlatformBridge.js";

export function createDesktopPlatform(options: {
  isLocalDevelopmentRuntime: boolean;
}): IPlatformService {
  return {
    canSelectFilePath: true,
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
    isLocalDevelopmentRuntime: options.isLocalDevelopmentRuntime,
    selectDirectory: () => window.nex.selectDirectory(),
    selectFile: () => window.nex.selectFile(),
    selectFiles: () => window.nex.selectFiles?.() ?? Promise.resolve([]),
    createTempTextAttachment: (payload) => window.nex.createTempTextAttachment(payload),
    onRemoteConnectionLog: (handler) => window.nex.onRemoteConnectionLog(handler),
    onRemoteSessionClosed: (handler) => window.nex.onRemoteSessionClosed(handler),
    onBotRemoteWorkspaceReconnected: (handler) =>
      window.nex.onBotRemoteWorkspaceReconnected(handler),
    activateOrSetWorkspace: (path) =>
      window.nex.activateOrSetWorkspace?.(path) ?? Promise.resolve({ activated: false }),
    connectRemote: (remoteOptions, requestId, context) =>
      window.nex.connectRemote(remoteOptions, requestId, context),
    cancelPendingRemoteConnection: (requestId) =>
      window.nex.cancelPendingRemoteConnection?.(requestId) ?? Promise.resolve(),
    bindRemoteWorkspaceSessionContext: (context) =>
      window.nex.bindRemoteWorkspaceSessionContext?.(context) ?? Promise.resolve(),
    disposeRemoteSession: (sessionId) => window.nex.disposeRemoteSession(sessionId),
    isDockerAvailable: () => window.nex.isDockerAvailable(),
    listWSLDistros: () => window.nex.listWSLDistros(),
    listDockerContainers: () => window.nex.listDockerContainers(),
    listSSHConfigAliases: () => window.nex.listSSHConfigAliases(),
    loadMcpFromUserDirectory: (payload) => window.nex.loadMcpFromUserDirectory(payload),
    saveMcpToUserDirectory: (payload) => window.nex.saveMcpToUserDirectory(payload),
    migrateLegacyCommonMcp: (payload) => window.nex.migrateLegacyCommonMcp(payload),
    openExternal: (url) => window.nex.openExternal(url),
    openFeedback: () => window.nex.executeDesktopCommand(DesktopCommandIds.OpenFeedback),
    openCommunity: () => window.nex.executeDesktopCommand(DesktopCommandIds.OpenCommunity),
    canOpenCommunity: (locale) => window.nex.canOpenCommunity(locale),
    openInFileManager: (path) => window.nex.openInFileManager(path),
    openExternalFile: (path) => window.nex.openExternalFile(path),
    openCuaPermissionOnboarding: window.nex.openCuaPermissionOnboarding
      ? (permissionOptions) =>
          window.nex.openCuaPermissionOnboarding?.(permissionOptions) ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    prepareCuaHelperPermissionDrag: window.nex.prepareCuaHelperPermissionDrag
      ? () =>
          window.nex.prepareCuaHelperPermissionDrag?.() ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    startCuaHelperPermissionDrag: window.nex.startCuaHelperPermissionDrag
      ? () => window.nex.startCuaHelperPermissionDrag?.()
      : undefined,
    onPaymentCallback: (callback) => window.nex.onPaymentCallback(callback),
    onShareImport: (callback) => window.nex.onShareImport?.(callback) ?? (() => {}),
    notifyRendererReady: () => window.nex.notifyRendererReady(),
    showTaskNotification: (payload) => window.nex.showTaskNotification(payload),
    syncWindowTabs: (paths) => window.nex.syncWindowTabs(paths),
    syncWindowUnreadCount: (count) => window.nex.syncWindowUnreadCount(count),
    syncActiveTaskSession: (sessionId) => window.nex.syncActiveTaskSession(sessionId),
    syncAppSettings: (patch) => window.nex.syncAppSettings?.(patch),
    syncPetState: (state) => window.nex.syncPetState?.(state),
    setShortcutRecordingActive: (active) => window.nex.setShortcutRecordingActive?.(active),
    onFocusTab: (handler) => window.nex.onFocusTab(handler),
    onNewTab: (handler) => window.nex.onNewTab(handler),
    onCloseActiveContextRequest: (handler) =>
      window.nex.onCloseActiveContextRequest?.(handler) ?? (() => {}),
    onOpenBrowserUrl: (handler) => window.nex.onOpenBrowserUrl?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfacePrepare: (handler) =>
      window.nex.onBrowserViewScreenshotSurfacePrepare?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfaceRelease: (handler) =>
      window.nex.onBrowserViewScreenshotSurfaceRelease?.(handler) ?? (() => {}),
    browserViewScreenshotSurfaceReady: (payload) =>
      window.nex.browserViewScreenshotSurfaceReady?.(payload),
    ...desktopBrowserPlatformBridge,
    onNewTask: (handler) => window.nex.onNewTask(handler),
    onOpenWorkspace: (handler) => {
      // 开发态或升级后的旧窗口可能仍运行未暴露 onOpenWorkspace 的 preload，
      // renderer 直接调用会在启动时崩溃。这里和 activateOrSetWorkspace 一样做兼容兜底，
      // 缺少该 bridge 时只禁用原生菜单回调，不影响应用继续打开。
      return window.nex.onOpenWorkspace?.(handler) ?? (() => {});
    },
    onOpenWorkspacePath: (handler) => window.nex.onOpenWorkspacePath?.(handler) ?? (() => {}),
    onOpenFeedbackDialog: (handler) => window.nex.onOpenFeedbackDialog?.(handler) ?? (() => {}),
    onOpenTicketsPanel: (handler) => window.nex.onOpenTicketsPanel?.(handler) ?? (() => {}),
    onWindowFullscreenChanged: (handler) => window.nex.onWindowFullscreenChanged(handler),
    getDesktopWindowChromeState: window.nex.getDesktopWindowChromeState
      ? () => window.nex.getDesktopWindowChromeState!()
      : undefined,
    onDesktopWindowChromeStateChanged: window.nex.onDesktopWindowChromeStateChanged
      ? (handler) => window.nex.onDesktopWindowChromeStateChanged!(handler)
      : undefined,
    getWindowControlsOverlayMetrics: () => window.nex.getWindowControlsOverlayMetrics?.() ?? null,
    onWindowControlsOverlayChanged: (handler) =>
      window.nex.onWindowControlsOverlayChanged?.(handler) ?? (() => {}),
    getDesktopZoomLevel: () =>
      window.nex.getDesktopZoomLevel?.() ?? Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: (handler) =>
      window.nex.onDesktopZoomLevelChanged?.(handler) ?? (() => {}),
    onTaskNotificationClick: (handler) => window.nex.onTaskNotificationClick(handler),
    exportLogs: () => window.nex.exportLogs(),
    captureWindowScreenshot: () => window.nex.captureWindowScreenshot?.() ?? Promise.resolve(null),
    onUpdateReady: (callback) => window.nex.onUpdateReady(callback),
    onUpdateCheckResult: (callback) => window.nex.onUpdateCheckResult(callback),
    onUpdateStateChanged: (callback) => window.nex.onUpdateStateChanged?.(callback) ?? (() => {}),
    getUpdateState: () =>
      window.nex.getUpdateState?.() ?? Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => window.nex.downloadUpdate?.() ?? Promise.resolve(),
    cancelUpdateDownload: () => window.nex.cancelUpdateDownload?.() ?? Promise.resolve(),
    openUpdateStatusWindow: () => window.nex.openUpdateStatusWindow?.() ?? Promise.resolve(),
    getAutoUpdatePreferences: () =>
      window.nex.getAutoUpdatePreferences?.() ??
      Promise.resolve({ autoDownloadAndInstallUpdates: false }),
    setAutoDownloadAndInstallUpdates: (enabled) =>
      window.nex.setAutoDownloadAndInstallUpdates?.(enabled) ?? Promise.resolve(),
    getDesktopSessionActivity: () =>
      window.nex.getDesktopSessionActivity?.() ?? Promise.resolve({ runningAgentSessionCount: 0 }),
    getNexStdioTapDevState: () =>
      window.nex.getNexStdioTapDevState?.() ??
      Promise.resolve({ enabled: false, visible: false, logDir: "", statePath: "" }),
    onSettingsChanged: (callback) => window.nex.onSettingsChanged?.(callback) ?? (() => {}),
    onApplicationLocaleChanged: (callback) =>
      window.nex.onApplicationLocaleChanged?.(callback) ?? (() => {}),
    onPostUpdateReleaseNotes: (callback) => window.nex.onPostUpdateReleaseNotes(callback),
    acknowledgePostUpdateReleaseNotes: (version) =>
      window.nex.acknowledgePostUpdateReleaseNotes(version),
    skipUpdateVersion: (version) => window.nex.skipUpdateVersion?.(version) ?? Promise.resolve(),
    quitAndInstallUpdate: () => window.nex.quitAndInstallUpdate(),
    getInstalledEditors: () => window.nex.getInstalledEditors(),
    getApplicationIcon: (bundleId) =>
      window.nex.getApplicationIcon?.(bundleId) ?? Promise.resolve(null),
    openInEditor: (editorId, path, editorOptions) =>
      window.nex.openInEditor(editorId, path, editorOptions),
    executeDesktopCommand: (command) => window.nex.executeDesktopCommand(command),
    setApplicationLocale: (locale) => window.nex.setApplicationLocale(locale),
    getSystemLocale: () =>
      window.nex.getSystemLocale?.() ??
      Promise.resolve(navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"),
    setTitleBarTheme: (theme) => window.nex.setTitleBarTheme(theme),
    getDeviceId: () => (window as Window & { __NEX_DEVICE_ID__?: string }).__NEX_DEVICE_ID__ ?? "",
  };
}
