import assert from "node:assert/strict";
import test from "node:test";
import { nexSessionRuntimePreferencesResultSchema } from "@nex/shared";

test("session runtime preferences default toolSearchEnabled to false for older hosts", () => {
  const parsed = nexSessionRuntimePreferencesResultSchema.parse({
    nativeSearchEnhancementsEnabled: true,
  });
  assert.equal(parsed.toolSearchEnabled, false);
});

test("session runtime preferences carry toolSearchEnabled=true", () => {
  const parsed = nexSessionRuntimePreferencesResultSchema.parse({
    nativeSearchEnhancementsEnabled: true,
    toolSearchEnabled: true,
  });
  assert.equal(parsed.toolSearchEnabled, true);
});

test("session runtime preferences default codemodeEnabled to false and carry true", () => {
  assert.equal(
    nexSessionRuntimePreferencesResultSchema.parse({ nativeSearchEnhancementsEnabled: true })
      .codemodeEnabled,
    false,
  );
  assert.equal(
    nexSessionRuntimePreferencesResultSchema.parse({
      nativeSearchEnhancementsEnabled: true,
      codemodeEnabled: true,
    }).codemodeEnabled,
    true,
  );
});
