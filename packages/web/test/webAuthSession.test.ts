import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLoginUrl,
  decideWebAuthGate,
  fetchWebAuthSession,
  resolveWebAuthAfterDisconnect,
  sanitizeNextPath,
  stripTokenParam,
  submitWebLogin,
} from "../src/webAuthSession.js";

test("sanitizeNextPath keeps same-origin relative paths", () => {
  assert.equal(sanitizeNextPath("/"), "/");
  assert.equal(sanitizeNextPath("/tasks/1?x=1#h"), "/tasks/1?x=1#h");
});

test("sanitizeNextPath rejects open-redirect shapes", () => {
  for (const value of [
    "//evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/\\evil.example",
    "/ok\nSet-Cookie: x=1",
    "",
    null,
    undefined,
    "relative/path",
  ]) {
    assert.equal(sanitizeNextPath(value), "/", String(value));
  }
});

test("sanitizeNextPath never lands back on the login page", () => {
  assert.equal(sanitizeNextPath("/login"), "/");
  assert.equal(sanitizeNextPath("/login?next=%2F"), "/");
});

test("stripTokenParam removes only token", () => {
  assert.equal(stripTokenParam("?token=abc"), "");
  assert.equal(stripTokenParam("?a=1&token=abc&b=2"), "?a=1&b=2");
  assert.equal(stripTokenParam("?a=1"), "?a=1");
  assert.equal(stripTokenParam(""), "");
});

test("buildLoginUrl carries the original location but never the token", () => {
  assert.equal(buildLoginUrl({ pathname: "/", search: "", hash: "" }), "/login");
  assert.equal(
    buildLoginUrl({ pathname: "/tasks/1", search: "?a=1&token=secret", hash: "#x" }),
    `/login?next=${encodeURIComponent("/tasks/1?a=1#x")}`,
  );
});

test("decideWebAuthGate redirects only when auth is required and missing", () => {
  const here = { pathname: "/a", search: "", hash: "" };
  assert.deepEqual(decideWebAuthGate({ authRequired: true, authenticated: false }, here), {
    kind: "redirect",
    to: "/login?next=%2Fa",
  });
  assert.deepEqual(decideWebAuthGate({ authRequired: true, authenticated: true }, here), {
    kind: "proceed",
  });
  assert.deepEqual(decideWebAuthGate({ authRequired: false, authenticated: true }, here), {
    kind: "proceed",
  });
  assert.deepEqual(decideWebAuthGate(null, here), { kind: "proceed" });
});

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test("fetchWebAuthSession parses the response and tolerates failures", async () => {
  assert.deepEqual(
    await fetchWebAuthSession(async () =>
      response(200, { authRequired: true, authenticated: false }),
    ),
    { authRequired: true, authenticated: false },
  );
  assert.equal(await fetchWebAuthSession(async () => response(500, {})), null);
  assert.equal(await fetchWebAuthSession(async () => response(200, { nope: 1 })), null);
  assert.equal(
    await fetchWebAuthSession(async () => {
      throw new Error("offline");
    }),
    null,
  );
});

test("submitWebLogin maps status codes", async () => {
  assert.deepEqual(await submitWebLogin("t", async () => response(200, { ok: true })), {
    kind: "ok",
  });
  assert.deepEqual(await submitWebLogin("t", async () => response(401, {})), { kind: "invalid" });
  assert.deepEqual(
    await submitWebLogin("t", async () => response(429, {}, { "retry-after": "42" })),
    { kind: "rateLimited", retryAfterSeconds: 42 },
  );
  assert.deepEqual(await submitWebLogin("t", async () => response(500, {})), { kind: "error" });
  assert.deepEqual(
    await submitWebLogin("t", async () => {
      throw new Error("offline");
    }),
    { kind: "error" },
  );
});

test("submitWebLogin posts the token as JSON", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  await submitWebLogin("abc", async (url, init) => {
    seen = { url, ...(init ? { init } : {}) };
    return response(200, { ok: true });
  });
  assert.equal(seen?.url, "/api/auth/login");
  assert.equal(seen?.init?.method, "POST");
  assert.equal(seen?.init?.body, JSON.stringify({ token: "abc" }));
});

test("resolveWebAuthAfterDisconnect keeps checking while the server is down", async () => {
  const answers = [null, null, { authRequired: true, authenticated: false }];
  const slept: number[] = [];
  const session = await resolveWebAuthAfterDisconnect({
    fetchSession: async () => answers.shift() ?? null,
    sleep: async (ms) => {
      slept.push(ms);
    },
    delaysMs: [10, 20, 30],
  });
  assert.deepEqual(session, { authRequired: true, authenticated: false });
  assert.deepEqual(slept, [10, 20]);
});

test("resolveWebAuthAfterDisconnect gives up after the last delay", async () => {
  let calls = 0;
  const session = await resolveWebAuthAfterDisconnect({
    fetchSession: async () => {
      calls += 1;
      return null;
    },
    sleep: async () => undefined,
    delaysMs: [1, 1],
  });
  assert.equal(session, null);
  assert.equal(calls, 3);
});
