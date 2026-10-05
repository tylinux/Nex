import assert from "node:assert/strict";
import test from "node:test";
import { createWebMcpPlatform } from "../src/webMcpPlatform.js";

test("load and save are forwarded to the mcp-sync RPC service", async () => {
  const calls: string[] = [];
  const platform = createWebMcpPlatform({
    loadMcpFromUserDirectory: async (payload) => {
      calls.push(`load:${JSON.stringify(payload)}`);
      return { servers: [] };
    },
    saveMcpToUserDirectory: async (payload) => {
      calls.push(`save:${payload.name}`);
    },
  });
  assert.deepEqual(await platform.loadMcpFromUserDirectory?.({ workspacePath: "/w" }), { servers: [] });
  assert.deepEqual(
    await platform.saveMcpToUserDirectory?.({ action: "upsert", source: "nexagentmcp", name: "s" }),
    { success: true },
  );
  assert.deepEqual(calls, ['load:{"workspacePath":"/w"}', "save:s"]);
});

test("a failing save is reported as success:false with the message, never thrown", async () => {
  const platform = createWebMcpPlatform({
    loadMcpFromUserDirectory: async () => ({ servers: [] }),
    saveMcpToUserDirectory: async () => {
      throw new Error("disk full");
    },
  });
  assert.deepEqual(
    await platform.saveMcpToUserDirectory?.({ action: "upsert", source: "nexagentmcp", name: "s" }),
    { success: false, error: "disk full" },
  );
});
