import assert from "node:assert/strict";
import test from "node:test";
import { querySessionPromptContext } from "../src/nex-protocol/session-prompt-context.js";
import type { NexProtocolAgentServerContext } from "../src/nex-protocol/server-types.js";

function contextWith(sessions: Record<string, unknown[]>): NexProtocolAgentServerContext {
  const map = new Map(
    Object.entries(sessions).map(([id, entries]) => [
      id,
      { app: { runtime: { getPromptContextEntries: () => entries } } },
    ]),
  );
  return { sessions: map, deps: {} } as unknown as NexProtocolAgentServerContext;
}

test("returns the runtime entries for a live session", () => {
  const entry = { category: "skills", name: "Skills", source: "skills", content: "text" };
  assert.deepEqual(querySessionPromptContext(contextWith({ s1: [entry] }), { sessionId: "s1" }), {
    sessionId: "s1",
    entries: [entry],
  });
});

test("rejects unknown params and unknown sessions", () => {
  const context = contextWith({});
  assert.throws(() => querySessionPromptContext(context, { sessionId: "" }));
  assert.throws(() => querySessionPromptContext(context, { sessionId: "s", extra: 1 }));
  assert.throws(() => querySessionPromptContext(context, { sessionId: "missing" }));
});
