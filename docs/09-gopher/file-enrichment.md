# AI Enrichment for File Objects

## Summary
Lumin now extends the AI daemon API to include file objects from the attachments table.

- Queue endpoint supports a new source type: file.
- Patch endpoint supports writing AI output back for files.
- File queue items include an expiring signed download URL for gopher processing.

## Security Model

- Existing named API tokens are used for queue and patch requests.
- New scope for files: ai:process:files.
- Legacy ai:process scope is accepted and grants access to rss, bookmarks, and file.
- The file payload includes a short-lived signed URL, so gopher can fetch file bytes without a session cookie.

## Endpoints

### GET /api/ai/queue

Query params:

- source: rss | bookmarks | file | all
- limit: 1 to 50
- offset: 0+
- force: true to include already-processed items

When source includes file, each file item includes:

```json
{
  "source": "file",
  "file_id": "att_...",
  "file_name": "Quarterly Report.pdf",
  "file_type": "application/pdf",
  "file_size": 834219,
  "file_path": "https://.../api/ai/files/download?t=...",
  "tags": ["finance", "q2"],
  "summary": "Uploaded report for Q2 financials",
  "created_at": "2026-07-08T05:12:21Z",
  "context": {
    "owner_user_id": 3,
    "attachment_id": 42
  }
}
```

Notes:

- file_id maps to attachments.attachment_slug.
- Unprocessed file logic uses attachments.ai_processed_at IS NULL.

### GET /api/ai/files/download?t=...

Token-auth download endpoint used by file_path.

- No API token header required.
- Token is signed and expires.
- Returns file stream from R2 for the matching attachment.

### PATCH /api/ai/items

Supports mixed batches for rss, bookmark, and file.

File item patch format:

```json
{
  "source": "file",
  "file_id": "att_...",
  "ai_tags": ["invoice", "accounting"],
  "ai_summary": "Vendor invoice for May services"
}
```

Writeback target for source=file:

- attachments.ai_tags
- attachments.ai_summary
- attachments.ai_processed_at

## D1 Table and Indexes

File AI enrichment state is stored on attachments:

- ai_tags
- ai_summary
- ai_processed_at

Queue performance indexes:

- idx_attachments_ai_processed_at
- idx_attachments_queue_pending (deleted_at, ai_processed_at, created_at)

## Gopher Processing Guidance

Gopher should use file metadata to decide whether to process a file:

- file_type (content type)
- file_size
- file_name
- tags and summary (existing user-provided metadata)
- file_path (signed URL for byte access)

If file type or size is unsupported, gopher should skip the item and avoid PATCH for that file.