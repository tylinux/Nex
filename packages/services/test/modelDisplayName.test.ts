import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelConfig,
  ModelConfigRules,
  clearManualModelConfig,
  extractManualModelConfig,
} from "@nex/provider";
import { modelDisplayNameSchema, modelConfigDataSchema } from "@nex/shared/model-config";

const manualLeaves = {
  properties: {
    contextWindow: 200_000,
    supportsJsonSchemaOutput: false,
    supportsNativeWebSearch: false,
    supportsMidConversationSystem: false,
    inputFormat: { supportsImage: false, supportsVideo: false, supportsPdf: false },
  },
  optionSpecs: {
    reasoningLevel: { values: ["low", "high"], map: '{"reasoning_effort": reasoningLevel}' },
    maxOutputTokens: { max: 32_000 },
  },
};

test("modelDisplayNameSchema trims and bounds the alias", () => {
  assert.equal(modelDisplayNameSchema.parse("  sonnet-5-5  "), "sonnet-5-5");
  assert.equal(modelDisplayNameSchema.parse("a/b 模型"), "a/b 模型");
  assert.equal(modelDisplayNameSchema.safeParse("").success, false);
  assert.equal(modelDisplayNameSchema.safeParse("   ").success, false);
  assert.equal(modelDisplayNameSchema.safeParse("x".repeat(65)).success, false);
  assert.equal(modelDisplayNameSchema.safeParse("a\nb").success, false);
});

test("model config accepts name as an optional sparse leaf", () => {
  assert.equal(modelConfigDataSchema.safeParse({ name: "sonnet" }).success, true);
  assert.equal(modelConfigDataSchema.safeParse({ name: null }).success, true);
  assert.equal(modelConfigDataSchema.safeParse({ name: "" }).success, false);
});

test("ModelConfig overlays and serializes name", () => {
  const base = ModelConfig.fromData({ enabled: true });
  const named = base.overlay(ModelConfig.fromData({ name: "sonnet" }));
  assert.equal(named.name, "sonnet");
  assert.deepEqual(named.toJSON(), { enabled: true, name: "sonnet" });
  assert.equal(named.overlay(ModelConfig.fromData({ enabled: false })).name, "sonnet");
  assert.equal("name" in base.toJSON(), false);
});

test("personal rules carry name for both recommended and fixed models", () => {
  const rules = ModelConfigRules.empty()
    .setExact(
      "magpie",
      "cst/claude/claude-sonnet-5-5",
      ModelConfig.fromData({ name: "sonnet" }),
      true,
    )
    .setExact(
      "magpie",
      "fixed-model",
      ModelConfig.fromData({ enabled: true, name: "fixed", ...manualLeaves }),
      false,
    );
  // toPersonalJSON 在编码边界会按个人规则 schema 严格校验，非法形状会直接抛错。
  const json = rules.toPersonalJSON();
  assert.equal(json.providerModelRules[0]?.config.name, "sonnet");
  assert.equal(json.manualProviderModelRules[0]?.config.name, "fixed");

  const resolved = rules.resolve({ providerId: "magpie", modelId: "cst/claude/claude-sonnet-5-5" });
  assert.equal(resolved.name, "sonnet");
  assert.equal(rules.resolve({ providerId: "magpie", modelId: "unnamed-model" }).name, undefined);
});

test("name survives switching between recommended and fixed config", () => {
  const personal = { enabled: true, name: "sonnet", ...manualLeaves };
  assert.equal(extractManualModelConfig(personal).name, "sonnet");
  const cleared = clearManualModelConfig(personal);
  assert.equal(cleared.name, "sonnet");
  assert.equal(cleared.enabled, true);
  assert.equal(cleared.properties, undefined);
  assert.equal(cleared.optionSpecs, undefined);
});
