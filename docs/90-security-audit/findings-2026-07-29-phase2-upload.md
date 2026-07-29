# Phase 2 Findings — Upload Path Hardening (2026-07-29)

Scope executed: `src/routes/drive.ts`, `src/routes/notes.ts`, `src/routes/food.ts` upload handlers, per [review-plan.md](review-plan.md) Phase 2. All fixes below have been implemented.

## Summary

Two real gaps were found and fixed: uploads were only size-checked *after* the full multipart body had already been buffered into memory (no defense against oversized-body memory pressure), and R2 cleanup failures on a failed upload were silently swallowed with no trace. Filename/header-injection risk was reviewed and found to already be safely handled. Content-type trust for inline rendering was already fixed in Phase 1 and is re-confirmed here. Malware scanning remains an accepted, documented limitation.

---

## Fixed

### 1. [Medium] Size limits were enforced only after the request body was fully buffered

**Files:** [drive.ts](../../src/routes/drive.ts#L246-L257) (`drive.post('/files')`), [notes.ts](../../src/routes/notes.ts#L499-L509) (`notes.post('/:id/attachments')`), [food.ts](../../src/routes/food.ts#L244-L254) (`food.post('/entries/photo')`)

`filePart.size` is only known once `c.req.formData()` has fully parsed the multipart body — meaning the existing `size > MAX_*_BYTES` checks ran *after* an arbitrarily large request body had already been read into the Worker's memory (128MB isolate ceiling). An oversized upload wouldn't be rejected until the (expensive) parse already happened.

**Fix:** Added a `Content-Length` header pre-check before calling `formData()` in all three routes, rejecting with `413 Payload Too Large` immediately if the declared length exceeds the route's limit:
```ts
const declaredLength = Number.parseInt(c.req.header('content-length') ?? '', 10)
if (Number.isFinite(declaredLength) && declaredLength > MAX_DRIVE_UPLOAD_BYTES) {
    return c.json({ error: 'File exceeds 100MB limit' }, 413)
}
```
The original post-parse `size` check is left in place as a fallback for requests without a `Content-Length` header. Note: Cloudflare's platform-level request size limits are a further backstop regardless of this app-level check.

### 2. [Low] Orphaned R2 objects on failed uploads were silently swallowed

**Files:** [drive.ts](../../src/routes/drive.ts#L310-L320), [notes.ts](../../src/routes/notes.ts#L571-L582), [food.ts](../../src/routes/food.ts#L322-L333)

All three upload routes `put()` the object to R2 *before* writing the D1 row; if the D1 write then fails, the code attempts to delete the just-uploaded object, but the cleanup itself was wrapped in a bare `catch { /* ignore */ }` — if the delete also failed, the file was left in the bucket permanently with zero record of it anywhere (not listable, not downloadable, not deletable through the app).

**Fix:** Cleanup failures are now logged via `console.error` with the object key, user id, and (for notes/food) the note/entry id, so they're visible in `wrangler tail` / Workers logs for manual purge if they ever occur. Also fixed the same unguarded `FOOD_ENTRIES.delete()` call in the `entryId`-update-not-found branch in `food.ts`, which previously had no try/catch at all (an unhandled rejection there would have surfaced as a raw 500 instead of the intended 404).

---

## Reviewed — no change needed

### 3. [Verified safe] Filename/content-type header injection

`sanitizeFilename()` (all three routes) and `sanitizeDisplayName()` (`db/drive.ts`) strip `\s+` (which covers `\r`, `\n`, tabs) and, in the drive case, all C0 control characters, before the value is ever persisted or echoed into `Content-Disposition`. Separately, the Workers/Fetch API `Headers` implementation itself rejects any header value containing raw CR/LF bytes (per spec), so even an unsanitized value could not achieve HTTP response-splitting via `c.header()`. No fix needed.

### 4. [Verified — fixed in Phase 1] Content-type trust for inline rendering

Already addressed by the Phase 1 `INLINE_SAFE_IMAGE_TYPES` allow-list in `drive.ts` and the pre-existing `ALLOWED_ATTACHMENT_TYPES` allow-list in `notes.ts`. Re-checked here in the context of upload handling specifically — both routes now only ever render a fixed, safe set of raster image types inline; everything else is forced to `attachment` disposition regardless of the claimed content-type.

### 5. [Accepted limitation — not fixed] No malware/virus scanning on uploads

No content-based malware scanning exists (or is planned) for Drive/notes/food uploads. This is a reasonable accepted risk for a single-user personal tool with no antivirus infrastructure on Cloudflare's edge, but it's worth stating explicitly given the intent to store financial/health documents: an uploaded file (e.g., a downloaded "invoice.pdf" from an untrusted source) is stored and served back byte-for-byte with no scanning. Mitigating factors already in place: strict inline-render allow-list (finding #4) prevents any uploaded file from executing in-browser regardless of content, and `X-Content-Type-Options: nosniff` (Phase 1 fix) stops the browser from re-interpreting a non-image file as something executable. If deeper protection is wanted later, an external scanning API (e.g., called from `waitUntil` post-upload) would be the natural extension point — out of scope for this pass.

---

## Remaining Phase 2 item

None outstanding — all checklist items in [review-plan.md](review-plan.md) Phase 2 are either fixed or explicitly accepted as documented limitations.

## Next

Phase 3 (Auth & Session Integrity) is next in the suggested execution order — say the word to proceed.
