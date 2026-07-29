# Phase 7 Findings — Secrets & Config (2026-07-29)

Scope executed: `wrangler.toml`, `.gitignore`, `.dev.vars` tracking status + full git history, `Env` type declaration and `getTokenSecret()` in `src/index.ts`/`src/utils/attachmentTokens.ts`, and a workspace-wide sweep for logged secrets or hardcoded credential-shaped strings. Per [review-plan.md](review-plan.md) Phase 7.

## Summary

Clean pass — no hardcoded secrets, no committed secret files (now or historically), and every secret is read exclusively via `c.env`/`env` with no fallback/default value. This closes out the review plan; see the final wrap-up section below.

---

## Verified safe — no change needed

### 1. [Verified safe] Secrets are declared correctly in `wrangler.toml` and never hardcoded

`TOKEN_SECRET`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` are **not** present in `wrangler.toml`'s `[vars]` block (which only holds genuinely non-secret values: `ENVIRONMENT`, `AI_BOOKMARK_MODEL`, `OLLAMA_URL` — a URL, not a credential). Instead, `wrangler.toml` carries only comments instructing `wrangler secret put <NAME>` for all three. Confirmed via grep across the entire codebase that none of these three ever appear with a literal value assigned anywhere — every reference is `c.env.TOKEN_SECRET` / `env.CF_ACCESS_CLIENT_ID` / etc. No fix needed.

### 2. [Verified safe] No secret file has ever been committed, including in history

`.gitignore` correctly excludes `.dev.vars`, `.env`, `.env*.local`. A local `.dev.vars` file exists on disk (expected, for local dev) but `git ls-files` confirms it is **not tracked**. Ran `git log --all --diff-filter=A` across `.dev.vars`/`*.env`/`.env.local` — zero results, confirming no secret file was ever added and later removed/ignored (a common real-world mistake this specifically rules out). No fix needed.

### 3. [Verified safe] `TOKEN_SECRET` has no default/fallback value

`getTokenSecret()` in `attachmentTokens.ts` returns `null` for anything that isn't a non-empty string — callers (`drive.ts`, `notes.ts`, `index.ts`'s AI-daemon download route) all explicitly check for `null` and fail closed (`500 Attachment signing is not configured` / throw), rather than silently falling back to a weak or predictable default secret. No fix needed.

### 4. [Verified safe] No other logged secrets or hardcoded credential-shaped strings

Following up directly on the Phase 6 finding (Ollama credentials logged to console), swept the whole codebase for `console.log`/`console.error`/`console.warn` calls that dump `env`/`c.env` wholesale, and for common hardcoded-secret shapes (API-key-style literals, AWS-style access keys, etc.). No other hits — the `ollama.ts` issue fixed in Phase 6 was the only instance of this pattern in the codebase. No fix needed.

---

## Review wrap-up

This closes all 7 phases of [review-plan.md](review-plan.md). Quick status of everything found across the review:

**Fixed during this review:**
- Drive uploads now enforce a content-type allow-list for inline rendering (Phase 1) — closed a stored-XSS path via spoofed SVG uploads.
- Baseline security headers added app-wide (Phase 1).
- Upload size limits now enforced via `Content-Length` pre-check before body buffering, on all three upload routes (Phase 2).
- Upload-failure R2 cleanup failures are now logged instead of silently swallowed, including one previously-unguarded delete call in `food.ts` (Phase 2).
- `Cache-Control` hardened to `no-store` on the two remaining token-based download routes that were missed in Phase 1's pass (Phase 4).
- Delete-path R2 cleanup failures (note delete, attachment remove) are now logged instead of silently swallowed (Phase 5).
- Cloudflare Access credentials no longer logged to console on every AI chat request; full prompt-body logging trimmed (Phase 6).
- In-memory chat rate-limit map no longer grows unbounded for the isolate's lifetime (Phase 6).

**Flagged for your decision, not changed (still open):**
- **Session token has no expiry/rotation** (Phase 3, finding #1) — you asked to come back to this; a `POST /api/auth/reset-token` endpoint is scoped out and ready to build whenever you want it.
- **`d11_auth` cookie can't be `HttpOnly`** since it's set via client-side JS by design (Phase 3, finding #2) — architectural tradeoff, two remediation paths documented if you want to revisit.
- **Soft-deleted Drive files are never actually purged** from R2/D1 — no restore or permanent-delete path exists (Phase 5, finding #4).
- **A few catch blocks echo raw exception messages** to the client — verified no actual leak today, flagged as a defense-in-depth item if you want a shared "safe error" helper later (Phase 5, finding #5).
- **Recommend rotating `CF_ACCESS_CLIENT_SECRET`** as a precaution given it was being logged until this pass fixed it (Phase 6, finding #1) — a credential-management action for you, not something I did automatically.

**Requires manual, out-of-band verification (can't be confirmed from code):**
- Confirm in the Cloudflare dashboard that the `d11-note-attachments` and `d11-food-entries` R2 buckets have no public access / no `r2.dev` URL / no custom domain enabled (Phase 1, finding #9).

Net assessment for your stated goal: the codebase has strong SQL-level ownership enforcement and well-designed signed-token patterns for R2 downloads throughout, and every concrete access-control gap found was fixed during this review. The two things most worth deciding on before you start storing health/financial documents are the session-token lifecycle gap (Phase 3) and confirming the R2 bucket dashboard settings (Phase 1, #9) — everything else is either fixed or a lower-severity hardening/policy call.
