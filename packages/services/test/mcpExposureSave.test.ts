import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMcpSyncService } from "../src/mcp-sync/mcpSyncService.js";

// 设置页「保存」最终落到 ~/.nex/cli/config.json 的 mcp.servers；
// exposure / toolExposure 必须原样落盘，且不能损坏同一文件里的其它 server。
test("saving an MCP server keeps exposure/toolExposure and other servers intact", async () => {
  const home = await mkdtemp(join(tmpdir(), "nex-mcp-save-"));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const file = join(home, ".nex", "cli", "config.json");
    await mkdir(join(home, ".nex", "cli"), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        mcp: {
          servers: { keep: { type: "stdio", command: "node", toolExposure: { t: "hidden" } } },
        },
      }),
    );
    const service = createMcpSyncService();
    await service.saveMcpToUserDirectory({
      action: "upsert",
      source: "nexagentmcp",
      name: "added",
      config: {
        type: "stdio",
        command: "echo",
        exposure: "deferred",
        toolExposure: { "a_*": "direct" },
      },
    });
    const written = JSON.parse(await readFile(file, "utf8")) as {
      mcp: { servers: Record<string, Record<string, unknown>> };
    };
    assert.deepEqual(written.mcp.servers.added?.toolExposure, { "a_*": "direct" });
    assert.equal(written.mcp.servers.added?.exposure, "deferred");
    assert.deepEqual(written.mcp.servers.keep?.toolExposure, { t: "hidden" });

    const loaded = await service.loadMcpFromUserDirectory({});
    const added = loaded.servers.find((server) => server.name === "added");
    assert.equal(added?.config.exposure, "deferred");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  }
});
