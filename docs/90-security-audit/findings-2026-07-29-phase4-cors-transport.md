# Phase 4 Findings — CORS / Transport (2026-07-29)

Scope executed: `src/index.ts` CORS config, `/l/:prefix/:slug` + `/l/:slug` short-link routes, and `Cache-Control` headers across every attachment/drive/food-image download route (`drive.ts`, `notes.ts`, `food.ts`, `index.ts`). Per [review-plan.md](review-plan.md) Phase 4.

## Summary

CORS config is correct and low-risk. One real inconsistency was found and fixed: two signed-token download routes were still using a 60-second cacheable `Cache-Control` value that Phase 1 had already hardened to `no-store` on the equivalent `drive.ts` route — brought in line. Everything else checked out clean.

---

## Fixed

### 1. [Low] `Cache-Control` inconsistency on token-based download routes

**Files:** [notes.ts](../../src/routes/notes.ts#L210) (`GET /api/notes/attachments/download`), [index.ts](../../src/index.ts#L330) (`GET /api/ai/files/download`)

Both routes serve a file body to whoever holds a valid signed download token, but were still sending `Cache-Control: private, max-age=60` — allowing a browser (or any private/local cache) to retain the raw bytes for up to a minute without revalidation. `drive.ts`'s equivalent `/download` route was already hardened to `Cache-Control: no-store` in Phase 1 specifically because these routes can serve arbitrary user-uploaded documents (including, per your stated goal, health/financial files). The other two routes were missed at the time.

**Fix applied:** changed both to `Cache-Control: no-store`, matching `drive.ts`. Verified with `tsc --noEmit` — no new errors (only the pre-existing, unrelated `chat.ts` error remains).

---

## Verified safe — no change needed

### 2. [Verified safe] CORS config never combines wildcard origin with credentials

```ts
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}))
```

No `credentials: true` is set anywhere (Hono's `cors()` defaults to no credentials support). This is the correct configuration for a Bearer-token API that also wants to be callable from arbitrary origins (browser extensions, scripts) — `Access-Control-Allow-Credentials` is never sent, so browsers won't expose cookie-carrying cross-origin responses to JS. No fix needed.

### 3. [Verified safe] `/l/:prefix/:slug` cookie-reading route has no cross-user leak

This route reads the `d11_auth` cookie (`SameSite=Lax`, so it *is* sent on top-level cross-site navigations, e.g. clicking a link from another site or app) to resolve `requestingUserId`, purely so the **bookmark owner** can follow their own private short-links and still get redirected. The actual gate is:

```ts
if (!bookmark.is_public && requestingUserId !== bookmark.user_id) return c.notFound()
```

This only ever grants access when the requesting cookie's user matches the bookmark's owner — there's no path for a third party to see another user's private bookmark via this route, regardless of whether their own cookie is attached. The only side effect reachable by an arbitrary third party (no auth needed) is the fire-and-forget `recordClick()` analytics write (referer/UA logged against the bookmark's hit counter) — expected, benign behavior for a link-shortener/redirect endpoint, and it writes no attacker-controlled data anywhere sensitive. No fix needed.

### 4. [Verified safe] Session-gated attachment/image routes use correct (not stale) cache semantics

`notes.ts`'s `/attachments/p/:slug` permalink and `food.ts`'s `/entries/:id/image` both use `Cache-Control: private, no-cache, must-revalidate, max-age=31536000`. This looks contradictory at a glance but is correct HTTP semantics: `no-cache` (despite the name) means "cache it, but revalidate with the server before reusing it" — it is not `no-store`. Because both routes sit behind `authMiddleware` and re-check ownership on every request (the `notes.ts` route additionally uses `ETag`/`If-None-Match` for cheap 304 revalidation), a stale cache entry can never be served without the server re-validating the requester's session and ownership first. No fix needed — this is a legitimate bandwidth optimization, not a leak.

---

## Next

Phase 5 (D1 / Data Layer) is next in the suggested order. Session-token reset feature (Phase 3, finding #1) is still open per your request to come back to it later.
