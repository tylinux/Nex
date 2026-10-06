import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@nex/shared/nex-protocol-v4";
import { derivePetState, petStateToAnimation } from "../src/pets/petStateMachine.js";

function makeSession(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: "s1",
    workspaceId: "w1",
    title: "t",
    phase: "completedSuccess",
    sessionEnded: false,
    hasBackgroundWork: false,
    lastActivityAt: 0,
    createdAt: 0,
    ...overrides,
  };
}

test("空会话列表 → idle", () => {
  const result = derivePetState({
    sessions: [],
    now: 1000,
    previous: null,
    lastSeenActivityAt: 0,
  });
  assert.equal(result.state, "idle");
});

test("运行中会话 → running", () => {
  const result = derivePetState({
    sessions: [makeSession({ phase: "running" })],
    now: 1000,
    previous: null,
    lastSeenActivityAt: 0,
  });
  assert.equal(result.state, "running");
});

test("待处理审批 → waiting（最高优先级）", () => {
  const result = derivePetState({
    sessions: [
      makeSession({ phase: "running" }),
      makeSession({
        sessionId: "s2",
        phase: "running",
        pendingInteraction: { interactionId: "i1", kind: "permission" },
      }),
    ],
    now: 1000,
    previous: null,
    lastSeenActivityAt: 0,
  });
  assert.equal(result.state, "waiting");
});

test("错误会话 → failed", () => {
  const result = derivePetState({
    sessions: [makeSession({ phase: "error" })],
    now: 1000,
    previous: null,
    lastSeenActivityAt: 0,
  });
  assert.equal(result.state, "failed");
});

test("完成且未读 → review；已读 → idle", () => {
  const unread = derivePetState({
    sessions: [makeSession({ phase: "completedSuccess", lastActivityAt: 2000 })],
    now: 3000,
    previous: null,
    lastSeenActivityAt: 1000,
  });
  assert.equal(unread.state, "review");

  const seen = derivePetState({
    sessions: [makeSession({ phase: "completedSuccess", lastActivityAt: 2000 })],
    now: 3000,
    previous: null,
    lastSeenActivityAt: 2000,
  });
  assert.equal(seen.state, "idle");
});

test("优先级：waiting > failed > review > running", () => {
  const result = derivePetState({
    sessions: [
      makeSession({ sessionId: "a", phase: "error" }),
      makeSession({
        sessionId: "b",
        phase: "running",
        pendingInteraction: { interactionId: "i", kind: "userInput" },
      }),
    ],
    now: 1000,
    previous: null,
    lastSeenActivityAt: 0,
  });
  assert.equal(result.state, "waiting");
});

test("running 超过 3 分钟回落 idle", () => {
  const enteredAt = 1_000_000;
  const previous = { state: "running" as const, since: enteredAt };
  const result = derivePetState({
    sessions: [makeSession({ phase: "running" })],
    now: enteredAt + 3 * 60 * 1000 + 1,
    previous,
    lastSeenActivityAt: 0,
  });
  assert.equal(result.state, "idle");
});

test("同状态延续不重置计时", () => {
  const enteredAt = 1_000_000;
  const previous = { state: "running" as const, since: enteredAt };
  const result = derivePetState({
    sessions: [makeSession({ phase: "running" })],
    now: enteredAt + 60_000,
    previous,
    lastSeenActivityAt: 0,
  });
  assert.equal(result.state, "running");
  assert.equal(result.since, enteredAt);
});

test("sessionEnded 的会话不参与推导", () => {
  const result = derivePetState({
    sessions: [makeSession({ phase: "running", sessionEnded: true })],
    now: 1000,
    previous: null,
    lastSeenActivityAt: 0,
  });
  assert.equal(result.state, "idle");
});

test("petStateToAnimation 映射完整", () => {
  assert.equal(petStateToAnimation("idle"), "idle");
  assert.equal(petStateToAnimation("running"), "running");
  assert.equal(petStateToAnimation("waiting"), "waiting");
  assert.equal(petStateToAnimation("review"), "review");
  assert.equal(petStateToAnimation("failed"), "failed");
});
