# Phase 6 Findings — Edge Runtime / Isolate Hygiene (2026-07-29)

Scope executed: module-level mutable state across `src/**/*.ts`, all `waitUntil` fire-and-forget call sites, and R2 response streaming across `drive.ts`/`notes.ts`/`food.ts`. Per [review-plan.md](review-plan.md) Phase 6.

## Summary

Found and fixed a real one: `src/utils/ollama.ts` was logging live Cloudflare Access credentials (`CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`) to `console.log` on every AI chat request — meaning the secret would land in Worker logs (`wrangler tail`, dashboard Logs, or any Logpush destination) in plaintext. Also found and fixed the one genuine module-level mutable-state item (an unbounded in-memory rate-limit map). Everything else — `waitUntil` payloads, R2 streaming — checked out clean.

---

## Fixed

### 1. [High] Cloudflare Access credentials logged in plaintext on every Ollama request

**File:** [ollama.ts](../../src/utils/ollama.ts#L64-L66) (`callOllama`)

```ts
console.log(`Sending request to Ollama: ${JSON.stringify(body)}`)
console.log(`Using Ollama URL: ${env.OLLAMA_URL}`)
console.log(`Using CF Access Client ID: ${env.CF_ACCESS_CLIENT_ID}`)
console.log(`Using CF Access Client Secret: ${env.CF_ACCESS_CLIENT_SECRET}`)
```

This function is called on every `#ai` channel chat message. Every call printed the full `CF_ACCESS_CLIENT_SECRET` (and client ID) straight to `console.log`, which in a Cloudflare Worker is captured by Workers Logs / `wrangler tail` and any configured Logpush destination — effectively broadcasting the credential to anywhere logs are collected or retained, for every single chat message sent. This is a genuine secret-exposure bug (OWASP A09: Security Logging and Monitoring Failures / credential exposure), not a theoretical one — it fires unconditionally, not just in a debug/dev mode.

It also logged the full request body (`JSON.stringify(body)`), which includes the raw prompt text — i.e. whatever the user typed into chat, verbatim, in the logs. Lower severity than the credential leak, but still unnecessary verbosity of user content into logs.

**Fix applied:** removed both credential-logging lines entirely, and replaced the full-body log with just the target URL (`Sending request to Ollama at ${env.OLLAMA_URL}`) — keeps a useful trace line for debugging connectivity issues without printing the prompt body or any secret. Verified with `tsc --noEmit` — no new errors (only the pre-existing, unrelated `chat.ts` error remains).

**Recommendation:** treat `CF_ACCESS_CLIENT_SECRET` as already logged historically if these logs were ever retained/exported — worth rotating that secret via `wrangler secret put` as a precaution, independent of the code fix (I did not rotate it myself since that's a credential-management action for you to perform, not something I can/should do unilaterally).

### 2. [Low] Unbounded in-memory rate-limit map

**File:** [ollama.ts](../../src/utils/ollama.ts#L22-L24) (`userRequestTimestamps`)

The only module-level mutable state found anywhere in `src/` (everything else at module scope is either a stateless `Hono` router instance or an immutable `Set`/`RegExp`/config object). This `Map<string, number[]>` tracks per-user request timestamps for the chat AI rate limiter, but old entries were never evicted — once a user made one Ollama request, their key stayed in the map for the entire lifetime of that isolate (which can be hours), growing without bound as more distinct users hit the `#ai` channel. Not a cross-user data leak (values are just timestamps, keyed correctly by `user.id`), but a real memory-growth / isolate-hygiene issue, and exactly the class of thing this checklist item was looking for.

Two secondary, lower-priority notes (not fixed, out of scope for this pass): the map is isolate-local, so the "rate limit" isn't strictly global — Cloudflare can route a user's requests to a different isolate and reset their count; and `chat.ts:109`'s `checkRateLimit(user.id)` passes a `number` where the signature declares `string` (the pre-existing, unrelated `tsc` error noted throughout this review) — functionally harmless since JS `Map` keys aren't coerced by the type annotation, but worth a type fix on its own at some point.

**Fix applied:** `checkRateLimit` now prunes any other user's key whose entire timestamp window has gone stale on each call, so the map's size is bounded by "users active within the last 60 seconds" rather than "every distinct user ever seen by this isolate." Verified with `tsc --noEmit`.

---

## Verified safe — no change needed

### 3. [Verified safe] `waitUntil` fire-and-forget payloads carry no sensitive data

Checked every `c.executionCtx.waitUntil(...)` / `ctx.waitUntil(...)` call site:
- `index.ts` (`/l/:prefix/:slug`, `/l/:slug`) — `recordClick(db, bookmark.id, referer, userAgent)`: DB id + request headers already visible to any recipient, no secrets.
- `index.ts` (cron) — `ingestAllFeeds(env)`: reads `env` internally for RSS ingestion, no secret handed through the closure beyond what the function already needs to do its job (same trust boundary as the rest of the Worker).
- `apiTokenMiddleware.ts` — `touchApiToken(db, apiToken.id)`: just an id, updates `last_used_at`.
- `chat.ts` — AI response generation: passes chat message content (already persisted in D1 by this point) and channel/user ids, nothing added that wasn't already at rest in the DB.

No fix needed.

### 4. [Verified safe] All R2 object bodies are streamed, never buffered

Every download route in `drive.ts`, `notes.ts`, `food.ts`, and `index.ts`'s AI-daemon download route returns `c.body(object.body)` directly — the R2 `ReadableStream` is piped straight to the client response. Grepped for `.arrayBuffer()`/`.text()`/`.blob()` across `src/` — the only hits are for small, unrelated external fetches (RSS/OG-preview HTML, webhook payloads), never for R2 attachment/drive/food-image bodies. No large file is ever fully buffered into isolate memory before being sent. No fix needed.

---

## Next

Phase 7 (Secrets & Config) is next in the suggested order — and given finding #1 above, it's worth specifically re-checking for any other place a secret might be logged or otherwise echoed while there. Still parked from earlier phases: the session-token reset feature (Phase 3), Drive soft-delete purge policy (Phase 5), and error-message hardening (Phase 5).
