# Lumin Security Review Plan — R2 Storage Focus (Health & Financial Documents)

> Context: `claud-prompt.md`, `security-audit.md`, and `security-audit-2.md` in this folder are **meta-prompts** (advice on how to *ask* an AI to do a security review) — they contain no actual findings yet. This document is the concrete, executable plan for doing that review against the real codebase, with extra weight on R2 (`ATTACHMENTS`, `FOOD_ENTRIES`) since the user intends to store **health and financial documents** there via the Drive/Notes attachment features.

## Goal

Confirm that a Cloudflare Worker + D1 + R2 stack can safely hold sensitive personal documents (health records, financial statements) with no cross-user data exposure, no unauthenticated access path, and no accidental public exposure of the R2 buckets.

## Scope

- `src/routes/drive.ts`, `src/routes/notes.ts`, `src/routes/food.ts` — all upload/download/list paths touching `ATTACHMENTS` / `FOOD_ENTRIES` R2 buckets.
- `src/utils/attachmentTokens.ts` — signed download token generation/verification.
- `src/middleware/authMiddleware.ts`, `src/middleware/apiTokenMiddleware.ts` — session/API auth enforcement.
- `src/utils/auth.ts`, `src/db/users.ts`, `src/db/api_tokens.ts` — token issuance, hashing, expiry.
- `src/index.ts` — CORS config, global bindings, cookie handling, any inline attachment logic.
- `wrangler.toml` + Cloudflare dashboard bucket settings (public access / custom domains — not visible in repo, must verify out-of-band).
- `schema.sql` / `migrations/*.sql` — ownership columns (`user_id`) and constraints on attachment/drive tables.

Out of scope for this pass: RSS/email ingestion, chat/AI enrichment content, admin UI — unless they touch R2.

## Review Phases

### Phase 1 — R2 Access Control (primary focus)
- [ ] Confirm **every** R2 `.get()`/`.put()`/`.delete()` call is preceded by an ownership check (`user_id` match) at the D1 layer, not just "attachment exists."
- [ ] Verify the object key naming (`drive/${user.id}/...`) can't be guessed/enumerated to bypass ownership checks (keys should never be trusted as the sole auth boundary — confirm DB lookup always gates access).
- [ ] Audit the three known download surfaces for consistent behavior:
  - `drive.get('/download')` — token-based, no session (checked against `parsed.userId` — confirm no path lets a token for user A read user B's `item.url`).
  - `notes.get('/attachments/download')` — token-based; explicitly checks `attachment.owner_user_id !== parsed.userId` — confirm this pattern is applied everywhere, not just here.
  - `notes.get('/attachments/p/:slug')` — session-authenticated; confirm `getAttachmentBySlugForUser` filters by `user.id` in SQL (not just slug lookup + app-level check).
- [ ] Confirm signed tokens (`attachmentTokens.ts`) are single-purpose, short-TTL (currently 300s), HMAC-signed with `TOKEN_SECRET`, and use `timingSafeEqual` — verify `TOKEN_SECRET` is never logged, defaulted, or committed.
- [ ] Check for IDOR: can a user supply another user's `drive_item_id` / `attachment_id` / R2 object key directly in any endpoint and receive data back? Walk every route parameter that maps to a DB row or R2 key.
- [ ] **Out-of-band (Cloudflare dashboard):** verify `d11-note-attachments` and `d11-food-entries` R2 buckets have **no public access / no r2.dev URL / no custom domain** enabled. Code review can't fully confirm this — must be checked in the CF dashboard or via `wrangler r2 bucket` settings.
- [ ] Confirm no endpoint returns a raw/unsigned R2 URL to the client (only signed, time-limited tokens or session-gated proxy routes).

### Phase 2 — Upload Path Hardening ✅ (see [findings-2026-07-29-phase2-upload.md](findings-2026-07-29-phase2-upload.md))
- [x] Validate file size limits are enforced server-side (not just client-side) — confirm `MAX_DRIVE_UPLOAD_BYTES` (100MB) is checked before/at `put()`, not after full buffering (check for streaming vs. buffering into memory — Worker has a 128MB memory ceiling).
- [x] Check `sanitizeFilename()` / content-type handling for injection into `Content-Disposition` header (header injection via filename with `\r\n` or quotes) — confirm quote-stripping is sufficient.
- [x] Confirm content-type is not blindly trusted for anything security-sensitive (e.g., no path renders uploaded HTML/SVG inline that could execute script — check `isImageContentType` / inline vs attachment disposition logic for stored-XSS risk via SVG or HTML uploads). *(fixed in Phase 1, re-verified here)*
- [x] Verify upload failure cleanup (`ATTACHMENTS.delete(objectKey)` on DB failure) doesn't leave orphaned files with sensitive content if it silently fails (currently swallowed in a bare `catch`).
- [x] Confirm there's no virus/malware scanning gap that matters for the threat model (accepted risk for personal use — documented as a known limitation, not fixed).

### Phase 3 — Auth & Session Integrity ✅ (see [findings-2026-07-29-phase3-auth.md](findings-2026-07-29-phase3-auth.md))
- [x] Confirm session tokens (`users.token_hash`) have an expiry/rotation mechanism — read `src/db/users.ts` for token issuance/expiry logic (not yet confirmed in this pass).
- [x] Confirm `hashToken` (SHA-256) lookup pattern doesn't need `timingSafeEqual` (DB-indexed equality lookup is fine; the risk is only with byte-by-byte string comparison of secrets, which is not what's happening here) — document as verified-safe rather than a false-positive flag.
- [x] Re-verify `apiTokenMiddleware` never allows an API token scoped to one purpose to reach unrelated endpoints (check `scopes` JSON field usage/enforcement — grep for `.scopes` consumers).
- [x] Confirm cookie `d11_auth` has `HttpOnly`, `Secure`, `SameSite` attributes set at issuance (`auth.ts` routes) given CORS is `origin: '*'`.

### Phase 4 — CORS / Transport ✅ (see [findings-2026-07-29-phase4-cors-transport.md](findings-2026-07-29-phase4-cors-transport.md))
- [x] `src/index.ts` sets `cors({ origin: '*', allowHeaders: ['Authorization','Content-Type'] })` — confirm `credentials` is never enabled alongside wildcard origin (it currently isn't, but re-verify since this is a common regression), and confirm cookie-based routes (`/l/:prefix/:slug`) aren't reachable cross-origin in a way that leaks private bookmarks/attachments.
- [x] Confirm all attachment/download responses set restrictive caching (`private`, `no-store`/`no-cache`) so CDN/shared caches never retain financial/health documents. Spot-checked: `drive.ts` uses `private, max-age=60`; `notes.ts` permalink uses `private, no-cache, must-revalidate`. Confirm consistency and whether `max-age=60` should be `no-store` for high-sensitivity files.

### Phase 5 — D1 / Data Layer
- [ ] Confirm all attachment/drive/health/financial-relevant queries are parameterized (spot pattern already looks correct via `.bind()`, but sweep `src/db/drive.ts`, `src/db/notes.ts`, `src/db/health.ts` for any string-concatenated SQL).
- [ ] Confirm soft-delete (`softDeleteDriveItem`) actually blocks R2 object retrieval post-delete, or if the R2 object remains fetchable via an old signed token until it expires (acceptable given short TTL, but confirm no permanent unsigned path survives deletion).
- [ ] Confirm error messages returned to clients never leak SQL, file paths, or R2 key structure.

### Phase 6 — Edge Runtime / Isolate Hygiene
- [ ] Grep for module-level `let`/`var` mutable state outside request handlers across `src/` (cross-request leak risk in reused isolates).
- [ ] Confirm all `waitUntil` fire-and-forget calls (e.g., `touchApiToken`) don't carry sensitive payloads that could race with request teardown.
- [ ] Confirm large R2 objects are streamed (`c.body(object.body)`) rather than buffered via `.text()`/`.arrayBuffer()` — spot-checked as already correct in `drive.ts`/`notes.ts`.

### Phase 7 — Secrets & Config
- [ ] Confirm `TOKEN_SECRET`, `CF_ACCESS_CLIENT_ID/SECRET` are only ever read via `c.env` and set with `wrangler secret put` — never hardcoded or committed (per `wrangler.toml` comments).
- [ ] Confirm no `.dev.vars` or local secret file is committed to git.

## Deliverable

For each checked item: **file + line reference, concrete risk (if any), and a specific fix** — not generic advice. Findings get written to a new `docs/90-security-audit/findings-YYYY-MM-DD.md` after the review pass, categorized Critical / High / Medium / Low, with the R2 document-safety items called out first given the stated goal (safe storage of health/financial docs).

## Suggested execution order

1. Phase 1 (R2 access control) — highest priority given the stated goal.
2. Phase 3 (auth/session) — everything else depends on this being sound.
3. Phase 2 (upload hardening).
4. Phase 4 (CORS/transport), Phase 5 (D1), Phase 6 (runtime), Phase 7 (secrets) — can be done in one remaining pass.
