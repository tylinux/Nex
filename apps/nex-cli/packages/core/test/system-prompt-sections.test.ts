import assert from "node:assert/strict";
import test from "node:test";
import { getSystemPromptSections } from "../src/runtime/methods/config.js";
import type { ContextSection } from "../src/context/types.js";
import type { AgentRuntimeInternal } from "../src/runtime/internal.js";

function section(overrides: Partial<ContextSection>): ContextSection {
  return {
    name: "Section",
    source: "identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: 1,
    tokens: 1,
    content: "body",
    preview: "body",
    ...overrides,
  };
}

function runtimeWith(sections: ContextSection[] | undefined): AgentRuntimeInternal {
  return {
    latestContextBuildResult: sections && {
      sections,
      totalChars: 0,
      totalTokens: 0,
      systemMessages: [],
      metaUserAttachments: [],
    },
  } as unknown as AgentRuntimeInternal;
}

test("returns an empty list before the first context build", () => {
  assert.deepEqual(getSystemPromptSections.call(runtimeWith(undefined)), []);
});

test("keeps only system-target sections and drops skills and tools", () => {
  const sections = [
    section({ name: "Identity", source: "identity" }),
    section({ name: "Env", source: "env_info" }),
    section({ name: "Skills", source: "skills" }),
    section({ name: "Tools", source: "tools" }),
    section({ name: "Meta", source: "memory", injectionTarget: "meta_user" }),
  ];
  const result = getSystemPromptSections.call(runtimeWith(sections));
  assert.deepEqual(
    result.map((s) => s.name),
    ["Identity", "Env"],
  );
});
