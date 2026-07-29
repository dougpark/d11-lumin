# Phase 5 Findings — D1 / Data Layer (2026-07-29)

Scope executed: dynamic SQL builders in `src/db/bookmarks.ts`, `src/db/notes.ts`, `src/db/health.ts`, `src/routes/v1.ts`; soft-delete/hard-delete gating in `src/db/drive.ts` and `src/db/notes.ts`; error-response handling across `src/routes/drive.ts`, `src/routes/notes.ts`, `src/routes/food.ts`. Per [review-plan.md](review-plan.md) Phase 5.

## Summary

No SQL injection risk anywhere — every dynamic query builder composes fixed condition fragments and binds all values. Deletion (soft or hard) correctly blocks all read paths, including replay of an as-yet-unexpired signed download token, so download tokens are never a standalone trust boundary. One contained gap was found and fixed (delete-path R2 cleanup failures were silently swallowed in `notes.ts`, same class of issue Phase 2 already fixed for the upload path). Two lower-priority items are flagged as recommendations rather than fixed outright, since both would be new behavior/policy decisions rather than bug fixes.

---

## Fixed

### 1. [Low] Delete-path R2 cleanup failures were silently swallowed in `notes.ts`

**Files:** [notes.ts](../../src/routes/notes.ts#L458) (`DELETE /api/notes/:id`), [notes.ts](../../src/routes/notes.ts#L608) (`DELETE /api/notes/:id/attachments/:attachmentId`)

Both routes call `ATTACHMENTS.delete()` after the D1 rows are already gone, but wrapped it in `catch { /* ignore */ }` — if the R2 delete failed, the object would be silently orphaned with no log trail, mirroring the exact upload-path issue Phase 2 fixed. This is the delete-side counterpart that was missed at the time.

**Fix applied:** both now log via `console.error('note delete cleanup failed — orphaned R2 object', { objectKey, userId, noteId, error })` / `console.error('attachment delete cleanup failed — orphaned R2 object', { objectKey, userId, noteId, attachmentId, error })` instead of swallowing silently. Verified with `tsc --noEmit` — no new errors (only the pre-existing, unrelated `chat.ts` error remains).

---

## Verified safe — no change needed

### 2. [Verified safe] No SQL injection surface in any dynamic query builder

Checked every place a WHERE/ORDER BY clause is assembled at runtime:
- `bookmarks.ts` (`listBookmarks` + `v1.ts`'s posts-list builder), `notes.ts` (`listNotes`), `health.ts` (`listHealthEntries`) all build `conditions: string[]` from **fixed literal fragments** (e.g. `'user_id = ?'`, `'n.channel_id = ?'`, `'timestamp >= ?'`) pushed conditionally; every actual value goes through a parallel `bindings` array consumed via `.bind(...bindings, ...)`. No user-controlled string is ever spliced into the SQL text itself.
- The one place a column *name* is interpolated (`bookmarks.ts`'s `ORDER BY b.${safeSort} ${safeOrder}`) is allowlisted via a `const` tuple (`['created_at', 'title', 'hit_count', 'last_accessed']`) before use, per the convention documented in `AGENTS.md`.
- `drive.ts` and `food.ts` use fully static, parameterized queries with no dynamic WHERE-building at all.

No fix needed.

### 3. [Verified safe] Deletion (soft or hard) blocks access even for a still-valid signed download token

- `drive_items` / `attachments` (Drive) use soft-delete (`deleted_at`), and **every** read/list/download query in `drive.ts` filters `di.deleted_at IS NULL` / `a.deleted_at IS NULL` — including `getDriveDownloadRecord`, the function backing the signed-token `/download` route. So even if an attacker (or the original user) replays a signed download token within its 300s TTL after the file was deleted, the DB gate returns "not found" — the token alone is never sufficient.
- Notes attachments use **reference-counted hard delete** instead (`removeNoteAttachment`/`deleteNoteWithAttachments` `DELETE FROM attachments` once the last `attachment_list` reference is gone) — a different mechanism, same effect: once deleted, `getAttachmentForDownload`/`getAttachmentBySlugForUser` simply can't find the row, so a replayed token 404s the same way.
- `food_entries` soft-delete (`deleted_at`) is likewise checked in `getFoodImageKey`.

No fix needed — deletion is consistently a real access-control boundary, not just a UI-hiding mechanism, across all three R2-backed features.

---

## Flagged for a decision (not changed)

### 4. [Low / Info] Soft-deleted Drive items are never actually purged from R2 or D1

`drive.delete('/items/:id')` only calls `softDeleteDriveItem` (sets `deleted_at`). There is no restore/trash UI, no "permanently delete" endpoint, and no scheduled job (the existing cron trigger only handles RSS ingest) that ever removes a soft-deleted `drive_items`/`attachments` row or its underlying R2 object. Practically: **"deleting" a Drive file today only hides it — the file content stays in R2 and the row stays in D1 forever.**

This isn't an access-control bug (finding #3 confirms the deleted-at gate fully blocks every read path), but it's a data-lifecycle gap worth knowing about given the stated goal — if you ever need to *actually* remove a health/financial document (not just hide it from the UI), there's currently no way to do that short of a manual D1/R2 operation. Two options if you want this closed, in increasing effort: (a) add a "permanently delete" action that hard-deletes the row and calls `ATTACHMENTS.delete()` once `deleted_at` is already set; (b) a scheduled purge (e.g., in the existing cron handler) that hard-deletes anything with `deleted_at` older than N days. Not implemented — this is a retention-policy decision, not a bug fix.

### 5. [Low, defense-in-depth] Some catch blocks return the raw exception message to the client

**Files:** `drive.ts` (5 occurrences), `notes.ts` (8 occurrences), `food.ts` (1 occurrence) — pattern: `return c.json({ error: (err as Error).message || '...' }, 400)`.

I traced every application-level `throw new Error(...)` site feeding these catches (`db/drive.ts`'s `createDriveFolder`/`createAttachmentForUser`/`createDriveFile`/etc.) and confirmed they all use safe, hand-written, user-actionable messages ("Parent folder not found", "Cannot move item into itself", etc.) — **no actual SQL/schema/file-path leakage found in practice.** The residual risk is theoretical: because a JS `catch` catches *any* thrown value, an unanticipated D1 runtime error (e.g., an unhandled constraint violation) would also have its raw `.message` surfaced verbatim, and D1 error messages can include table/column names.

I didn't mechanically rewrite all 14 sites — several of the existing messages are deliberately useful, user-facing validation feedback, and a blunt "always generic" replacement would degrade UX for legitimate cases without a clear net security benefit given no actual leak was found. If you want additional defense-in-depth here later, the clean approach is a small shared helper (e.g. `safeErrorResponse(err, fallback)`) that only echoes back messages from a known "application error" type and otherwise logs-and-generic-izes anything else — but that's a deliberate small convention change worth doing on its own, not a silent patch bundled into this pass.

---

## Next

Phase 6 (Edge Runtime / Isolate Hygiene) is next in the suggested order. Still parked: the Phase 3 session-token reset feature, and the two flagged-but-not-fixed items above (#4 retention/purge, #5 error-message hardening).
