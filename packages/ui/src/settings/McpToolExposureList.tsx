import {
  TID_SETTINGS_MCP_TOOL_EXPOSURE_ROW,
  TID_SETTINGS_MCP_TOOL_EXPOSURE_SEARCH,
} from "@nex/shared";
import { useState } from "react";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useNexIntl } from "@/i18n/IntlProvider.js";
import {
  buildToolExposureRows,
  filterToolExposureRows,
  findUnmatchedToolExposureKeys,
  isToolExposureValue,
  parseToolExposure,
  serializeToolExposure,
  setToolExposure,
} from "./mcpToolExposure.js";

const OPTIONS = ["direct", "deferred", "hidden"] as const;
/** Radix Select 不接受空串 value；哨兵表示「没有精确条目」。 */
const DEFAULT_SENTINEL = "default";

/**
 * 已连接 server 的工具列表，每个工具一个曝光下拉。value 是表单里的 toolExposure JSON 文本，
 * 改动后整体写回——所以未被本列表触及的键（通配、当前不匹配任何工具的键）原样保留。
 */
export function McpToolExposureList({
  toolNames,
  value,
  onChange,
}: {
  toolNames: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { intl } = useNexIntl();
  const map = parseToolExposure(value);
  // 查询只影响展示；toolExposure 仍是整体写回，被过滤掉的行设置不会丢。
  const [query, setQuery] = useState("");
  const allRows = buildToolExposureRows(toolNames, map);
  const rows = filterToolExposureRows(allRows, query);
  const unmatched = findUnmatchedToolExposureKeys(toolNames, map);
  const label = (option: string) =>
    intl.formatMessage({ id: `settings.mcp.form.exposure.${option}` });

  return (
    <div className="space-y-1.5" data-testid="settings-mcp-tool-exposure-list">
      <label className="mb-1 block text-ui-base font-medium text-foreground-subtle">
        {intl.formatMessage({ id: "settings.mcp.form.toolExposure" })}
      </label>
      <p className="text-ui-xs text-muted-foreground">
        {intl.formatMessage({ id: "settings.mcp.form.toolExposure.hint" })}
      </p>
      <Input
        size="lg"
        type="search"
        value={query}
        placeholder={intl.formatMessage({ id: "settings.mcp.form.toolExposure.search" })}
        aria-label={intl.formatMessage({ id: "settings.mcp.form.toolExposure.search" })}
        data-testid={TID_SETTINGS_MCP_TOOL_EXPOSURE_SEARCH}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() ? (
        <p className="text-ui-xs text-muted-foreground">
          {intl.formatMessage(
            { id: "settings.mcp.form.toolExposure.matchCount" },
            { shown: String(rows.length), total: String(allRows.length) },
          )}
        </p>
      ) : null}
      <div className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {rows.length === 0 ? (
          <div className="px-3 py-3 text-ui-sm text-muted-foreground">
            {intl.formatMessage({ id: "settings.mcp.form.toolExposure.noMatch" })}
          </div>
        ) : null}
        {rows.map((row) => (
          <div
            key={row.toolName}
            className="flex items-center justify-between gap-3 px-3 py-1.5"
            data-testid={TID_SETTINGS_MCP_TOOL_EXPOSURE_ROW}
            data-tool-name={row.toolName}
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-ui-sm text-foreground">{row.toolName}</div>
              {row.viaPattern ? (
                <div className="truncate text-ui-xs text-muted-foreground">
                  {intl.formatMessage(
                    { id: "settings.mcp.form.toolExposure.viaPattern" },
                    { pattern: row.viaPattern.pattern, value: label(row.viaPattern.value) },
                  )}
                </div>
              ) : null}
            </div>
            <Select
              value={row.explicit || DEFAULT_SENTINEL}
              onValueChange={(next) =>
                onChange(
                  serializeToolExposure(
                    setToolExposure(map, row.toolName, isToolExposureValue(next) ? next : ""),
                  ),
                )
              }
            >
              <SelectTrigger size="lg" className="w-44 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_SENTINEL}>
                  {intl.formatMessage({ id: "settings.mcp.form.exposure.default" })}
                </SelectItem>
                {OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {label(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      {unmatched.length > 0 ? (
        <p className="text-ui-xs text-muted-foreground">
          {intl.formatMessage(
            { id: "settings.mcp.form.toolExposure.unmatched" },
            { keys: unmatched.join(", ") },
          )}
        </p>
      ) : null}
    </div>
  );
}
