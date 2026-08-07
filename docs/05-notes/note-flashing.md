# remove note update flashing

Phase 1: Client-side keyed patching (no API changes)
Keep polling as-is, but replace full-list render with incremental patch logic.
Add a note map keyed by note_id in memory plus a cheap change signature per note using fields already returned by API:
last_modified_at, pinned, is_archived, attachment_count, content-derived preview text/image.
In loadNotes at notes.html:1885, after response:
Build nextOrder array of note ids from server order.
For each note:
If new id: create card node once and insert.
If existing and signature unchanged: do nothing.
If existing and signature changed: update only affected subnodes.
Remove nodes not present anymore.
Reorder only when needed using insertBefore with existing nodes.
Keep one delegated click handler on notes list container instead of rebinding per card each render.
Keep search bubble/input outside card patch area so focus and caret do not reset.

Phase 1b: Stabilize polling behavior
Add request sequencing so slower older poll responses cannot overwrite newer state.
Skip channel rerender on silent polls unless counts changed. Today loadNotes always calls renderNoteChannels in notes.html:1910.

Phase 2: Add conditional fetch (small backend change, big win)
On GET notes route notes.ts:244, return ETag for current query scope using max last_modified_at + total + filter params.
Client sends If-None-Match; on 304 do nothing.
This avoids even diff work when no changes.


Phase 3: Delta API for scale (optional but best long-term)
Extend list API and db layer:
Route in notes.ts:244
Query in notes.ts:102
Add since cursor support returning:
upserts, deleted_note_ids, next_cursor.
Important: hard delete exists in notes.ts:378, so you need delete tombstones to inform clients.
Add table note_change_log or note_delete_log via migration (schema base at schema.sql:156).
This approach handles true removals, archived scope transitions, and minimal payloads.