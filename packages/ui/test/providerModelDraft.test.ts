import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderSettingsFormModel } from "../src/lib/providerSettingsFormTypes.js";
import {
  createProviderModelDraftValues,
  resolveProviderModelDraftCommit,
} from "../src/settings/model-provider-section/ProviderModelMetadata.js";
import {
  projectModelDraft,
  restoreModelDraft,
  updateModelDraft,
} from "../src/settings/model-provider-section/ProviderModelDraftState.js";
import { buildRegistryModelSelectGroups } from "../src/lib/modelSelectionGroups.js";
import { decodeCustomModelValue } from "../src/lib/nexCustomModelValue.js";
import { NEX_AGENT_PROVIDER } from "@nex/shared";
import type { ModelSelectionView } from "@nex/services";
import { modelInfoDraftPatch } from "../src/settings/model-provider-section/useModelInfoLookup.js";

function modelWithBaseline(contextWindow: number, maxOutput: number): ProviderSettingsFormModel {
  const inherited = {
    properties: { contextWindow },
    optionSpecs: { maxOutputTokens: { max: maxOutput } },
  };
  return {
    modelId: "gpt-5.4",
    config: inherited,
    inheritedConfig: inherited,
    personalConfig: {},
  } as unknown as ProviderSettingsFormModel;
}

test("projectModelDraft fills empty text controls from the inherited baseline", () => {
  const model = modelWithBaseline(200_000, 32_000);
  const draft = projectModelDraft(
    { ...createProviderModelDraftValues(model), contextWindowValue: "", maxOutputTokensValue: "" },
    model,
  );
  assert.equal(draft.contextWindowValue, "200000");
  assert.equal(draft.maxOutputTokensValue, "32000");
});

test("updateModelDraft clears auto-filled values on ID change but keeps manual edits", () => {
  const model = modelWithBaseline(200_000, 32_000);
  const draft = {
    ...projectModelDraft(createProviderModelDraftValues(model), model),
    contextWindowValue: "200000",
    maxOutputTokensValue: "555555",
  };
  const next = updateModelDraft(draft, { idValue: "other-model" }, model);
  assert.equal(next.idValue, "other-model");
  assert.equal(next.contextWindowValue, "");
  assert.equal(next.maxOutputTokensValue, "555555");
});

test("modelInfoDraftPatch only writes fields present in the looked-up config", () => {
  assert.deepEqual(modelInfoDraftPatch({}), {});
  assert.deepEqual(
    modelInfoDraftPatch({
      properties: { contextWindow: 1_050_000, inputFormat: { supportsImage: true } },
      optionSpecs: { reasoningLevel: { values: ["low", "high"] } },
    }),
    {
      contextWindowValue: "1050000",
      reasoningLevelValuesValue: ["low", "high"],
      inputFormatValue: {
        supportsText: true,
        supportsImage: true,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },
    },
  );
});

const MODEL_ID = "cst/claude/claude-sonnet-5-5";

function committableModel(
  personalConfig: ProviderSettingsFormModel["personalConfig"] = {},
): ProviderSettingsFormModel {
  const inherited = {
    enabled: true,
    properties: { contextWindow: 200_000, inputFormat: { supportsText: true } },
    optionSpecs: {
      maxOutputTokens: { max: 32_000 },
      reasoningLevel: {
        values: ["low", "high"],
        map: '{"reasoning_effort": reasoningLevel}',
      },
    },
  };
  return {
    kind: "candidate",
    modelId: MODEL_ID,
    builtin: false,
    config: { ...inherited, ...personalConfig },
    inheritedConfig: inherited,
    personalConfig,
    useRecommendedConfig: true,
    hasPersonalConfig: Object.keys(personalConfig).length > 0,
    executable: true,
    selectable: true,
  } as unknown as ProviderSettingsFormModel;
}

function commitDraft(
  model: ProviderSettingsFormModel,
  patch: Partial<ReturnType<typeof createProviderModelDraftValues>>,
) {
  return resolveProviderModelDraftCommit({
    currentModel: model,
    draft: { ...createProviderModelDraftValues(model), ...patch },
  });
}

test("draft commit stores a trimmed model name and leaves the model ID untouched", () => {
  const result = commitDraft(committableModel(), { nameValue: "  sonnet-5-5 " });
  assert.equal(result.status, "commit");
  if (result.status !== "commit") return;
  assert.equal(result.model.modelId, MODEL_ID);
  assert.equal(result.model.personalConfig.name, "sonnet-5-5");
  assert.equal(result.model.config.name, "sonnet-5-5");
});

test("draft commit removes the model name when the input is cleared", () => {
  const model = committableModel({ name: "sonnet-5-5" });
  assert.equal(createProviderModelDraftValues(model).nameValue, "sonnet-5-5");
  const result = commitDraft(model, { nameValue: "   " });
  assert.equal(result.status, "commit");
  if (result.status !== "commit") return;
  assert.equal("name" in result.model.personalConfig, false);
  assert.equal(result.model.config.name, undefined);
});

test("draft commit rejects an over-long model name", () => {
  const result = commitDraft(committableModel(), { nameValue: "x".repeat(65) });
  assert.deepEqual(result, { status: "invalid", field: "name" });
});

test("model name is kept when the model switches to fixed config and on restore", () => {
  const model = committableModel({ name: "sonnet-5-5" });
  const fixed = commitDraft(model, {
    useRecommendedConfigValue: false,
    contextWindowValue: "200000",
    maxOutputTokensValue: "32000",
    reasoningLevelMapValue: '{"reasoning_effort": reasoningLevel}',
  });
  assert.equal(fixed.status, "commit");
  if (fixed.status === "commit") assert.equal(fixed.model.personalConfig.name, "sonnet-5-5");

  const restored = restoreModelDraft(
    { ...createProviderModelDraftValues(model), nameValue: "typed-but-unsaved" },
    model,
  );
  assert.equal(restored.nameValue, "typed-but-unsaved");
});

test("picker items show the model name but keep the model ID as the value", () => {
  const view = {
    revision: 1,
    providers: [
      {
        providerId: "magpie",
        providerName: "magpie",
        config: { api: { type: "anthropic", baseUrl: "https://example.test" } },
        models: [
          { modelId: MODEL_ID, config: { name: "sonnet-5-5" } },
          { modelId: "plain-model", config: {} },
        ],
      },
    ],
  } as unknown as ModelSelectionView;
  const [group] = buildRegistryModelSelectGroups(NEX_AGENT_PROVIDER, view);
  const [aliased, plain] = group!.items;
  assert.equal(aliased!.name, "sonnet-5-5");
  assert.equal(plain!.name, "plain-model");
  assert.deepEqual(decodeCustomModelValue(aliased!.value), {
    providerId: "magpie",
    modelName: MODEL_ID,
  });
});
