import { TID_SETTINGS_MCP_EXPOSURE_SELECT } from "@nex/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useNexIntl } from "@/i18n/IntlProvider.js";

const EXPOSURE_OPTIONS = ["direct", "deferred", "hidden"] as const;
/** Radix Select 不接受空串 value；用哨兵表示「未设置」，表单里空串 = 未设置（配置文件不落多余字段）。 */
const DEFAULT_SENTINEL = "default";

/**
 * 单个 MCP server 的工具曝光（direct / deferred / hidden）。
 * 单个工具的覆盖（toolExposure）没有控件，在配置文件里编辑；见 docs/specs/codemode.md。
 */
export function McpExposureField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { intl } = useNexIntl();
  return (
    <div className="w-full space-y-1.5 md:w-48">
      <label className="mb-1 block text-ui-base font-medium text-foreground-subtle">
        {intl.formatMessage({ id: "settings.mcp.form.exposure" })}
      </label>
      <Select
        value={value || DEFAULT_SENTINEL}
        onValueChange={(next) => onChange(next === DEFAULT_SENTINEL ? "" : next)}
      >
        <SelectTrigger size="lg" className="w-48" data-testid={TID_SETTINGS_MCP_EXPOSURE_SELECT}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_SENTINEL}>
            {intl.formatMessage({ id: "settings.mcp.form.exposure.default" })}
          </SelectItem>
          {EXPOSURE_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {intl.formatMessage({ id: `settings.mcp.form.exposure.${option}` })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-ui-xs text-muted-foreground">
        {intl.formatMessage({ id: "settings.mcp.form.exposure.hint" })}
      </p>
    </div>
  );
}
