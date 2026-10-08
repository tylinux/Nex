import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import {
  createLoginRateLimiter,
  createWebAuth,
  createWebSessionStore,
  isTokenProtectedPath,
} from "../src/webAuth.js";

const TOKEN = "correct-horse-battery-staple";

function createApp(
  options: { sessionsFilePath?: string; now?: () => number; token?: string } = {},
) {
  const app = new Hono();
  const auth = createWebAuth({
    token: "token" in options ? options.token : TOKEN,
    ...(options.sessionsFilePath ? { sessionsFilePath: options.sessionsFilePath } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  if (auth.enabled) app.use("*", auth.middleware());
  auth.mountRoutes(app);
  app.get("/api/server-info", (c) => c.json({ ok: true }));
  app.get("/ws", (c) => c.text("ws"));
  app.get("*", (c) => c.text("page"));
  return app;
}

function login(app: Hono, token: string) {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] ?? "";
}

test("protected paths exclude /api/auth/*", () => {
  assert.equal(isTokenProtectedPath("/api/server-info"), true);
  assert.equal(isTokenProtectedPath("/ws"), true);
  assert.equal(isTokenProtectedPath("/ws/host"), true);
  assert.equal(isTokenProtectedPath("/api/auth/login"), false);
  assert.equal(isTokenProtectedPath("/api/auth/session"), false);
  assert.equal(isTokenProtectedPath("/login"), false);
  assert.equal(isTokenProtectedPath("/"), false);
});

test("without a session /api and /ws are 401 while pages stay public", async () => {
  const app = createApp();
  assert.equal((await app.request("/api/server-info")).status, 401);
  assert.equal((await app.request("/ws")).status, 401);
  assert.equal((await app.request("/")).status, 200);
  assert.equal((await app.request("/login")).status, 200);
});

test("session endpoint reports authRequired and authenticated", async () => {
  const app = createApp();
  assert.deepEqual(await (await app.request("/api/auth/session")).json(), {
    authRequired: true,
    authenticated: false,
  });
  const cookie = cookieFrom(await login(app, TOKEN));
  const after = await app.request("/api/auth/session", { headers: { cookie } });
  assert.deepEqual(await after.json(), { authRequired: true, authenticated: true });
});

test("session endpoint with auth disabled reports authenticated and login is 404", async () => {
  const app = createApp({ token: "" });
  assert.deepEqual(await (await app.request("/api/auth/session")).json(), {
    authRequired: false,
    authenticated: true,
  });
  assert.equal((await login(app, "anything")).status, 404);
  assert.equal((await app.request("/api/server-info")).status, 200);
});

test("correct token logs in and the cookie unlocks protected paths", async () => {
  const app = createApp();
  const response = await login(app, TOKEN);
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^nex_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.doesNotMatch(setCookie, /Secure/);
  assert.equal(setCookie.includes(TOKEN), false, "cookie must not contain the raw token");
  const cookie = cookieFrom(response);
  assert.equal((await app.request("/api/server-info", { headers: { cookie } })).status, 200);
});

test("cookie is Secure behind an https proxy", async () => {
  const app = createApp();
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.match(response.headers.get("set-cookie") ?? "", /Secure/);
});

test("wrong token is rejected without a cookie", async () => {
  const app = createApp();
  const response = await login(app, "nope");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("malformed login bodies are 400", async () => {
  const app = createApp();
  const notJson = await app.request("/api/auth/login", { method: "POST", body: "{" });
  assert.equal(notJson.status, 400);
  assert.equal((await login(app, "")).status, 400);
});

test("the old raw-token cookie is no longer accepted", async () => {
  const app = createApp();
  const response = await app.request("/api/server-info", {
    headers: { cookie: `nex_lite_token=${TOKEN}` },
  });
  assert.equal(response.status, 401);
});

test("?token= keeps working for programmatic /ws and /api clients without minting sessions", async () => {
  const app = createApp();
  const ws = await app.request(`/ws?token=${TOKEN}`);
  assert.equal(ws.status, 200);
  assert.equal(ws.headers.get("set-cookie"), null);
  const api = await app.request(`/api/server-info?token=${TOKEN}`);
  assert.equal(api.status, 200);
  assert.equal(api.headers.get("set-cookie"), null);
  assert.equal((await app.request("/api/server-info?token=wrong")).status, 401);
});

test("?token= on a page request mints a session cookie", async () => {
  const app = createApp();
  const response = await app.request(`/?token=${TOKEN}`);
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  assert.match(cookie, /^nex_session=/);
  assert.equal((await app.request("/api/server-info", { headers: { cookie } })).status, 200);
});

test("logout revokes the session and clears the cookie", async () => {
  const app = createApp();
  const cookie = cookieFrom(await login(app, TOKEN));
  const response = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal((await app.request("/api/server-info", { headers: { cookie } })).status, 401);
});

test("six wrong logins lock the address with 429 and Retry-After", async () => {
  let current = 1_000_000;
  const app = createApp({ now: () => current });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await login(app, "wrong")).status, 401);
  }
  const locked = await login(app, "wrong");
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get("retry-after")) > 0);
  // 锁定期间连正确 token 也不放行，否则限流可被绕过。
  assert.equal((await login(app, TOKEN)).status, 429);
  current += 61_000;
  assert.equal((await login(app, TOKEN)).status, 200);
});

test("rate limiter counts again after the lock expires", () => {
  let current = 0;
  const limiter = createLoginRateLimiter(() => current);
  for (let i = 0; i < 5; i += 1) limiter.recordFailure("a");
  assert.ok(limiter.lockedForMs("a") > 0);
  current += 61_000;
  assert.equal(limiter.lockedForMs("a"), 0);
  limiter.recordFailure("a");
  assert.equal(limiter.lockedForMs("a"), 0);
  limiter.recordSuccess("a");
  assert.equal(limiter.lockedForMs("b"), 0);
});

test("sessions persist across restarts, with a 0600 file that never holds the session id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nex-web-auth-"));
  const filePath = join(dir, "web-sessions.json");
  const first = createApp({ sessionsFilePath: filePath });
  const loginResponse = await login(first, TOKEN);
  const cookie = cookieFrom(loginResponse);
  const sessionId = decodeURIComponent(cookie.split("=")[1] ?? "");

  const raw = await readFile(filePath, "utf8");
  assert.equal(raw.includes(sessionId), false, "session id must not be stored in clear text");
  assert.equal(raw.includes(TOKEN), false, "token must not be stored");
  if (process.platform !== "win32") {
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  }

  const second = createApp({ sessionsFilePath: filePath });
  assert.equal((await second.request("/api/server-info", { headers: { cookie } })).status, 200);
});

test("changing the configured token discards stored sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nex-web-auth-"));
  const filePath = join(dir, "web-sessions.json");
  const cookie = cookieFrom(await login(createApp({ sessionsFilePath: filePath }), TOKEN));
  const rotated = createApp({ sessionsFilePath: filePath, token: "a-different-token" });
  assert.equal((await rotated.request("/api/server-info", { headers: { cookie } })).status, 401);
});

test("a corrupt sessions file fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nex-web-auth-"));
  const filePath = join(dir, "web-sessions.json");
  await writeFile(filePath, "not json");
  const app = createApp({ sessionsFilePath: filePath });
  assert.equal((await app.request("/api/server-info")).status, 401);
  assert.equal((await login(app, TOKEN)).status, 200);
});

test("expired sessions are rejected and pruned", async () => {
  let current = 5_000;
  const store = createWebSessionStore({ token: TOKEN, now: () => current });
  const id = await store.create();
  assert.equal(await store.validate(id), true);
  current += 31 * 24 * 60 * 60 * 1000;
  assert.equal(await store.validate(id), false);
  assert.equal(await store.validate(undefined), false);
});

test("a failed session write does not create a session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nex-web-auth-"));
  // 父路径是普通文件，mkdir 必然失败。
  const blocker = join(dir, "blocker");
  await writeFile(blocker, "x");
  const app = createApp({ sessionsFilePath: join(blocker, "web-sessions.json") });
  const response = await login(app, TOKEN);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("set-cookie"), null);
});
