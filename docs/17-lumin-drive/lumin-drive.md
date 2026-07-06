# Lumin Drive V1 Plan

## Summary

Lumin Drive V1 should treat file blobs and Drive objects as separate concerns.

- `attachments` remains the shared file-object table for R2-backed blobs and file metadata.
- `attachment_list` remains the note-to-attachment junction table.
- `drive_items` becomes the Drive domain table for folders, files, tree structure, ownership, and lifecycle.
- `drive_list` becomes the Drive-to-attachment junction table when a Drive file references a stored blob.

This avoids overloading `attachments` with folder, path, sharing, and UI lifecycle concerns.

## V1 Goals

- Add a first-class `/drive` product surface.
- Reuse the existing R2 attachment pipeline where it makes sense.
- Allow the same stored file object to be used by Drive, Notes, or both.
- Keep Drive ownership, tree structure, and soft-delete behavior out of the raw blob table.
- Keep V1 scoped to core file management, not AI or public sharing.

## Recommended Data Model

### Keep `attachments` as the blob metadata table

Use `attachments` for physical file metadata only.

Recommended V1 columns to add to `attachments`:

- `owner_user_id INTEGER NOT NULL REFERENCES users(id)`
- `file_last_modified TEXT DEFAULT NULL`
- `file_category TEXT DEFAULT NULL`
- `file_etag TEXT DEFAULT NULL`
- `deleted_at TEXT DEFAULT NULL`

Keep existing columns such as:

- `filename`
- `content_type`
- `size`
- `url`
- `attachment_slug`
- `cache_version`
- `tag_list`
- `summary`
- `ai_tags`
- `ai_summary`
- `ai_processed_at`

Do not put these Drive-specific fields on `attachments` in V1:

- `drive_path`
- `parent_path`
- `is_public`
- share token fields

Those belong to the Drive object layer, not the shared blob layer.

### Add `drive_items`

`drive_items` is the canonical Drive table.

Suggested V1 shape:

```sql
CREATE TABLE drive_items (
  drive_item_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id       INTEGER REFERENCES drive_items(drive_item_id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('folder', 'file')),
  display_name    TEXT NOT NULL,
  is_public       INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  deleted_at      TEXT DEFAULT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

Notes:

- Folders are rows with `kind = 'folder'` and no linked attachment.
- Files are rows with `kind = 'file'` and one linked attachment.
- Path is derived from `parent_id` plus `display_name`, not stored as the primary source of truth.

### Add `drive_list`

`drive_list` links Drive file items to attachment rows.

Suggested V1 shape:

```sql
CREATE TABLE drive_list (
  drive_item_id   INTEGER NOT NULL REFERENCES drive_items(drive_item_id) ON DELETE CASCADE,
  attachment_id   INTEGER NOT NULL REFERENCES attachments(attachment_id) ON DELETE CASCADE,
  PRIMARY KEY (drive_item_id, attachment_id)
);
```

V1 rule:

- file rows in `drive_items` should link to exactly one attachment row
- folder rows should link to none

This keeps open the option to support aliases or reuse later without redesigning the schema.

## Why This Is Better Than `is_drive`

`is_drive` is a state flag, but Drive is a relationship and a domain model.

Problems with an `is_drive` approach:

- folders are not attachments
- note lifecycle and Drive lifecycle are different
- delete semantics become ambiguous when the same blob is used in both places
- path, visibility, and sharing are not blob metadata
- a tri-state flag like note-only, drive-only, both becomes hard to query and maintain

## Migration Policy Recommendation

### Canonical policy

Use Wrangler D1 migrations as the canonical source of schema history.

- New schema changes go in `migrations/`
- `schema.sql` remains a current snapshot of the latest full schema
- production and local incremental changes should be applied from migrations, not by executing `schema.sql` directly

### Why this matters

The repo currently has both:

- package scripts that apply `schema.sql` directly
- ad hoc SQL files under `migrations/`

That creates drift risk. Drive adds enough schema that this should be cleaned up before implementation starts.

### Recommended repo changes for migration policy

1. Adopt `migrations/` as the only place for incremental D1 changes.
2. Keep `schema.sql` updated after each migration batch so a new environment can still be bootstrapped easily.
3. Replace the current `db:migrate:local` and `db:migrate:remote` scripts with Wrangler migration commands.
4. Document the rule in `README.md`.

### Recommended first migration sequence

1. create `drive_items`
2. create `drive_list`
3. add V1 file metadata columns to `attachments`
4. backfill `owner_user_id` for note-owned attachments by joining through `attachment_list` and `notes`
5. add indexes after data backfill

## V1 Backend Plan

### Shared upload service

Extract the current note upload behavior into a shared upload utility.

Shared responsibilities:

- validate file size and MIME type
- generate R2 object key
- write file to R2
- persist `attachments` row
- persist `file_last_modified` when sent by the client
- persist `owner_user_id`
- return normalized attachment metadata

Consumers:

- Notes upload flow
- Drive upload flow

### Drive routes

Add a new router:

- `src/routes/drive.ts`

Mount it at:

- `/api/drive`

Recommended V1 endpoints:

- `GET /api/drive/tree?parent_id=` list folders and files for one level
- `POST /api/drive/folders` create folder
- `POST /api/drive/files` upload one file into a folder
- `PATCH /api/drive/items/:id` rename item or move item by changing `parent_id`
- `DELETE /api/drive/items/:id` soft delete a Drive item
- `GET /api/drive/search?q=` search by file or folder name
- `GET /api/drive/items/:id/download` issue an owner-only signed download URL for linked file rows

### Notes integration

V1 should support reusing the same attachment record in both systems.

Recommended behavior:

- standard note uploads still create an attachment and link it via `attachment_list`
- a Drive file upload creates an attachment and links it via `drive_list`
- attaching a Drive file to a note should add a row to `attachment_list`, not duplicate the R2 object
- blob deletion from R2 should only happen when the attachment is no longer referenced by either `attachment_list` or `drive_list`

## V1 UI Plan

### New page

Add a new page at:

- `/drive`

Add a new client HTML file:

- `src/client/drive.html`

Mount it in `src/index.ts` and add a suite-menu entry.

### Layout

Use the Settings page shell as the baseline layout pattern:

- left nav for Drive views
- right content area for the active panel

Recommended V1 views:

- My Drive tree
- Current folder contents
- Recent uploads
- Tag filter panel using existing `tag_list` and `ai_tags` where present

### V1 interactions

- drag and drop upload
- file input upload
- paste image upload when a folder view is active
- create folder
- rename
- move to folder
- soft delete
- download

### Non-goals for V1 UI

- public share management
- external-user access UI
- AI processing dashboards
- full Google Drive parity

## V1 Security Rules

- every `drive_items` row is owned by exactly one user
- every `attachments` row has exactly one `owner_user_id`
- V1 Drive APIs are owner-only
- `is_public` may exist on `drive_items`, but public access flows are deferred to V2
- all Drive CRUD routes must verify ownership before returning metadata or file access

## Search Plan

V1 search should be simple.

Search over:

- `drive_items.display_name`
- attachment `filename`
- optional existing `tag_list`

Do not block V1 on full-text extraction or content indexing.

## File Last Modified Plan

Client should append file modification time to `FormData`.

Example:

```js
const formData = new FormData();
formData.append('file', file);
formData.append('fileLastModified', String(file.lastModified));
```

Server behavior:

- accept `fileLastModified`
- validate it as a positive integer timestamp
- convert it to ISO 8601
- store it as `attachments.file_last_modified`

## Implementation Order

1. migration policy cleanup
2. add Drive schema migrations
3. update `schema.sql` snapshot
4. add shared upload utility
5. refactor notes upload flow to use shared upload utility
6. add `src/routes/drive.ts`
7. add `/drive` page and suite navigation entry
8. implement folder listing, upload, rename, move, and soft delete
9. implement note-to-Drive attachment reuse rules
10. manual validation with `bun run dev`

## V1 Out of Scope

Move these to V2:

- share tokens
- share token expiration and usage counters
- public downloads
- Drive AI queue and patch APIs
- external daemon integration
- advanced tag views driven by AI summaries
- path-based public URLs

## Open Questions Before Coding

- should a Drive file be attachable to more than one Drive item, or exactly one in V1? -> exactly one
- should note-created attachments appear in Drive automatically, or only when promoted into Drive? -> appear automatically in drive, but only in the attachments folder
- should deleting a Drive item hide the attachment from Notes if the file is shared across both systems? -> no, only hide from Drive
- should V1 support folder moves across arbitrary depth, or only one-level reparenting at first? -> only one-level reparenting
- should MIME restrictions for Drive be broader than note attachments? -> yes, allow any MIME type for Drive
