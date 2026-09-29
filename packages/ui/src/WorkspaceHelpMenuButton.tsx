import {
  DesktopCommandIds,
  TID_WORKSPACE_HELP_MENU_ABOUT,
  TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER,
  TID_WORKSPACE_HELP_MENU_TRIGGER,
} from "@nex/shared";
import {
  ActivityIcon,
  CircleHelpIcon,
  InfoIcon,
  MessageSquareIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useDesktopUpdateMenu } from "@/hooks/useDesktopUpdateMenu.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useNexIntl } from "@/i18n/IntlProvider.js";
import { NEX_GITHUB_ISSUES_URL } from "@/lib/productLinks.js";
import { AboutDialog } from "@/WorkspaceAboutDialog.js";

export function WorkspaceHelpMenuButton({
  className,
  isDesktop = false,
}: {
  className?: string;
  /**
   * 是否桌面端。由挂载处注入而不是在组件内嗅探：Web 的 IPlatformService 桩同样实现了
   * executeDesktopCommand（no-op），拿它判定会让 Web 端出现一个点了没反应的「资源管理器」。
   */
  isDesktop?: boolean;
}) {
  const { intl } = useNexIntl();
  const platform = usePlatform();
  const updateMenu = useDesktopUpdateMenu(isDesktop);
  const helpMenuLabel = intl.formatMessage({ id: "workspaceHeader.help.menu" });
  const [aboutOpen, setAboutOpen] = useState(false);
  const handleOpenResourceManager = () => {
    void platform.executeDesktopCommand(DesktopCommandIds.OpenResourceManager);
  };

  const handleShowAbout = () => {
    setAboutOpen(true);
  };

  return (
    <DropdownMenu>
      <ControlHintTooltip title={helpMenuLabel} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            // Settings 页会把帮助按钮绝对定位在 Electron 顶部拖拽区上方。
            // 只依赖外层容器 no-drag 时，真实 trigger 仍可能被标题栏 drag 区吞掉点击。
            className={cn(
              "text-foreground hover:bg-hover hover:text-foreground [app-region:no-drag]",
              className,
            )}
            aria-label={helpMenuLabel}
            data-testid={TID_WORKSPACE_HELP_MENU_TRIGGER}
          >
            <CircleHelpIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </ControlHintTooltip>
      <DropdownMenuContent
        align="end"
        className="min-w-0 w-max [&_[data-slot=dropdown-menu-item]]:pr-6"
      >
        <DropdownMenuItem
          onSelect={() => {
            void platform.openExternal(NEX_GITHUB_ISSUES_URL);
          }}
        >
          <MessageSquareIcon className="size-4" />
          {intl.formatMessage({ id: "workspaceHeader.help.issueReport" })}
        </DropdownMenuItem>
        {/* Windows/Linux 没有原生菜单栏，自绘标题栏箭头菜单也已下线，
            资源管理器只能从这里进；Web 端没有该窗口，不渲染。 */}
        {isDesktop ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid={TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER}
              onSelect={handleOpenResourceManager}
            >
              <ActivityIcon className="size-4" />
              {intl.formatMessage({ id: "titleBar.menu.help.resourceManager" })}
            </DropdownMenuItem>
            {updateMenu.visible ? (
              <DropdownMenuItem
                disabled={updateMenu.disabled}
                onSelect={updateMenu.checkForUpdates}
              >
                <RefreshCwIcon className="size-4" />
                {updateMenu.labelId === "desktopMenu.help.restartToUpdate" ? (
                  <>
                    <span className="whitespace-nowrap">
                      {intl.formatMessage({ id: "desktopMenu.help.restartUpdateAction" })}
                    </span>
                    <Badge
                      variant="secondary"
                      className="h-4 px-1.5 py-0 bg-success/10 text-success"
                    >
                      {updateMenu.labelValues?.version}
                    </Badge>
                  </>
                ) : (
                  intl.formatMessage({ id: updateMenu.labelId }, updateMenu.labelValues)
                )}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        {/* 关于：跨端自绘 Dialog（Web 没有 Electron 宿主，无法弹原生 About 窗口）。 */}
        <DropdownMenuItem data-testid={TID_WORKSPACE_HELP_MENU_ABOUT} onSelect={handleShowAbout}>
          <InfoIcon className="size-4" />
          {intl.formatMessage({ id: "titleBar.menu.help.about" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
      <AboutDialog isDesktop={isDesktop} open={aboutOpen} onOpenChange={setAboutOpen} />
    </DropdownMenu>
  );
}
