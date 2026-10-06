import assert from "node:assert/strict";
import test from "node:test";
import { querySessionSystemPrompt } from "../src/nex-protocol/session-system-prompt.js";
import type { NexProtocolAgentServerContext } from "../src/nex-protocol/server-types.js";

function contextWith(sessions: Record<string, unknown[]>): NexProtocolAgentServerContext {
  const map = new Map(
    Object.entries(sessions).map(([id, sections]) => [
      id,
      { app: { runtime: { getSystemPromptSections: () => sections } } },
    ]),
  );
  return { sessions: map, deps: {} } as unknown as NexProtocolAgentServerContext;
}

test("returns the runtime sections without the bookkeeping fields", () => {
  const context = contextWith({
    s1: [
      {
        name: "Identity",
        source: "identity",
        cacheHint: "stable",
        injectionTarget: "system",
        chars: 4,
        tokens: 1,
        content: "text",
        preview: "text",
      },
    ],
  });
  assert.deepEqual(querySessionSystemPrompt(context, { sessionId: "s1" }), {
    sessionId: "s1",
    sections: [{ name: "Identity", source: "identity", cacheHint: "stable", content: "text" }],
  });
});

test("rejects unknown params and unknown sessions", () => {
  const context = contextWith({});
  assert.throws(() => querySessionSystemPrompt(context, { sessionId: "" }));
  assert.throws(() => querySessionSystemPrompt(context, { sessionId: "s", extra: 1 }));
  assert.throws(() => querySessionSystemPrompt(context, { sessionId: "missing" }));
});
