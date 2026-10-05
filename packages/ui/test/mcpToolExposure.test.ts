import assert from "node:assert/strict";
import test from "node:test";
import {
  buildToolExposureRows,
  findUnmatchedToolExposureKeys,
  parseToolExposure,
  serializeToolExposure,
  setToolExposure,
} from "../src/settings/mcpToolExposure.js";

const tools = ["take_screenshot", "take_snapshot", "evaluate_script", "list_pages", "click"];

test("rows are sorted; exact entries are explicit; wildcard coverage is read-only", () => {
  const rows = buildToolExposureRows(tools, {
    "take_*": "hidden",
    evaluate_script: "hidden",
    list_pages: "direct",
  });
  assert.deepEqual(rows.map((r) => r.toolName), ["click", "evaluate_script", "list_pages", "take_screenshot", "take_snapshot"]);
  const byName = Object.fromEntries(rows.map((r) => [r.toolName, r]));
  assert.equal(byName.evaluate_script?.explicit, "hidden");
  assert.equal(byName.list_pages?.explicit, "direct");
  assert.equal(byName.click?.explicit, "");
  assert.equal(byName.click?.viaPattern, undefined);
  assert.deepEqual(byName.take_screenshot?.viaPattern, { pattern: "take_*", value: "hidden" });
  assert.equal(byName.take_screenshot?.explicit, "");
});

test("an exact entry wins over a wildcard that also covers the tool", () => {
  const rows = buildToolExposureRows(tools, { "take_*": "hidden", take_snapshot: "direct" });
  const snap = rows.find((r) => r.toolName === "take_snapshot");
  assert.equal(snap?.explicit, "direct");
  assert.equal(snap?.viaPattern, undefined);
});

test("setting Default removes only the exact entry and keeps wildcards verbatim", () => {
  const start = { "take_*": "hidden", click: "deferred" } as const;
  const afterDefault = setToolExposure({ ...start }, "click", "");
  assert.deepEqual(afterDefault, { "take_*": "hidden" });
  const afterSet = setToolExposure(afterDefault, "take_snapshot", "direct");
  assert.deepEqual(afterSet, { "take_*": "hidden", take_snapshot: "direct" });
});

test("keys matching no current tool are reported, never dropped by an edit", () => {
  const map = { old_tool: "hidden", "gone_*": "deferred", click: "direct" } as const;
  assert.deepEqual(findUnmatchedToolExposureKeys(tools, { ...map }), ["old_tool", "gone_*"]);
  const edited = setToolExposure({ ...map }, "list_pages", "hidden");
  assert.equal(edited.old_tool, "hidden");
  assert.equal(edited["gone_*"], "deferred");
});

test("parse tolerates junk and serialize writes nothing when empty", () => {
  assert.deepEqual(parseToolExposure(""), {});
  assert.deepEqual(parseToolExposure("not json"), {});
  assert.deepEqual(parseToolExposure("[1]"), {});
  assert.deepEqual(parseToolExposure('{"a":"hidden","b":"sometimes"}'), { a: "hidden" });
  assert.equal(serializeToolExposure({}), "");
  assert.deepEqual(JSON.parse(serializeToolExposure({ a: "direct" })), { a: "direct" });
});

test("regex metacharacters in tool names and patterns match literally", () => {
  const rows = buildToolExposureRows(["a.b", "aXb"], { "a.*": "hidden" });
  assert.equal(rows.find((r) => r.toolName === "a.b")?.viaPattern?.value, "hidden");
  assert.equal(rows.find((r) => r.toolName === "aXb")?.viaPattern, undefined);
});
