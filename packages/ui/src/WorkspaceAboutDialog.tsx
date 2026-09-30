import { useState } from "react";
import { NEX_COMMIT, NEX_VERSION, TID_WORKSPACE_ABOUT_DIALOG } from "@nex/shared";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import { useNexIntl } from "@/i18n/IntlProvider.js";

/**
 * 判断是否显示「已针对 Apple Silicon 优化」。
 *
 * 只在桌面端 macOS arm64 展示：desktop 由宿主注入 isDesktop；web 的宿主是
 * 可能多租户的服务器，优化声明对浏览器用户没有意义，一律隐藏。
 */
export function shouldShowAppleSiliconLine(isDesktop: boolean): boolean {
  return isDesktop && /Macintosh|Mac OS X/.test(navigator.userAgent);
}

/**
 * Nex 品牌 N 标（实色白色版）。
 *
 * 与桌面端原生 About 窗口（packages/desktop/src/main/aboutWindow.ts .app-icon）
 * 同一组 path 与同款深色渐变块。assets/N.svg 是启动页空态的装饰变体（低透明度
 * 描边、无实色填充），在深色图标块里几乎不可见，所以这里内联实色白色 path——
 * 原生版的图标块永远是深色渐变底 + 白标，不随主题翻转。
 */
function NexMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="121"
      height="100"
      viewBox="0 0 436 360"
      className="h-[30px] w-auto text-white"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d="M88 20.5L158 20.5L88 340L18 340Z" />
      <path fill="currentColor" d="M158 20.5L228 20.5L348 340L278 340Z" />
      <path fill="currentColor" d="M348 20.5L418 20.5L348 340L278 340Z" />
    </svg>
  );
}

/**
 * 关于对话框（跨端）。
 *
 * 布局逐项对照桌面端原生 About 窗口（packages/desktop/src/main/aboutWindow.ts
 * 的 .about-card CSS）：左对齐内容列（max-w 222 居中）、深色渐变图标块（52px、
 * border white/10、圆角 12、双投影、白标 30px 宽）、标题两行（应用名 + version
 * 行）margin-top 20、meta 行 margin-top 28 / gap 17、全宽胶囊 OK 按钮。
 * 桌面端此前走 main 进程的原生 About 窗口，Web 没有 Electron 宿主，
 * 帮助菜单里只有「问题上报」。统一为 UI 层 Dialog 后三端共享同一展示，
 * 版本号来自构建期注入的 __NEX_VERSION__。
 */
export function AboutDialog({
  isDesktop,
  open,
  onOpenChange,
}: {
  isDesktop: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { intl } = useNexIntl();
  const [showDetails, setShowDetails] = useState(false);
  const appleSiliconLine = shouldShowAppleSiliconLine(isDesktop);

  const close = () => {
    onOpenChange(false);
    setShowDetails(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showOverlay
        className="w-64 max-w-[calc(100%-2rem)] gap-0 p-0"
        data-testid={TID_WORKSPACE_ABOUT_DIALOG}
        aria-describedby={undefined}
      >
        {/* 对应 .about-card：padding 22/15/14，纵向 flex */}
        <div className="flex flex-col rounded-2xl px-[15px] pb-3.5 pt-[22px]">
          {/* 对应 .content：max-w 222 居中，flex-1 */}
          <div className="mx-auto w-full max-w-[222px]">
            {/* 对应 .app-icon：52px 深色渐变块 + 白标 */}
            <div
              aria-hidden="true"
              className="flex h-13 w-13 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-black to-[#151718] text-white shadow-[0_10px_13px_-3px_rgb(0_0_0/0.2),0_4px_5px_-3px_rgb(0_0_0/0.2)]"
            >
              <NexMark />
            </div>
            {/* 对应 .title：margin-top 20，13.5px/1.18 bold，两行（应用名 + version） */}
            <DialogTitle className="mt-5 text-[13.5px] font-bold leading-[1.18]">
              {isDesktop ? "Nex Desktop App" : "Nex Web App"}
              <br />
              {intl.formatMessage({ id: "workspaceHeader.about.versionLabel" })} {NEX_VERSION}
            </DialogTitle>
            {/* 对应 .meta：margin-top 28，gap 17，13px/1.2 */}
            <div className="mt-7 flex flex-col gap-[17px] text-[13px] leading-[1.2] text-foreground-subtle">
              {appleSiliconLine ? (
                <div>{intl.formatMessage({ id: "workspaceHeader.about.appleSilicon" })}</div>
              ) : null}
              <div>
                {intl.formatMessage(
                  { id: "workspaceHeader.about.copyright" },
                  { year: new Date().getFullYear() },
                )}
              </div>
              {showDetails ? <div className="break-all">Commit: {NEX_COMMIT}</div> : null}
            </div>
          </div>
          {/* 底部操作区：OK 全宽胶囊（对应 .ok-button），详细信息收在上方一行 */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-ui-sm text-foreground-subtle"
              data-testid="workspace-about-toggle-details"
              onClick={() => setShowDetails((v) => !v)}
            >
              {intl.formatMessage({
                id: showDetails
                  ? "workspaceHeader.about.hideDetails"
                  : "workspaceHeader.about.showDetails",
              })}
            </Button>
            <Button type="button" size="sm" className="h-8 flex-1 rounded-full" onClick={close}>
              {intl.formatMessage({ id: "common.ok" })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
