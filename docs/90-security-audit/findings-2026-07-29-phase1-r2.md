# Phase 1 Findings — R2 Access Control (2026-07-29)

Scope executed: `src/routes/drive.ts`, `src/routes/notes.ts`, `src/routes/food.ts`, `src/db/drive.ts`, `src/db/notes.ts`, `src/utils/attachmentTokens.ts`, `src/index.ts`, `schema.sql`. Per [review-plan.md](review-plan.md) Phase 1.

## Summary

Ownership enforcement on R2-backed attachments is **solid overall** — every read path filters by `user_id`/`owner_user_id` at the SQL level, and signed download tokens are correctly scoped, short-lived, and HMAC-verified with constant-time comparison. Two concrete, fixable gaps were found (#1 content-type allow-list, #2 security headers), plus lower-priority hardening items and one item that needs verification in the Cloudflare dashboard (not visible from code).

---

## Findings

### 1. [Medium] `drive.ts` uploads have no content-type/extension allow-list — inline SVG could self-XSS

**Files:** [drive.ts](../../src/routes/drive.ts#L188-L232) (`drive.post('/files')`), [drive.ts](../../src/routes/drive.ts#L106-L132) (`drive.get('/download')`)

`notes.ts` restricts note attachments to a fixed set of content-types/extensions (`ALLOWED_ATTACHMENT_TYPES` + `isAllowedAttachment()`, enforced at [notes.ts:514](../../src/routes/notes.ts#L514)). `drive.ts` has no equivalent — any `content_type` the client claims is accepted verbatim:

```ts
const contentType = filePart.type || 'application/octet-stream'
```

The download route then decides inline vs. attachment rendering purely from that stored content-type:

```ts
if (contentType.toLowerCase().startsWith('image/')) return `![${label}](${url})`
```

and in the actual byte-serving route, `Content-Type` is echoed back from the stored value with no sniffing/allow-list gate. A file uploaded with `Content-Type: image/svg+xml` (SVGs can embed `<script>`) would be served with that content-type and `inline` disposition when `?inline=1` is used, letting it execute JS in your own session (stored self-XSS) — meaningful given that Drive is the intended home for downloaded financial/health PDFs, where a malicious or mislabeled file is plausible.

**Fix:** Add the same allow-list pattern used in `notes.ts` to `drive.post('/files')`, or at minimum force `Content-Disposition: attachment` (never `inline`) for `image/svg+xml` and any non-raster/non-PDF type, and add `X-Content-Type-Options: nosniff` (see #2) so browsers never sniff a different, more dangerous type.

### 2. [Medium] No baseline security response headers anywhere in the app

**File:** [index.ts](../../src/index.ts) (global middleware, ~line 84)

Grep confirms no route or global middleware sets `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, or `Content-Security-Policy`. This matters specifically for R2/document safety because:
- Presigned download URLs (`/api/drive/download?t=...`, `/api/notes/attachments/download?t=...`) carry a secret token **in the query string**. Without `Referrer-Policy`, if a page displaying/linking to one of these URLs (e.g., an inline PDF preview or a note containing a link) triggers outbound navigation or a third-party resource fetch, the full URL — token included — can leak via the `Referer` header to that third party within the token's 5-minute validity window.
- Missing `X-Content-Type-Options: nosniff` compounds finding #1 — browsers may sniff an uploaded file's true content and render it as HTML/SVG even if the stored content-type says otherwise.

**Fix:** Add a global middleware in `index.ts`:
```ts
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('X-Frame-Options', 'DENY')
})
```
For the download routes specifically, consider `Referrer-Policy: no-referrer` and `Cache-Control: no-store` (see #3) rather than the app-wide default.

### 3. [Low] Presigned download caching is looser than ideal for sensitive files

**File:** [drive.ts:127](../../src/routes/drive.ts#L127)

```ts
c.header('Cache-Control', 'private, max-age=60')
```

For a general attachment this is fine, but for financial/health documents a 60-second browser/disk cache window plus no `Referrer-Policy` is an avoidable combination. Recommend `no-store` on `drive.get('/download')` and `notes.get('/attachments/download')` specifically (the permalink route `notes.get('/attachments/p/:slug')` already correctly uses `private, no-cache, must-revalidate`).

### 4. [Info — verified safe] R2 ownership checks are consistently SQL-enforced

Confirmed every read path filters by owner in SQL, not just app logic:
- `getDriveDownloadRecord` — `WHERE di.drive_item_id = ? AND di.user_id = ?`
- `getDriveAttachmentInfoByDriveItemId` / `ByAttachmentId` — both filter by `user_id`/`owner_user_id`
- `getAttachmentBySlugForUser` — joins through `notes.user_id = ?`
- `getNoteAttachment` — gates through `getNoteById(db, userId, noteId)` before any attachment lookup
- `getFoodImageKey` (food.ts) — takes `user_id` param, verified pattern consistent with the above

No IDOR found via direct ID/slug enumeration in any of these paths.

### 5. [Info — verified safe] Signed download tokens are correctly scoped

`attachmentTokens.ts` and the inline equivalent in `notes.ts`: HMAC-SHA256 over `userId.itemId.attachmentId.exp`, `timingSafeEqual` comparison (not `===`), 300-second TTL, minted only after an ownership check (`getNoteAttachment`, `getDriveDownloadRecord` called before `createDownloadToken`). The `/download` routes are intentionally reachable without a session cookie — this is a standard presigned-URL pattern, and the short TTL bounds exposure if a URL leaks. No forgeable path found (all fields are part of the signed payload, not trusted separately).

### 6. [Low] Inconsistent auth layering between `drive.ts` and `notes.ts`

`index.ts` applies a top-level `authMiddleware` to `/api/notes/*`, `/api/health/*`, `/api/food/*`, `/api/bookmarks/*`, `/api/chat/*` — but **not** `/api/drive/*`. Drive relies solely on its own internal `drive.use('*', authMiddleware)` (registered after the intentionally-public `/download` route). This works correctly today (verified the internal middleware covers every other Drive route), but it's an easy trap for a future contributor who assumes all `/api/*` sub-routers get top-level coverage and adds a new Drive route before the internal `.use()` call, or after it but assumes redundant top-level protection that isn't there. Recommend adding `/api/drive/*` to the top-level list in `index.ts` for defense-in-depth, or a code comment calling out that Drive intentionally self-protects.

### 7. [Low] Silently swallowed R2 cleanup failures can orphan sensitive files

**Files:** [drive.ts:232](../../src/routes/drive.ts#L232), [food.ts](../../src/routes/food.ts) (upload error paths)

```ts
} catch (err) {
    try { await c.env.ATTACHMENTS.delete(objectKey) } catch { /* ignore */ }
    return c.json({ error: (err as Error).message || 'Upload failed' }, 400)
}
```

If the DB insert fails after the R2 `put()` succeeds, and the subsequent cleanup `delete()` *also* fails (network blip, etc.), the file remains in R2 permanently with no D1 row pointing to it — meaning it's invisible to the app (can't be listed, downloaded via the app's own auth-gated routes, or deleted by the user), but still occupies the bucket. Not an access-control vulnerability (it's not reachable without direct R2 API access), but worth fixing for data-hygiene/GDPR-style "right to delete" reasons given the sensitivity of intended content. Recommend logging failed cleanups (e.g., a small `orphaned_objects` table) so they can be audited/purged later.

### 8. [Info — dormant, watch item] `drive_items.is_public` column is unused today

`schema.sql` defines `is_public INTEGER NOT NULL DEFAULT 0` on `drive_items`, mirroring the bookmarks table's public/private flag. Grep confirms **zero** references to `is_public` in `src/routes/drive.ts` or `src/db/drive.ts` — no code path currently reads or exposes it. No exposure risk today. Flagging so that if a "share this file" feature is built later, it's built deliberately (default-private, explicit opt-in, ideally scoped per-file not per-folder) rather than accidentally inheriting the bookmarks sharing pattern for what may be health/financial content.

### 9. [Needs out-of-band verification — cannot be confirmed from code]

`wrangler.toml` does not configure a public bucket domain for `d11-note-attachments` or `d11-food-entries`, which is a good sign, but **bucket-level public access settings live in the Cloudflare dashboard / R2 bucket settings, not in this repo**. This is the single most important non-code check for the stated goal (safe storage of health/financial docs):
- [ ] Confirm the **"Public Development URL" (r2.dev)** is disabled for both buckets.
- [ ] Confirm no **custom domain** is bound to either bucket.
- [ ] Confirm no **bucket-level CORS policy** or public-read bucket policy has been set outside of this codebase.

---

## Suggested priority order to fix

1. #2 (security headers) — cheap, global, closes a real leak vector.
2. #1 (Drive content-type allow-list) — direct stored-XSS risk, same fix pattern already exists in `notes.ts` to copy.
3. #9 (dashboard verification) — do this manually today regardless of code fixes; takes 2 minutes and rules out the worst-case scenario.
4. #3 (cache headers on download routes) — quick follow-on to #2.
5. #6, #7, #8 — lower priority hardening/hygiene, no urgency.

Ready to move to Phase 2 (upload path hardening) or implement fixes for any of the above — let me know which you'd like next.
