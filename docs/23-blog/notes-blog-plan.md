# Notes → Blog: Implementation Plan

Source spec: [notes-blog.md](notes-blog.md). Goal: let a note be flagged as a blog post,
publish it (and its attachments, copied to the CDN) to a public `blog.html` + `rss.xml`,
and cleanly unpublish (feed entry removed, CDN copies deleted).

Existing infra this builds on (already in the repo, no need to recreate):
- R2 `CDN_BUCKET` binding + `CDN_PUBLIC_BASE_URL` / `CF_ZONE_ID` / `CF_API_TOKEN` env vars ([wrangler.toml](../wrangler.toml)).
- Admin CDN router [src/routes/cdn.ts](../src/routes/cdn.ts) already has `buildPublicUrl()` and a
  `purgeCache()` helper — reuse the same pattern rather than duplicating it.
- Notes/attachments data layer: [src/db/notes.ts](../src/db/notes.ts), `attachments` +
  `attachment_list` tables in [schema.sql](../schema.sql) (attachments are many-to-many via
  `attachment_list`, referenced-counted by `countAttachmentReferences` in `drive.ts`).
- Client HTML pages are plain strings imported into `index.ts` (Wrangler `Text` module rule) and
  registered with `app.get('/path', ...)` — no bundler, no build step.

## Open decisions to confirm before/while building (flagged, not blocking)

1. **Single global blog vs per-user.** The spec's URLs (`blog.html?post=slug`) imply one shared
   public blog, not one per account. Recommendation: treat blog as a global feed across all users'
   notes (slug is globally unique already, per the schema below) but only allow `is_admin = 1`
   users to toggle a note to blog/published, since this is a personal single-owner site. Flag this
   for confirmation — cheap to change (just gate the toggle endpoint).
2. **Query-string vs path routing for posts.** The spec sketches `blog.html?post=slug`. For OpenGraph
   meta tags to work when a link is shared (crawlers don't run JS), the Worker needs to inject meta
   server-side. Recommend `GET /blog/:slug` (server-rendered head injection, same string-replace
   pattern already used for `%%HEADER%%` in `index.ts`) that serves `blog.html` with OG tags filled
   in, plus `GET /blog` for the list view. `blog.html?post=` can still work as a client-side fallback.
3. **Reusable tag list.** Spec says "maintain a notes tag list for reusable tags." No new table
   needed for v1 — derive distinct tags on the fly with `json_each(tag_list)` across the user's
   notes (see Phase 1). Revisit a dedicated table only if this needs to scale/perform better later.

---

## Phase 1 — Schema migration

New migration `migrations/2026-08-17-notes-blog-v1.sql` (and mirror the same columns into the
`notes`/`attachments` `CREATE TABLE` blocks in [schema.sql](../schema.sql) so fresh installs get
them for free — existing DBs still need the `ALTER TABLE`s per the repo's migration convention):

```sql
ALTER TABLE notes ADD COLUMN title        TEXT    NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN excerpt      TEXT    NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN slug         TEXT;
ALTER TABLE notes ADD COLUMN is_blog      INTEGER NOT NULL DEFAULT 0 CHECK (is_blog IN (0,1));
ALTER TABLE notes ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0,1));
ALTER TABLE notes ADD COLUMN published_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_slug ON notes (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_blog_feed ON notes (is_blog, is_published, published_at DESC);

-- per-attachment CDN copy, since attachment_list is many-to-many and a copy is scoped to one note
ALTER TABLE attachments ADD COLUMN cdn_key TEXT;
ALTER TABLE attachments ADD COLUMN cdn_url TEXT;
CREATE INDEX IF NOT EXISTS idx_attachments_cdn_key ON attachments (cdn_key);
```

Reuse the existing `tag_list` column for blog tags (already JSON string per repo convention —
`JSON.parse`/`JSON.stringify`). Do **not** reuse the pre-existing unused `notes.is_public` /
`share_url` / `share_expires_at` columns — they belong to a different, still-unimplemented
note-sharing feature and mixing concerns would be confusing.

Run `bun run db:migrate:local` then `bun run db:migrate:remote` after editing both files.

---

## Phase 2 — DB helpers

Extend [src/db/notes.ts](../src/db/notes.ts):
- `updateNoteMetadata(db, { user_id, note_id, title, tag_list, excerpt, slug })` — plain field update,
  independent of blog state.
- `setNoteBlogState(db, { user_id, note_id, is_blog, is_published })` — pure DB state transition,
  returns old + new row so the route layer can diff and decide whether to sync/purge attachments.
- `generateSlugCandidate(title)` util (in `src/utils/slug.ts` or similar) — lowercase, strip
  accents/punctuation, hyphenate, truncate; caller appends `-2`, `-3`... on collision via a
  `SELECT 1 FROM notes WHERE slug = ?` uniqueness loop (same retry-on-collision pattern already used
  for `createAttachmentSlug` in this file).
- `generateExcerpt(content)` util — strip Markdown syntax, collapse whitespace, slice to 160 chars.
- `listNoteTags(db, userId)` — `SELECT DISTINCT value FROM notes, json_each(notes.tag_list) WHERE user_id = ? AND value <> '' ORDER BY value`.

New `src/db/blog.ts` for public-facing reads (kept separate from the private `notes.ts` helpers,
mirroring how `cdn.ts` is split from `drive.ts`):
- `listBlogPosts(db, { tag?, q?, limit=50, before_published_at? })` — reads only the public-safe
  columns (`note_id, title, slug, excerpt, tag_list, published_at`), never `content` for list view.
- `getBlogPostBySlugOrId(db, slugOrId)` — full row incl. `content`, only if `is_blog=1 AND is_published=1`.
- `listBlogAttachments(db, noteId)` — attachments for a post, returning `cdn_url` (falls back to
  nothing if not yet synced — should never happen for a published post).

---

## Phase 3 — Publish/unpublish orchestration (private API)

In [src/routes/notes.ts](../src/routes/notes.ts), add under `authMiddleware`:

- `PATCH /api/notes/:id/metadata` — body `{ title?, tag_list?, excerpt?, slug? }`. Slug edits
  re-validate uniqueness.
- `PATCH /api/notes/:id/blog` — body `{ is_blog, is_published }`. This is the state-machine endpoint
  from the spec:
  1. Load current note; compute the transition (`private→public`, `public→private`, or no-op field
     tweak like draft↔published while already `is_blog`).
  2. **Private → Public** (`is_blog && is_published` becoming true): for each attachment on the note,
     stream bytes from `ATTACHMENTS` R2 and `CDN_BUCKET.put(`blog/${noteId}/${filename}`, stream, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } })`,
     in parallel (`Promise.all`), then persist `cdn_key`/`cdn_url` per attachment row. Rewrite any
     `local://...`-style attachment references inside `content`/rendered body to the new `cdn_url`s
     (the spec's "Inline Image CDN Replacer"; do it server-side at publish time so the stored
     content is portable, rather than only as an editor button).
  3. Set `published_at` (only on first publish — don't clobber it on later edits), `is_blog=1`,
     `is_published=1`.
  4. **Public → Private** (either flag flipping false): `CDN_BUCKET.delete()` all `cdn_key`s for the
     note's attachments, clear `cdn_key`/`cdn_url` columns, clear `published_at`.
  5. Either way: `c.executionCtx.waitUntil(purgeCache(...))` for the affected attachment public URLs
     plus `blog.json` and `rss.xml` (reuse/export the `purgeCache` helper from `cdn.ts`, or extract it
     to a shared `src/utils/cachePurge.ts` used by both routers — prefer extracting since two routers
     now need it).
  6. Return the updated note (private shape) to the editor.

Keep this endpoint's I/O sequential-per-note but attachments-parallel-within-note, matching the
spec's "Worker subrequest execution handles I/O wait effortlessly" performance note.

---

## Phase 4 — Public Blog API

New `src/routes/blog.ts`, mounted with **no auth middleware** (public):
- `GET /api/blog.json` — query params `tag`, `q`, `limit` (cap 50). Calls `listBlogPosts`. Response
  header `Cache-Control: public, max-age=300, s-maxage=300`.
- `GET /api/blog/:slug` — single post incl. attachments (`cdn_url`s). 404 if not
  `is_blog && is_published`. `Cache-Control: public, max-age=300, s-maxage=300`.
- `GET /rss.xml` — top-level route in `index.ts` (not under `/api`, matches spec's flat URL),
  builds the XML via template literal exactly as sketched in the spec, `Cache-Control: public,
  max-age=3600, s-maxage=3600`, `Content-Type: application/xml; charset=utf-8`.

Mount in `index.ts`: `app.route('/api/blog', blogRoutes)`.

---

## Phase 5 — Notes editor UI (`src/client/notes.html`)

- Metadata panel additions: **Title** (always visible), **Tags** (always visible — reuse existing
  tag input UX if one exists elsewhere in the app; autocomplete from `GET /api/notes/tags`),
  **checkbox "Publish to blog"**, and — only rendered when that checkbox is checked — **Draft/Published**
  toggle, **Excerpt** (pre-filled from auto-generated excerpt, editable), **Slug** (pre-filled from
  title, editable).
- Wire checkbox/toggle changes to call `PATCH /api/notes/:id/blog`; wire the other fields to
  `PATCH /api/notes/:id/metadata` (debounced autosave, matching however this file currently
  autosaves note content — check existing save-on-blur/debounce pattern before adding a new one).
- Surface publish errors (e.g., slug collision, CDN copy failure) inline rather than silently failing.

---

## Phase 6 — Public reader page

New `src/client/blog.html` (+ inline `<script>` or a small `blog.js`, following the no-bundler,
vanilla-JS convention used by every other client page):
- List view: fetch `/api/blog.json`, render title/date/excerpt cards, client-side tag chips and a
  search box that filter the already-fetched 50 (per spec — no extra round trips for the default view).
- Single view (`/blog/:slug`): fetch `/api/blog/:slug`, render Markdown body (check whether a
  Markdown renderer is already bundled for `notes.html`/`drive.html` and reuse it instead of adding
  a new dependency), prev/next nav (needs `listBlogPosts` to return neighboring slugs, or a small
  `GET /api/blog/:slug/neighbors` if simpler).
- Static header/footer hardcoded per the spec (no web components needed for a single page).
- `<link rel="alternate" type="application/rss+xml" ...>` for feed discovery.

In `index.ts`:
```ts
app.get('/blog', (c) => c.html(blogHtml as string))
app.get('/blog/:slug', async (c) => { /* fetch post, inject OG/canonical meta into blogHtml, then c.html(...) */ })
```

---

## Phase 7 — Cache purge & CDN sync hardening

- Extract `purgeCache`/`buildPublicUrl` out of `cdn.ts` into `src/utils/cdn.ts` (or similar) so
  `notes.ts`'s publish/unpublish flow and the new `blog.ts` can share it without duplicating the
  Cloudflare purge-API call.
- Confirm `CDN_BUCKET.put()` content-type detection reuses `detectContentType`-style logic already
  in `cdn.ts` (same extension-map) rather than re-deriving it.
- Double-check R2 `list()`/metadata gotcha already in repo memory doesn't bite here (not directly
  relevant to `put`/`delete`, but worth being aware of if a "re-sync all" admin action is added later).

---

## Phase 8 — Manual validation (no test suite in this repo)

Run through via `bun run dev`:
1. Create a note → toggle "Publish to blog" with an attachment → verify object appears under
   `blog/{noteId}/...` in the CDN bucket (via `/admin/cdn` browser) and `blog.json`/`rss.xml` include it.
2. Edit title/tags/excerpt/slug on a published post → verify `blog.json` reflects it and slug
   collisions are rejected with a clear error.
3. Uncheck "Publish to blog" → verify CDN objects are deleted, `blog.json`/`rss.xml` no longer list
   the post, and cache purge fires (check response of admin `/api/admin/cdn/purge` equivalent call
   in logs if `CF_API_TOKEN`/`CF_ZONE_ID` are set locally, otherwise confirm the no-op path).
4. Load `/blog`, `/blog/:slug`, `/rss.xml` logged out (no session) to confirm the routes are truly public.
5. Share a `/blog/:slug` link and confirm OG tags are present in page source (`view-source:` or `curl`).
