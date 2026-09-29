import { useMemo, useState } from "react";
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

export interface AboutDialogDetails {
  version: string;
  commit: string;
}

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
 * 桌面端此前走 main 进程的原生 About 窗口（packages/desktop/src/main/about.ts），
 * Web 没有 Electron 宿主，帮助菜单里只有「问题上报」。统一为 UI 层 Dialog 后
 * 三端共享同一展示，版本号来自构建期注入的 __NEX_VERSION__。
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
  const appleSiliconLine = useMemo(() => shouldShowAppleSiliconLine(isDesktop), [isDesktop]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showOverlay
        className="max-w-xs gap-3"
        data-testid={TID_WORKSPACE_ABOUT_DIALOG}
      >
        <DialogHeader>
          <DialogTitle>{intl.formatMessage({ id: "workspaceHeader.help.about" })}</DialogTitle>
          <DialogDescription>Nex Desktop App</DialogDescription>
        </DialogHeader>
        <div className="space-y-1 text-ui-sm text-foreground-subtle">
          <div>
            {intl.formatMessage({ id: "workspaceHeader.about.versionLabel" })}{" "}
            <span className="font-medium text-foreground">{NEX_VERSION}</span>
          </div>
          {showDetails ? (
            <>
              <div className="break-all">Commit: {NEX_COMMIT}</div>
              {appleSiliconLine ? (
                <div>{intl.formatMessage({ id: "workspaceHeader.about.appleSilicon" })}</div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowDetails((v) => !v)}>
            {intl.formatMessage({
              id: showDetails
                ? "workspaceHeader.about.hideDetails"
                : "workspaceHeader.about.showDetails",
            })}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              setShowDetails(false);
            }}
          >
            {intl.formatMessage({ id: "common.ok" })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
