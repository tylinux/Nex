import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMcpAdapter } from "@nex/adapters";
import { registerMcpTools } from "@nex/core";
import { TOOL_SEARCH_TOOL_NAME } from "@nex/contracts";
import {
  createToolRegistry,
  encodeToolSearchResults,
  filterDeclaredToolContracts,
  searchToolDocuments,
  toolSearchToolEntry,
} from "@nex/core";

const SERVER_PATH = fileURLToPath(new URL("./fixtures/echo-mcp-server.mjs", import.meta.url));

test("real stdio MCP server: tools register deferred, search activates, call still works", async () => {
  const mcpPort = createMcpAdapter();
  try {
    const snapshot = await mcpPort.connectConfiguredServers({
      fixture: { type: "stdio", command: process.execPath, args: [SERVER_PATH] },
    });
    assert.equal(snapshot.tools.length, 2);

    // 设置页的逐工具曝光列表依赖状态里的 toolNames：必须是 server 自己的工具名（非 mcp__ 形式）。
    const status = snapshot.statuses.fixture;
    assert.equal(status?.status, "connected");
    assert.deepEqual([...(status?.toolNames ?? [])].sort(), ["post_message", "read_issue"]);
    assert.equal(status?.toolCount, 2);

    const registry = createToolRegistry();
    registry.register(toolSearchToolEntry);
    const registered = registerMcpTools(registry, mcpPort, snapshot.tools, {
      exposureFor: () => "deferred" as const,
    });
    assert.equal(registered.length, 2);

    const history: Parameters<typeof filterDeclaredToolContracts>[2] = [];
    const declared = () =>
      filterDeclaredToolContracts(registry.toContracts(), registry, history).map(
        (tool) => tool.name,
      );

    // 第一次请求：只有 ToolSearch，MCP schema 都不在。
    assert.deepEqual(declared(), [TOOL_SEARCH_TOOL_NAME]);

    // ToolSearch 命中真实 MCP 工具；结果写进历史后下一次请求才带 schema。
    const hits = searchToolDocuments(registry.listDeferredDocuments(), {
      query: "read github issue",
      limit: 8,
    });
    assert.match(hits[0]?.name ?? "", /read_issue$/);
    history.push(
      {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "s1", name: TOOL_SEARCH_TOOL_NAME, input: { query: "issue" } }],
        },
      },
      {
        message: {
          role: "tool",
          toolCallId: "s1",
          content: encodeToolSearchResults(
            hits.slice(0, 1).map((hit) => ({ name: hit.name, description: hit.description })),
          ),
        },
      },
    );
    assert.deepEqual(declared().sort(), [hits[0]!.name, TOOL_SEARCH_TOOL_NAME].sort());

    // 未发现也可调用：声明被延迟，执行权不受影响（真实 MCP 往返）。
    const result = await mcpPort.callTool({
      serverName: "fixture",
      toolName: "post_message",
      arguments: { text: "hi" },
    } as never);
    assert.match(JSON.stringify(result), /posted:hi/);
  } finally {
    await mcpPort.close();
  }
});
