// 逐工具曝光编辑的纯逻辑：把 server 的工具名与 toolExposure（精确名/通配）合成列表行，
// 并把用户的选择写回 toolExposure。规则与 core 的 resolveMcpToolExposure 一致
// （精确名优先，其次按对象顺序第一个命中的通配）；见 docs/specs/codemode.md。

export type McpToolExposureValue = "direct" | "deferred" | "hidden";
export type McpToolExposureMap = Record<string, McpToolExposureValue>;

export interface McpToolExposureRow {
  toolName: string;
  /** 精确名条目的值；空串 = 没有精确条目（Default，或被通配覆盖）。 */
  explicit: McpToolExposureValue | "";
  /** 没有精确条目、但被某个通配命中时，那个通配与它的值（只读展示）。 */
  viaPattern?: { pattern: string; value: McpToolExposureValue };
}

export function isToolExposureValue(value: unknown): value is McpToolExposureValue {
  return value === "direct" || value === "deferred" || value === "hidden";
}

function patternMatches(pattern: string, toolName: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(toolName);
}

/** 表单里 toolExposure 以 JSON 文本保存；解析失败视为空，保存校验会另行提示。 */
export function parseToolExposure(text: string): McpToolExposureMap {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, McpToolExposureValue] =>
        isToolExposureValue(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function serializeToolExposure(map: McpToolExposureMap): string {
  return Object.keys(map).length === 0 ? "" : JSON.stringify(map, null, 2);
}

export function buildToolExposureRows(
  toolNames: readonly string[],
  map: McpToolExposureMap,
): McpToolExposureRow[] {
  const patterns = Object.entries(map).filter(([key]) => key.includes("*"));
  return [...toolNames]
    .sort((a, b) => a.localeCompare(b))
    .map((toolName) => {
      const exact = map[toolName];
      if (exact !== undefined && !toolName.includes("*")) {
        return { toolName, explicit: exact };
      }
      const hit = patterns.find(([pattern]) => patternMatches(pattern, toolName));
      return {
        toolName,
        explicit: "" as const,
        ...(hit === undefined ? {} : { viaPattern: { pattern: hit[0], value: hit[1] } }),
      };
    });
}

/**
 * 按名字过滤列表行：不区分大小写的子串匹配，查询按空白拆成多个词时每个词都要命中（AND）。
 * 只过滤展示，不触碰 toolExposure——被过滤掉的行的设置照常保留并随保存写回。
 */
export function filterToolExposureRows(
  rows: readonly McpToolExposureRow[],
  query: string,
): McpToolExposureRow[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => {
    const name = row.toolName.toLowerCase();
    return terms.every((term) => name.includes(term));
  });
}

/** toolExposure 里没有任何当前工具能被它命中的键：保留并单独展示，不能因为暂时断连/改名就丢。 */
export function findUnmatchedToolExposureKeys(
  toolNames: readonly string[],
  map: McpToolExposureMap,
): string[] {
  return Object.keys(map).filter((key) =>
    key.includes("*")
      ? !toolNames.some((name) => patternMatches(key, name))
      : !toolNames.includes(key),
  );
}

/** 设置某个工具的精确条目；value 为空串 = 回到 Default（删除精确条目，通配条目原样保留）。 */
export function setToolExposure(
  map: McpToolExposureMap,
  toolName: string,
  value: McpToolExposureValue | "",
): McpToolExposureMap {
  const next: McpToolExposureMap = { ...map };
  if (value === "") delete next[toolName];
  else next[toolName] = value;
  return next;
}
