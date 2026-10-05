import { useNexIntl } from "@/i18n/IntlProvider.js";
import { PluginScopeMenu } from "@/settings/PluginScopeMenu.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

export function McpScopeMenu({
  disabled,
  scopeKey,
  workspaceTabs,
  onChange,
}: {
  disabled: boolean;
  scopeKey: string;
  workspaceTabs: WorkspaceTabState[];
  onChange: (scopeKey: string) => void;
}) {
  const { intl } = useNexIntl();
  const scopeLabel = intl.formatMessage({ id: "settings.scope.label" });

  return (
    <label className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <span className="shrink-0 text-ui-base text-foreground-subtle">{scopeLabel}</span>
      <PluginScopeMenu
        align="end"
        disabled={disabled}
        selectedScopeKey={scopeKey}
        workspaceTabs={workspaceTabs}
        onScopeKeyChange={onChange}
      />
    </label>
  );
}
