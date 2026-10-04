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
 * Nex 品牌 N 标（"folded ribbon N"，来自 output/imagegen/nex-icon-a-macos.svg）。
 *
 * 三笔画：leftLeg / rightLeg（两侧短腿）+ ribbon（长斜带），mint 渐变。
 * viewBox 裁剪到 N 本体（原 SVG 1024 坐标系中 x 263-763, y 260-766），
 * 形状与官方 icon 源文件逐点一致，仅去掉 charcoal 圆角背景块——
 * 深色由图标块容器提供（与新 icon 底色一致）。
 */
function NexMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="121"
      height="100"
      viewBox="258 255 510 516"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id="nex-left"
          x1="269"
          y1="423"
          x2="430"
          y2="720"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#A5E5CE" />
          <stop offset=".62" stopColor="#BEF2DC" />
          <stop offset="1" stopColor="#B2ECD5" />
        </linearGradient>
        <linearGradient
          id="nex-left-fold"
          x1="367"
          y1="374"
          x2="289"
          y2="444"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#236E5D" stopOpacity=".88" />
          <stop offset=".4" stopColor="#337E6C" stopOpacity=".65" />
          <stop offset="1" stopColor="#74BDA6" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id="nex-right"
          x1="641"
          y1="276"
          x2="787"
          y2="637"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#C6F7E2" />
          <stop offset=".55" stopColor="#B5EDD7" />
          <stop offset="1" stopColor="#7EC4B0" />
        </linearGradient>
        <linearGradient
          id="nex-right-fold"
          x1="671"
          y1="629"
          x2="742"
          y2="564"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#216B59" stopOpacity=".85" />
          <stop offset=".42" stopColor="#337F6B" stopOpacity=".58" />
          <stop offset="1" stopColor="#7EC4B0" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id="nex-ribbon"
          x1="313"
          y1="269"
          x2="750"
          y2="750"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#B9F0D8" />
          <stop offset=".28" stopColor="#C4F5DF" />
          <stop offset=".62" stopColor="#A6E4CE" />
          <stop offset="1" stopColor="#83CBB6" />
        </linearGradient>
      </defs>
      <path
        d="M263 356C263 333 276 337 286 343C305 355 342 402 399 469V702C399 720 392 729 376 736L290 766C271 772 263 762 263 741Z"
        fill="url(#nex-left)"
      />
      <path
        d="M263 356C263 333 276 337 286 343C305 355 342 402 399 469V702C399 720 392 729 376 736L290 766C271 772 263 762 263 741Z"
        fill="url(#nex-left-fold)"
      />
      <path
        d="M625 528V327C625 307 632 299 649 291L728 260C750 251 763 262 763 282V645C763 671 741 659 724 638Z"
        fill="url(#nex-right)"
      />
      <path
        d="M625 528V327C625 307 632 299 649 291L728 260C750 251 763 262 763 282V645C763 671 741 659 724 638Z"
        fill="url(#nex-right-fold)"
      />
      <path
        d="M263 356V316C263 282 282 262 313 262H389C406 262 415 272 429 288L722 638C741 660 763 673 763 645V707C763 741 743 763 707 763H663C645 763 636 756 623 741L306 369C282 340 264 336 263 356Z"
        fill="url(#nex-ribbon)"
      />
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
