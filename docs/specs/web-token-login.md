# Web token login

Status: implementing. Scope: `packages/server` (HTTP entry) and `packages/web`.

## Problem

When `NEX_SERVER_AUTH_TOKEN` is set, `/api/*` and `/ws` answer `401` unless the request carries the
raw token (`?token=` or the `nex_lite_token` cookie, whose value **is** the raw token). A browser
without the cookie sees a half-working page: the static shell loads, the WebSocket fails, and the
user gets a generic "Web bootstrap failed" screen with no way to authenticate except hand-editing
the URL.

## Product rules

1. If auth is not configured (`NEX_SERVER_AUTH_TOKEN` empty) nothing changes: no login page.
2. If auth is configured and the browser has no valid session, the web app redirects to
   `/login?next=<original path+query>`.
3. `/login` has one field: the access token. Submitting a correct token creates a session and
   navigates to `next` (default `/`). A wrong token shows an inline error and stays on the page.
4. A session that disappears while the app is open (expired, server token rotated, sessions file
   deleted) sends the user back to `/login` instead of leaving a dead UI.
5. Opening `/login` while already authenticated, or when auth is not required, goes to `next`/`/`.
6. `next` is only honoured when it is a same-origin relative path (`/…`, not `//…`, no scheme).

## State owners

| State                      | Owner                                           | Readers                      |
| -------------------------- | ----------------------------------------------- | ---------------------------- |
| Configured access token    | environment `NEX_SERVER_AUTH_TOKEN` (unchanged) | `webAuth` only               |
| Sessions                   | `webAuth` session store → `web-sessions.json`   | HTTP middleware, auth routes |
| "Am I logged in" in the UI | `GET /api/auth/session` response                | web bootstrap, login page    |

The browser never stores the token. The cookie holds only a random session id.

## Session store (config file)

- File: `<appConfigDir>/web-sessions.json` (`getAppConfigDir()`), created with mode `0600`,
  written atomically (temp file + rename), async IO only.
- Shape: `{ version: 1, tokenFingerprint: string, sessions: [{ idHash, createdAt, expiresAt }] }`.
  - `idHash` = `sha256(sessionId)`; the session id itself is never written to disk, so a leaked
    file cannot be replayed as a cookie.
  - `tokenFingerprint` = `sha256("nex-web-session:" + token)`. When the configured token changes
    the stored fingerprint no longer matches, and every stored session is discarded on load.
- Session id: 32 random bytes, base64url. Lifetime: 30 days from creation (absolute, no sliding
  renewal). Expired entries are pruned on load and on every write.
- A missing, unreadable, or corrupt file is treated as "no sessions" (fail closed), never as an
  error that disables auth.

## HTTP interface

All under the existing server; none of these paths require a session except where noted.

| Method | Path                | Behaviour                                                                                                         |
| ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/auth/session` | `{ authRequired, authenticated }`. Always 200. Not behind the auth middleware.                                    |
| POST   | `/api/auth/login`   | Body `{ token }`. 200 + `Set-Cookie` on success; 401 on mismatch; 429 when rate limited; 400 on a malformed body. |
| POST   | `/api/auth/logout`  | Deletes the current session, clears the cookie. Always 200.                                                       |

Protected paths remain `/ws`, `/ws/*`, `/api/*` (except `/api/auth/*` above). A request is
authenticated when it has a valid session cookie **or** a correct `?token=` query value.

`?token=` compatibility: programmatic clients (`packages/rpc` remote connections) keep passing
`?token=` on `/ws`. On any non-`/ws` request a correct `?token=` also mints a session and sets the
cookie, so the documented `http://host:3030/?token=…` first visit still works. The web client then
removes `token` from the address bar.

The old `nex_lite_token` cookie (raw token) is no longer accepted. Existing browsers see the login
page once.

Cookie: `nex_session=<id>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`, plus `Secure` when
the request is HTTPS (URL scheme or `X-Forwarded-Proto: https`).

Token comparison hashes both sides with SHA-256 and uses `timingSafeEqual`.

### Failure semantics

- Login rate limit, per remote address: 5 failed attempts lock that address for 60 seconds
  (`429`, `Retry-After`). A success clears the counter. State is in memory only and is bounded
  (stale entries are dropped).
- Failed session-file writes on login return `500`; the session is not considered created unless
  the write succeeded.
- Failed session-file writes on logout or pruning are logged and do not block the response.

## Event order

```text
browser                           server                         web-sessions.json
  │ GET /dashboard  ───────────────▶ static shell (unprotected)
  │ GET /api/auth/session ─────────▶ authRequired, not authenticated
  │ location.replace(/login?next=/dashboard)
  │ POST /api/auth/login {token} ──▶ verify ─ ok ─▶ create session ─────▶ write (atomic)
  │ ◀── 200 + Set-Cookie nex_session ◀────────────── persisted first, then respond
  │ location.replace(next)
  │ GET /api/auth/session ─────────▶ authenticated
  │ WS /ws (cookie) ───────────────▶ upgrade
```

Expiry while open: when an open WebSocket closes, the client asks `/api/auth/session`. The
server may be mid-restart (for example a token rotation), so an unreachable endpoint is retried
with backoff (1, 2, 4, 8, 15, 30 seconds; about one minute in total) until the server answers.
If it reports `authenticated: false` the client redirects to `/login?next=…`; if it reports
`authenticated: true`, or never answers, the existing close handling is unchanged (network blips
do not bounce the user to the login page). Only a socket that had opened starts this watcher;
a failed initial connection is handled by the bootstrap error path.

If `/api/auth/session` itself cannot be reached at bootstrap, the client falls through to the
existing bootstrap path and error screen (fail open for UI only; the server still enforces auth).

## Not in scope

- Multi-user accounts, token rotation UI, "log out" button in the app shell (the endpoint exists).
- Changing how the token is provisioned (`install.sh`, plist, docker-compose, `NEX_SERVER_AUTH_TOKEN`).
- Desktop app and `nex --web` local mode (no token / separate entry).

## Acceptance

1. Auth configured, no cookie: opening `/` lands on `/login?next=%2F`; wrong token shows an error;
   correct token loads the app at `/`.
2. Reload after login: stays logged in. Restart the server: still logged in (sessions persisted).
3. Change `NEX_SERVER_AUTH_TOKEN` and restart: the old session is rejected and the user is sent to
   `/login`.
4. `curl /api/server-info` without a session: `401`; with `?token=<token>`: `200`.
5. `?token=<token>` on `/` sets a session cookie and the address bar loses `token`.
6. Six wrong logins from one address in a minute: the sixth gets `429`.
7. `next=//evil.example` and `next=https://evil.example` are ignored (go to `/`).
8. Auth not configured: `/login` redirects to `/`; no extra requests block startup.
