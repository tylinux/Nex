// ============================================================
// MCP 工具曝光解析
// ============================================================
// 优先级：toolExposure（精确名 > 通配，多个通配按对象顺序取第一个）→ server.exposure → 会话默认。
// 纯函数、无副作用；registerMcpTools 与 ToolSearch 的注册门共用它，避免两处各算一遍。

import type { McpExposure, McpServerConfig } from "@nex/contracts";

export interface McpExposureDefaults {
  /** 会话默认：开启 toolSearch 为 deferred，否则 direct。 */
  sessionDefault: McpExposure;
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`);
}

export function resolveMcpToolExposure(
  config: Pick<McpServerConfig, "exposure" | "toolExposure"> | undefined,
  serverToolName: string,
  defaults: McpExposureDefaults,
): McpExposure {
  const overrides = config?.toolExposure;
  if (overrides !== undefined) {
    const exact = overrides[serverToolName];
    if (exact !== undefined) return exact;
    for (const [pattern, exposure] of Object.entries(overrides)) {
      if (pattern.includes("*") && patternToRegExp(pattern).test(serverToolName)) return exposure;
    }
  }
  return config?.exposure ?? defaults.sessionDefault;
}

/** 会话里是否有任何 server/tool 会解析成 deferred：决定 ToolSearch 是否需要注册。 */
export function sessionHasDeferredMcpConfig(
  servers: Readonly<Record<string, McpServerConfig>> | undefined,
  defaults: McpExposureDefaults,
): boolean {
  if (defaults.sessionDefault === "deferred") return true;
  for (const config of Object.values(servers ?? {})) {
    if (config.exposure === "deferred") return true;
    if (Object.values(config.toolExposure ?? {}).includes("deferred")) return true;
  }
  return false;
}
