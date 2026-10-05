import assert from "node:assert/strict";
import test from "node:test";
import type { NexMcpServer } from "@nex/shared";
import {
  EMPTY_FORM,
  formToConfig,
  jsonDraftToForm,
  serverToForm,
} from "../src/settings/mcpSettingsShared.js";

function server(config: Record<string, unknown>): NexMcpServer {
  return {
    id: "s",
    name: "github",
    config,
    enabled: true,
    scope: "user",
  } as unknown as NexMcpServer;
}

test("exposure and hand-written toolExposure survive a form round trip", () => {
  const form = serverToForm(
    server({
      type: "stdio",
      command: "node",
      exposure: "deferred",
      toolExposure: { read_issue: "direct", "delete_*": "hidden" },
    }),
  );
  assert.equal(form.exposure, "deferred");
  // 只改下拉不能吞掉用户手写的 toolExposure
  const saved = formToConfig({ ...form, exposure: "hidden" });
  assert.equal(saved.exposure, "hidden");
  assert.deepEqual(saved.toolExposure, { read_issue: "direct", "delete_*": "hidden" });
});

test("an unset exposure writes no field, and an invalid one is treated as unset", () => {
  const unset = formToConfig({ ...EMPTY_FORM, type: "http", url: "https://example.test/mcp" });
  assert.equal("exposure" in unset, false);
  assert.equal("toolExposure" in unset, false);
  assert.equal(
    serverToForm(server({ type: "stdio", command: "x", exposure: "sometimes" })).exposure,
    "",
  );
});

test("JSON mode keeps exposure and toolExposure", () => {
  const form = jsonDraftToForm(
    JSON.stringify({
      s: {
        type: "http",
        url: "https://example.test/mcp",
        exposure: "hidden",
        toolExposure: { ping: "direct" },
      },
    }),
    EMPTY_FORM,
  );
  const config = formToConfig(form);
  assert.equal(config.exposure, "hidden");
  assert.deepEqual(config.toolExposure, { ping: "direct" });
});
