import assert from "node:assert/strict";
import test from "node:test";
import {
  findModelsDevModels,
  modelConfigFromMatches,
  type ModelsDevCatalog,
} from "../src/model-provider/modelsDevCatalog.js";

const catalog: ModelsDevCatalog = {
  openai: {
    models: {
      "gpt-5.4": {
        limit: { context: 1_050_000, output: 128_000 },
        tool_call: true,
        structured_output: true,
        modalities: { input: ["text", "image"] },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
      },
    },
  },
  azure: {
    models: {
      "GPT-5.4": {
        limit: { context: 1_050_000, output: 128_000 },
        tool_call: true,
        modalities: { input: ["text", "pdf"] },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
      },
    },
  },
  aggregator: {
    models: {
      "gpt-5.4": {
        // 聚合商常见的缩水上限，不能压过官方值。
        limit: { context: 400_000, output: 0 },
        tool_call: false,
        reasoning_options: [{ type: "effort", values: [] }],
      },
    },
  },
};

test("findModelsDevModels matches namespaced and differently-cased IDs across providers", () => {
  assert.equal(findModelsDevModels(catalog, "gpt-5.4").length, 3);
  assert.equal(findModelsDevModels(catalog, "  cli/GPT-5.4 ").length, 3);
  assert.deepEqual(findModelsDevModels(catalog, "not-a-real-model"), []);
  assert.deepEqual(findModelsDevModels(catalog, "   "), []);
});

test("findModelsDevModels strips any number of namespace prefixes", () => {
  assert.equal(findModelsDevModels(catalog, "cst/openai/gpt-5.4").length, 3);
  assert.equal(findModelsDevModels(catalog, "a/b/c/GPT-5.4").length, 3);
  assert.deepEqual(findModelsDevModels(catalog, "cst/openai/"), []);

  const slashKeyCatalog: ModelsDevCatalog = {
    router: { models: { "anthropic/claude-sonnet-5-5": { limit: { context: 1 } } } },
  };
  assert.equal(findModelsDevModels(slashKeyCatalog, "cst/anthropic/claude-sonnet-5-5").length, 1);
});

test("modelConfigFromMatches aggregates by majority and ignores invalid values", () => {
  const config = modelConfigFromMatches(findModelsDevModels(catalog, "gpt-5.4"));
  assert.equal(config.properties?.contextWindow, 1_050_000);
  assert.equal(config.properties?.supportsToolCall, true);
  // 只有一个条目声明 structured_output，众数即为该值。
  assert.equal(config.properties?.supportsJsonSchemaOutput, true);
  assert.deepEqual(config.properties?.inputFormat, {
    supportsText: true,
    supportsImage: true,
    supportsVideo: false,
    supportsAudio: false,
    supportsPdf: true,
  });
  assert.deepEqual(config.properties?.outputFormat, { supportsText: true });
  // output: 0 不是合法上限，被丢弃后只剩 128000。
  assert.deepEqual(config.optionSpecs?.maxOutputTokens, { max: 128_000 });
  // 空推理档位不满足 reasoningLevel.values 非空约束，不能参与聚合。
  assert.deepEqual(config.optionSpecs?.reasoningLevel, { values: ["low", "medium", "high"] });
});

test("modelConfigFromMatches breaks numeric ties toward the larger value", () => {
  const config = modelConfigFromMatches([
    { providerId: "a", model: { limit: { context: 200_000 } } },
    { providerId: "b", model: { limit: { context: 1_000_000 } } },
  ]);
  assert.equal(config.properties?.contextWindow, 1_000_000);
});

test("modelConfigFromMatches returns an empty config when nothing is usable", () => {
  assert.deepEqual(modelConfigFromMatches([{ providerId: "a", model: {} }]), {});
});
