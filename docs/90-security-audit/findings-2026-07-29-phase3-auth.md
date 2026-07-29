# Phase 3 Findings — Auth & Session Integrity (2026-07-29)

Scope executed: `src/db/users.ts`, `src/routes/auth.ts`, `src/middleware/authMiddleware.ts`, `src/middleware/apiTokenMiddleware.ts`, `src/db/api_tokens.ts`, `src/routes/v1.ts`, `src/index.ts` (AI/full-text/synthesis scope gates), client cookie-setting code (`app.html`, `chat.html`, `notes.html`, `settings.html`, `header.ts`). Per [review-plan.md](review-plan.md) Phase 3.

## Summary

Two structural findings stand out — **the primary session token never expires and cannot be revoked/rotated by the user**, and **the session cookie is set entirely client-side and therefore can never be `HttpOnly`**. Both are pre-existing, apparently intentional design choices (the README already documents the "no forgot-token flow" tradeoff), but they matter more now given the goal of storing health/financial documents, so they're written up here as concrete, actionable recommendations rather than silently patched — both touch the core login/session model and (for the cookie issue) multiple client files, so I'd rather confirm the approach with you before changing how login works. Everything else checked out clean: API token scopes are consistently enforced, DB-indexed token lookups don't need constant-time comparison, and API tokens themselves already have proper expiry/rotation/revocation.

---

## Findings requiring a decision (not yet implemented)

### 1. [High] Primary session token has no expiry and no revocation mechanism

**Files:** [schema.sql](../../schema.sql#L8-L23) (`users.token_hash`), [users.ts](../../src/db/users.ts#L5-L15), [auth.ts](../../src/routes/auth.ts)

The entire session model is one `token_hash` column per user, set once at `POST /api/auth/register` and never expiring. `getUserByTokenHash()` has no expiry check (contrast with `getApiTokenByHash()` in `api_tokens.ts`, which correctly checks `expires_at`). There is no logout-on-server, no rotate, no revoke — "Sign Out" (client-side) only clears the cookie; the token itself remains valid forever. The only way to invalidate a compromised token today is deleting the user's row entirely.

This matters because the app's own onboarding flow (the "magic login link") **is** the raw token, shared as a URL — README already states: *"There is no 'forgot token' flow, no email reset, and no recovery option. The token is your key."* That's a reasonable tradeoff for a personal bookmarking tool; it's a bigger deal once the same account gates health/financial documents, because there's currently no remediation path if that link is ever leaked (synced browser history, shared clipboard, screenshot, accidental paste) — it stays valid indefinitely.

**Recommended fix** (already scoped out informally in [docs/01-concepts/_z rotate user session.md](../01-concepts/_z%20rotate%20user%20session.md)): a `POST /api/auth/reset-token` endpoint, authenticated with the *current* token, that runs `UPDATE users SET token_hash = ? WHERE id = ?` and returns the new raw token once — mirroring the existing API-token rotate pattern in `v1.ts`. **No schema migration needed** (reuses the existing column). This gives you a real "I think my link leaked, kill it" button.

I did not implement this without checking in first — it changes the core login/session model (any previously-copied login link stops working after a reset) and this app has no staging environment (`bun run deploy` goes straight to production per `AGENTS.md`). **Want me to build this now?** It's a contained, additive change (new route + a "Reset Login Token" button next to the existing "Copy Login Link" in settings.html).

### 2. [Medium] Session cookie is set client-side only, so it can never be `HttpOnly`

**Files:** [app.html:1553](../../src/client/app.html#L1553), [header.ts:236](../../src/utils/header.ts#L236), plus `chat.html`, `notes.html`, `settings.html` (all do `document.cookie = 'd11_auth=...'`)

Every place the `d11_auth` cookie is set or cleared does it via client-side `document.cookie = ...`, never via a server `Set-Cookie` response header. `Secure` and `SameSite=Lax` are correctly present, but `HttpOnly` is impossible to set this way by design of the `document.cookie` API — meaning **the session token is readable by any JavaScript running on the page**. This is very likely intentional: several pages (e.g., `import-browser.html`) read the cookie back out via JS specifically to attach it as an `Authorization: Bearer` header for their own fetches. But the practical consequence is that a single XSS bug anywhere in this sizeable, multi-file inline-script client codebase would be a full account takeover (session theft), with no `HttpOnly` backstop.

**This is a design tradeoff, not a simple bug**, so I'm flagging it rather than changing it unilaterally. Two paths forward, in increasing effort, if you want to harden this later:
- **Low effort:** keep the token-in-JS pattern (needed for the cross-origin import-browser use case) but treat it as an accepted risk, and prioritize XSS-prevention elsewhere (this review's Phase 1/2 fixes already closed the one concrete stored-XSS vector found in Drive uploads).
- **Higher effort:** have the magic-link route redeem the token server-side (`GET /l/login?t=...` → validates → responds with `Set-Cookie: d11_auth=...; HttpOnly` → redirects without the token in the visible URL) for the *browser session* cookie specifically, while leaving the separate Bearer-token flows (browser extension import, etc.) as-is using `Authorization` headers instead of reading the cookie. This is a genuine login-flow change across multiple files — let me know if you'd like this scoped out as a separate piece of work.

No code changed for this finding — flagged for your decision.

---

## Verified safe — no change needed

### 3. [Verified safe] `hashToken` lookup doesn't need `timingSafeEqual`

`authMiddleware`/`apiTokenMiddleware` hash the incoming bearer token (SHA-256) and look it up via `WHERE token_hash = ?` — a D1-indexed equality lookup, not a byte-by-byte comparison in application code. The class of timing attack `timingSafeEqual` defends against (a hand-rolled `===` comparing two secret strings character-by-character) doesn't apply to an indexed DB query. Contrast with `attachmentTokens.ts`'s HMAC signature verification, which correctly *does* use `timingSafeEqual` because that's exactly the vulnerable pattern. No fix needed.

### 4. [Verified safe] API token scope enforcement is consistent and complete

Checked every scoped route group:
- `/api/v1/posts*`, `/api/v1/tags` — `hasScope(apiToken, 'posts:read'|'posts:write'|'tags:read')` checked on every handler.
- `/api/ai/*` — `parseAiAllowed()` gates per-source (`rss`/`bookmarks`/`files`) against `ai:process:rss`/`ai:process:bookmarks`/`ai:process:files`, with the legacy `ai:process` scope granting all three. Checked on both `GET /api/ai/queue` and `PATCH /api/ai/items`, including a second per-item check inside the batch loop (`if (source === 'rss' && !allowed.rss) ...`) so a token can't smuggle a disallowed source through the batch endpoint.
- `/api/ft/*` — `hasFtScope()` requires `fulltext:process` or `*`, checked on both `queue` and `items` endpoints.
- `/api/synthesis/*` — `hasSynthesisScope()` requires `synthesis:process` or `*`, checked on both endpoints.
- `/api/v1/tokens*` (mint/list/rotate/revoke API tokens) correctly uses `authMiddleware` (main session), **not** `apiTokenMiddleware` — an API token can never mint another API token, matching the documented convention in `AGENTS.md`.

No gaps found; a token scoped to only e.g. `posts:read` cannot reach AI/full-text/synthesis processing endpoints or token management.

### 5. [Verified safe / good design] API tokens already have proper lifecycle controls

`api_tokens` supports optional `expires_at` (enforced in `getApiTokenByHash`), a per-user limit (10, admin-exempt), and self-service `rotate` (`POST /api/v1/tokens/:id/rotate` — deletes the old token and mints a replacement with the same name/scopes) and `revoke` (`DELETE /api/v1/tokens/:id`). This is the pattern finding #1 recommends extending to the primary session token.

---

## Next

Phase 4 (CORS/Transport) is next in the suggested order, or I can implement the Phase 3 #1 fix (reset-token endpoint) first if you'd like — your call.
