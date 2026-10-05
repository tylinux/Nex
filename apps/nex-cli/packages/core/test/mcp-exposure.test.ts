import assert from "node:assert/strict";
import test from "node:test";
import { resolveMcpToolExposure, sessionHasDeferredMcpConfig } from "../src/mcp/exposure.js";
import { registerMcpTools } from "../src/mcp/index.js";
import { createToolRegistry } from "../src/tool/registry.js";
import type { McpPort, McpToolDescriptor } from "@nex/contracts";

const direct = { sessionDefault: "direct" as const };
const deferred = { sessionDefault: "deferred" as const };

test("toolExposure beats exposure beats the session default", () => {
  const config = { exposure: "deferred" as const, toolExposure: { read_issue: "direct" as const } };
  assert.equal(resolveMcpToolExposure(config, "read_issue", direct), "direct");
  assert.equal(resolveMcpToolExposure(config, "post_message", direct), "deferred");
  assert.equal(resolveMcpToolExposure({}, "x", direct), "direct");
  assert.equal(resolveMcpToolExposure({}, "x", deferred), "deferred");
  assert.equal(resolveMcpToolExposure(undefined, "x", deferred), "deferred");
});

test("exact name wins over patterns; the first matching pattern wins; * matches any characters", () => {
  const config = {
    exposure: "direct" as const,
    toolExposure: { "delete_*": "hidden" as const, "*": "deferred" as const, delete_draft: "direct" as const },
  };
  assert.equal(resolveMcpToolExposure(config, "delete_draft", direct), "direct");
  assert.equal(resolveMcpToolExposure(config, "delete_repo", direct), "hidden");
  assert.equal(resolveMcpToolExposure(config, "list", direct), "deferred");
  // 正则元字符必须按字面匹配
  const dotted = { toolExposure: { "a.b": "hidden" as const } };
  assert.equal(resolveMcpToolExposure(dotted, "a.b", direct), "hidden");
  assert.equal(resolveMcpToolExposure(dotted, "aXb", direct), "direct");
});

test("ToolSearch is needed when the default or any server/tool resolves to deferred", () => {
  assert.equal(sessionHasDeferredMcpConfig({}, direct), false);
  assert.equal(sessionHasDeferredMcpConfig({}, deferred), true);
  assert.equal(sessionHasDeferredMcpConfig({ a: { type: "stdio", command: "x", exposure: "deferred" } }, direct), true);
  assert.equal(
    sessionHasDeferredMcpConfig({ a: { type: "stdio", command: "x", toolExposure: { t: "deferred" } } }, direct),
    true,
  );
  assert.equal(sessionHasDeferredMcpConfig({ a: { type: "stdio", command: "x", exposure: "hidden" } }, direct), false);
});

function descriptor(serverName: string, toolName: string): McpToolDescriptor {
  return { serverName, toolName, description: `${toolName} tool`, inputSchema: { type: "object" } } as McpToolDescriptor;
}

test("registerMcpTools: hidden tools are not registered, deferred are, direct are", () => {
  const registry = createToolRegistry();
  const exposures: Record<string, "direct" | "deferred" | "hidden"> = {
    read: "direct",
    search: "deferred",
    drop: "hidden",
  };
  const registered = registerMcpTools(
    registry,
    {} as McpPort,
    [descriptor("s", "read"), descriptor("s", "search"), descriptor("s", "drop")],
    { exposureFor: (_server, tool) => exposures[tool]! },
  );
  assert.equal(registered.length, 2);
  assert.equal(registry.has("mcp__s__drop"), false);
  assert.equal(registry.get("mcp__s__search")?.metadata.exposure, "deferred");
  assert.equal(registry.get("mcp__s__read")?.metadata.exposure, undefined);
  assert.deepEqual(registry.toContracts().map((c) => c.name).sort(), ["mcp__s__read", "mcp__s__search"]);
});

test("withoutHiddenMcpTools removes hidden tools from the snapshot, listTools and callTool", async () => {
  const { withoutHiddenMcpTools } = await import("../src/subagent/borrowed-mcp-port.js");
  const calls: string[] = [];
  const snapshot = {
    statuses: {},
    tools: [descriptor("s", "keep"), descriptor("s", "secret")],
  };
  const port = {
    async callTool(request: { serverName: string; toolName: string }) {
      calls.push(`${request.serverName}/${request.toolName}`);
      return { content: [] };
    },
    async listTools() {
      return snapshot.tools;
    },
  } as unknown as McpPort;
  const filtered = withoutHiddenMcpTools({ snapshot, port }, (_s, tool) => tool === "secret");
  assert.deepEqual(filtered.snapshot.tools.map((t) => t.toolName), ["keep"]);
  assert.deepEqual((await filtered.port.listTools()).map((t) => t.toolName), ["keep"]);
  await filtered.port.callTool({ serverName: "s", toolName: "keep", arguments: {} } as never);
  await assert.rejects(
    filtered.port.callTool({ serverName: "s", toolName: "secret", arguments: {} } as never),
    /hidden/,
  );
  assert.deepEqual(calls, ["s/keep"]);
});
