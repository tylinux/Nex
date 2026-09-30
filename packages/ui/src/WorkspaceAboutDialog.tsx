import { useState } from "react";
import { NEX_COMMIT, NEX_VERSION, TID_WORKSPACE_ABOUT_DIALOG } from "@nex/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useNexIntl } from "@/i18n/IntlProvider.js";
import nexMarkUrl from "@/assets/N.svg";

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
 * 关于对话框（跨端）。
 *
 * 视觉对齐桌面端原生 About 窗口（packages/desktop/src/main/aboutWindow.ts）：
 * 深色渐变图标块 + 应用名/版本标题 + meta 行 + 全宽胶囊 OK 按钮。
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
        <div className="flex flex-col rounded-2xl px-4 pb-3.5 pt-5">
          <DialogHeader className="items-center gap-4 text-center">
            {/* 品牌 N 标：与桌面端 About 窗口的图标块同款视觉 */}
            <div
              aria-hidden="true"
              className="mx-auto flex size-13 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-black to-[#151718] shadow-[0_10px_13px_-3px_rgb(0_0_0/0.2),0_4px_5px_-3px_rgb(0_0_0/0.2)]"
            >
              <img src={nexMarkUrl} alt="" className="h-6 w-auto" />
            </div>
            <DialogTitle className="text-[13.5px] font-bold leading-tight">
              Nex Desktop App
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-tight text-foreground-subtle">
              {intl.formatMessage({ id: "workspaceHeader.about.versionLabel" })} {NEX_VERSION}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-6 flex flex-col gap-4 text-[13px] leading-tight text-foreground-subtle">
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
