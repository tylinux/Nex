import assert from "node:assert/strict";
import test from "node:test";
import { parseConfigFileToRuntimePatchWithDiagnostics } from "../src/config/schema.js";

test("exposure and toolExposure survive config parsing and reach the runtime patch", () => {
  const { config } = parseConfigFileToRuntimePatchWithDiagnostics({
    mcp: {
      servers: {
        github: {
          type: "stdio",
          command: "node",
          exposure: "deferred",
          toolExposure: { read_issue: "direct", "delete_*": "hidden" },
        },
      },
    },
  });
  const server = config.mcp?.servers?.github;
  assert.equal(server?.exposure, "deferred");
  assert.deepEqual(server?.toolExposure, { read_issue: "direct", "delete_*": "hidden" });
});

test("an invalid exposure drops only that server and reports why; it is never coerced", () => {
  const bad = parseConfigFileToRuntimePatchWithDiagnostics({
    mcp: {
      servers: {
        typo: { type: "stdio", command: "node", exposure: "sometimes" },
        fine: { type: "stdio", command: "node", exposure: "hidden" },
      },
    },
  });
  assert.deepEqual(Object.keys(bad.config.mcp?.servers ?? {}), ["fine"]);
  assert.equal(bad.diagnostics.length, 1);
  assert.equal(bad.diagnostics[0]?.path, "mcp.servers.typo");
  assert.match(bad.diagnostics[0]?.message ?? "", /exposure/);

  const badTool = parseConfigFileToRuntimePatchWithDiagnostics({
    mcp: { servers: { s: { type: "stdio", command: "node", toolExposure: { t: "codemode" } } } },
  });
  assert.deepEqual(badTool.config.mcp?.servers, {});
  assert.match(badTool.diagnostics[0]?.message ?? "", /toolExposure\.t/);
});

test("a server without exposure fields stays unchanged", () => {
  const { config } = parseConfigFileToRuntimePatchWithDiagnostics({
    mcp: { servers: { s: { type: "http", url: "https://example.test/mcp" } } },
  });
  const server = config.mcp?.servers?.s;
  assert.equal(server?.exposure, undefined);
  assert.equal(server?.toolExposure, undefined);
});
