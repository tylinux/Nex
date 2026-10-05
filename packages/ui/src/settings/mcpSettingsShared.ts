import type { McpServerConfig, NexMcpServer } from "@nex/shared";

export const MCP_SECTIONS = ["nexagentmcp"] as const;

export type ServerScope = (typeof MCP_SECTIONS)[number];
export type ConfigStorageLevel = "user" | "workspace";
export type McpEditorMode = "form" | "json";

export interface FormState {
  name: string;
  scope: ServerScope;
  storageLevel: ConfigStorageLevel;
  type: "stdio" | "http" | "sse" | "streamableHttp";
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  timeoutMs: string;
  oauth?: string;
  protocolVersion: string;
  /** 本 server 全部工具的曝光；空串 = 未设置（由会话默认决定）。 */
  exposure: string;
  /**
   * 单个工具的曝光覆盖。表单没有对应控件（在配置文件里编辑），但保存仍走 FormState，
   * 必须隐藏保留，否则只改了 exposure 下拉就会把用户手写的 toolExposure 吞掉。
   */
  toolExposure: string;
}

export const EMPTY_FORM: FormState = {
  name: "",
  scope: "nexagentmcp",
  storageLevel: "user",
  type: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
  timeoutMs: "",
  oauth: "",
  protocolVersion: "",
  exposure: "",
  toolExposure: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serverToForm(server: NexMcpServer): FormState {
  const cfg = server.config;
  let type: FormState["type"];
  if (cfg.type === "sse") {
    type = "sse";
  } else if (cfg.type === "streamableHttp") {
    type = "streamableHttp";
  } else if (cfg.command) {
    type = "stdio";
  } else {
    type = "http";
  }
  return {
    name: server.name,
    scope: "nexagentmcp",
    storageLevel: server.scope === "workspace" ? "workspace" : "user",
    type,
    command: cfg.command ?? "",
    args: (cfg.args ?? []).join(" "),
    env: cfg.env ? JSON.stringify(cfg.env, null, 2) : "",
    url: cfg.url ?? "",
    headers: cfg.headers ? JSON.stringify(cfg.headers, null, 2) : "",
    timeoutMs: typeof cfg.timeoutMs === "number" ? String(cfg.timeoutMs) : "",
    oauth: isRecord(cfg.oauth) ? JSON.stringify(cfg.oauth, null, 2) : "",
    // 非法枚举值归一为未设置（等价 auto），与 shared DTO 的 isMcpProtocolVersion
    // 静默丢弃行为对齐；否则 config 里的手滑值会让协议版本下拉显示空白。
    protocolVersion: isMcpProtocolVersion(cfg.protocolVersion) ? cfg.protocolVersion : "",
    exposure: isMcpExposure(cfg.exposure) ? cfg.exposure : "",
    toolExposure: isRecord(cfg.toolExposure) ? JSON.stringify(cfg.toolExposure, null, 2) : "",
  };
}

export function formToConfig(form: FormState): McpServerConfig {
  const timeoutMs = parseTimeoutMs(form.timeoutMs);
  if (form.type === "stdio") {
    let env: Record<string, string> | undefined;
    if (form.env.trim()) {
      try {
        env = JSON.parse(form.env) as Record<string, string>;
      } catch {
        // ignore invalid json until save validation
      }
    }

    return {
      type: "stdio",
      command: form.command,
      args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
      env,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(form.protocolVersion
        ? { protocolVersion: form.protocolVersion as McpServerConfig["protocolVersion"] }
        : {}),
      ...exposureConfig(form),
    };
  }

  let headers: Record<string, string> | undefined;
  if (form.headers.trim()) {
    try {
      headers = JSON.parse(form.headers) as Record<string, string>;
    } catch {
      // ignore invalid json until save validation
    }
  }

  let oauth: McpServerConfig["oauth"] | undefined;
  if (form.oauth?.trim()) {
    try {
      oauth = JSON.parse(form.oauth) as McpServerConfig["oauth"];
    } catch {
      // ignore invalid json until save validation
    }
  }

  return {
    type: form.type,
    url: form.url,
    headers,
    ...(oauth !== undefined ? { oauth } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(form.protocolVersion
      ? { protocolVersion: form.protocolVersion as McpServerConfig["protocolVersion"] }
      : {}),
    ...exposureConfig(form),
  };
}

/** 未设置的字段不写进配置文件；toolExposure 解析失败时丢弃（保存校验会提示 JSON 错误的其它字段）。 */
function exposureConfig(form: FormState): {
  exposure?: "direct" | "deferred" | "hidden";
  toolExposure?: Record<string, string>;
} {
  let toolExposure: Record<string, string> | undefined;
  if (form.toolExposure.trim()) {
    try {
      const parsed = JSON.parse(form.toolExposure) as unknown;
      if (isRecord(parsed)) toolExposure = parsed as Record<string, string>;
    } catch {
      // ignore invalid json until save validation
    }
  }
  return {
    ...(isMcpExposure(form.exposure) ? { exposure: form.exposure } : {}),
    ...(toolExposure !== undefined ? { toolExposure } : {}),
  };
}

function parseTimeoutMs(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function formToJsonDraft(form: FormState): string {
  const fallbackName = form.name.trim() || "my-mcp-server";
  return JSON.stringify({ [fallbackName]: formToConfig(form) }, null, 2);
}

export function jsonDraftToForm(jsonText: string, fallback: FormState): FormState {
  const parsed = JSON.parse(jsonText) as unknown;

  let serverName = fallback.name.trim();
  let serverConfig: unknown = parsed;

  if (isRecord(parsed) && isRecord(parsed.mcpServers)) {
    const entries = Object.entries(parsed.mcpServers).filter(([, value]) => isRecord(value));
    if (entries.length !== 1) {
      throw new Error("JSON 模式暂时只支持一次编辑一个 MCP server");
    }
    const [singleName, singleConfig] = entries[0]!;
    serverName = singleName;
    serverConfig = singleConfig;
  } else if (isRecord(parsed)) {
    const entries = Object.entries(parsed).filter(([, value]) => isRecord(value));
    if (
      entries.length === 1 &&
      !("type" in parsed) &&
      !("command" in parsed) &&
      !("url" in parsed)
    ) {
      const [singleName, singleConfig] = entries[0]!;
      serverName = singleName;
      serverConfig = singleConfig;
    }
  }

  if (!isRecord(serverConfig)) {
    throw new Error("JSON 内容不是有效的 MCP server 配置对象");
  }

  if (!serverName) {
    throw new Error("JSON 模式需要提供 server 名称");
  }

  const normalizedConfig = serverConfig as McpServerConfig;
  let normalizedType: FormState["type"];
  if (normalizedConfig.type === "sse") {
    normalizedType = "sse";
  } else if (normalizedConfig.type === "streamableHttp") {
    normalizedType = "streamableHttp";
  } else if (normalizedConfig.command) {
    normalizedType = "stdio";
  } else {
    normalizedType = "http";
  }

  return {
    name: serverName,
    scope: fallback.scope,
    storageLevel: fallback.storageLevel,
    type: normalizedType,
    command: normalizedConfig.command ?? "",
    args: Array.isArray(normalizedConfig.args) ? normalizedConfig.args.join(" ") : "",
    env: normalizedConfig.env ? JSON.stringify(normalizedConfig.env, null, 2) : "",
    url: normalizedConfig.url ?? "",
    headers: normalizedConfig.headers ? JSON.stringify(normalizedConfig.headers, null, 2) : "",
    // JSON 模式会先转成 FormState 再保存；这里必须保留 timeoutMs，
    // 否则用户粘贴的 MCP tool 超时配置会被表单保存链路吞掉。
    timeoutMs:
      typeof normalizedConfig.timeoutMs === "number" ? String(normalizedConfig.timeoutMs) : "",
    // JSON 模式没有 OAuth 表单控件，但保存仍会走 FormState；
    // 需要隐藏保留 oauth，避免 Notion 等授权型 MCP 被保存成裸连配置。
    oauth: isRecord(normalizedConfig.oauth) ? JSON.stringify(normalizedConfig.oauth, null, 2) : "",
    // 手工配置的 protocolVersion 兼容开关也必须保留，否则 UI 编辑保存后
    // 会被表单链路吞掉，非标 legacy server 的兼容配置被静默还原成 auto。
    // 非法枚举值同样归一为未设置，不把可立即发现的配置错误留给连接阶段。
    protocolVersion: isMcpProtocolVersion(normalizedConfig.protocolVersion)
      ? normalizedConfig.protocolVersion
      : "",
    // JSON 模式同样要保留曝光配置，非法枚举归一为未设置。
    exposure: isMcpExposure(normalizedConfig.exposure) ? normalizedConfig.exposure : "",
    toolExposure: isRecord(normalizedConfig.toolExposure)
      ? JSON.stringify(normalizedConfig.toolExposure, null, 2)
      : "",
  };
}

function isMcpExposure(value: unknown): value is "direct" | "deferred" | "hidden" {
  return value === "direct" || value === "deferred" || value === "hidden";
}

// 与 shared 层 convertToNexAgentMcpServer 的 isMcpProtocolVersion 守卫保持同一语义：
// 非法枚举值在 UI 读取侧就归一为未设置（等价 auto），不留给连接阶段。
function isMcpProtocolVersion(value: unknown): value is "legacy" | "auto" | "2026-07-28" {
  return value === "legacy" || value === "auto" || value === "2026-07-28";
}
