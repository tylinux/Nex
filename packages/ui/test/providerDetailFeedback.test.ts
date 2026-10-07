import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderDetailFeedbackBoundary } from "../src/settings/model-provider-section/ProviderDetailFeedback.js";

test("same feedback key updates in place instead of stacking two items", () => {
  const items = new Map<string, string>();
  const key = "models-add:new-provider";
  items.set(key, "正在向 new-provider 添加 3 个模型");
  items.set(key, "已向 new-provider 添加 3 个模型");
  assert.equal(items.size, 1);
  assert.equal([...items.values()][0], "已向 new-provider 添加 3 个模型");
});

test("per-model save notifications keep distinct keys", () => {
  const keys = ["model-save:p:a", "model-save:p:b", "model-save:p:c"];
  assert.equal(new Set(keys).size, 3);
});

test("feedback boundary renders one element per key with its state attribute", () => {
  const html = renderToStaticMarkup(
    createElement(ProviderDetailFeedbackBoundary, null, createElement("div", null, "content")),
  );
  assert.match(html, /data-testid="provider-detail-feedback-viewport"/);
  // 空栈时不渲染任何条目。
  assert.equal(html.includes("data-provider-detail-feedback-state"), false);
});
