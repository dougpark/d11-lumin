import { toFtsQuery } from '../utils/search.ts'
import { slugify } from '../utils/slug.ts'
import { countAttachmentReferences } from './drive.ts'
import type { Attachment, Note, NoteChannel } from './types.ts'

export type NoteChannelWithCounts = NoteChannel & {
    active_count: number
    archived_count: number
}

export type NoteChannelSummary = {
    channels: NoteChannelWithCounts[]
    all_active_count: number
    archived_count: number
}

function createAttachmentSlug(): string {
    return `att_${crypto.randomUUID().replace(/-/g, '').toLowerCase()}`
}

export async function ensureDefaultNoteChannel(db: D1Database, userId: number): Promise<NoteChannel> {
    const existing = await db
        .prepare('SELECT * FROM note_channels WHERE user_id = ? ORDER BY created_at ASC LIMIT 1')
        .bind(userId)
        .first<NoteChannel>()

    if (existing) return existing

    const created = await db
        .prepare(
            `INSERT INTO note_channels (user_id, name)
             VALUES (?, ?)
             RETURNING *`,
        )
        .bind(userId, 'My Notes')
        .first<NoteChannel>()

    if (!created) throw new Error('Failed to create default note channel')
    return created
}

export async function listNoteChannels(db: D1Database, userId: number): Promise<NoteChannelSummary> {
    await ensureDefaultNoteChannel(db, userId)

    const [channelsResult, totalsRow] = await Promise.all([
        db
            .prepare(
                `SELECT nc.*,
                        COALESCE(SUM(CASE WHEN n.is_hidden = 0 AND n.is_archived = 0 THEN 1 ELSE 0 END), 0) AS active_count,
                        COALESCE(SUM(CASE WHEN n.is_hidden = 0 AND n.is_archived = 1 THEN 1 ELSE 0 END), 0) AS archived_count
                 FROM note_channels nc
                 LEFT JOIN notes n ON n.channel_id = nc.id AND n.user_id = nc.user_id
                 WHERE nc.user_id = ?
                 GROUP BY nc.id
                 ORDER BY nc.created_at ASC`,
            )
            .bind(userId)
            .all<NoteChannelWithCounts>(),
        db
            .prepare(
                `SELECT
                    COALESCE(SUM(CASE WHEN is_hidden = 0 AND is_archived = 0 THEN 1 ELSE 0 END), 0) AS all_active_count,
                    COALESCE(SUM(CASE WHEN is_hidden = 0 AND is_archived = 1 THEN 1 ELSE 0 END), 0) AS archived_count
                 FROM notes
                 WHERE user_id = ?`,
            )
            .bind(userId)
            .first<{ all_active_count: number; archived_count: number }>(),
    ])

    return {
        channels: channelsResult.results,
        all_active_count: totalsRow?.all_active_count ?? 0,
        archived_count: totalsRow?.archived_count ?? 0,
    }
}

export async function createNoteChannel(db: D1Database, userId: number, name: string): Promise<NoteChannel> {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('Channel name is required')

    const created = await db
        .prepare(
            `INSERT INTO note_channels (user_id, name)
             VALUES (?, ?)
             RETURNING *`,
        )
        .bind(userId, cleanName)
        .first<NoteChannel>()

    if (!created) throw new Error('Failed to create note channel')
    return created
}

// Get-or-create by name — used for feature-specific channels (e.g. "Blog Link-List").
export async function ensureNoteChannelByName(db: D1Database, userId: number, name: string): Promise<NoteChannel> {
    const existing = await db
        .prepare('SELECT * FROM note_channels WHERE user_id = ? AND name = ? LIMIT 1')
        .bind(userId, name)
        .first<NoteChannel>()

    if (existing) return existing
    return createNoteChannel(db, userId, name)
}

async function assertChannelOwnership(db: D1Database, userId: number, channelId: number): Promise<void> {
    const row = await db
        .prepare('SELECT id FROM note_channels WHERE id = ? AND user_id = ? LIMIT 1')
        .bind(channelId, userId)
        .first<{ id: number }>()

    if (!row) throw new Error('Note channel not found')
}

export async function listNotes(
    db: D1Database,
    opts: {
        user_id: number
        channel_id?: number
        q?: string
        limit?: number
        before_id?: number
        archived_mode?: 'exclude' | 'include' | 'only'
    },
): Promise<{ notes: Note[]; total: number; max_last_modified_at: string | null }> {
    if (Number.isInteger(opts.channel_id) && (opts.channel_id as number) > 0) {
        await assertChannelOwnership(db, opts.user_id, opts.channel_id as number)
    }

    const q = opts.q?.trim() ?? ''
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200)
    const archivedMode = opts.archived_mode ?? 'exclude'
    const filters = ['n.user_id = ?', 'n.is_hidden = 0']
    const bindings: (string | number)[] = [opts.user_id]

    if (Number.isInteger(opts.channel_id) && (opts.channel_id as number) > 0) {
        filters.push('n.channel_id = ?')
        bindings.push(opts.channel_id as number)
    }

    if (archivedMode === 'exclude') {
        filters.push('n.is_archived = 0')
    } else if (archivedMode === 'only') {
        filters.push('n.is_archived = 1')
    }

    let from = 'FROM notes n'
    if (q) {
        from += ' JOIN notes_fts ON notes_fts.rowid = n.note_id'
        filters.push('notes_fts MATCH ?')
        bindings.push(toFtsQuery(q) ?? q)
    }

    if (opts.before_id) {
        filters.push('n.note_id < ?')
        bindings.push(opts.before_id)
    }

    const where = filters.join(' AND ')
    // Blog posts sort by their published_at (frozen at publish time, unaffected by later edits);
    // everything else (and blog posts that were never/un-published) falls back to last_modified_at.
    const orderBy = `n.pinned DESC, COALESCE(CASE WHEN n.is_blog = 1 THEN n.published_at END, n.last_modified_at) DESC, n.note_id DESC`

    const [listResult, countRow, maxModifiedRow] = await Promise.all([
        db.prepare(`SELECT n.* ${from} WHERE ${where} ORDER BY ${orderBy} LIMIT ?`)
            .bind(...bindings, limit)
            .all<Note>(),
        db.prepare(`SELECT COUNT(*) AS cnt ${from} WHERE ${where}`)
            .bind(...bindings)
            .first<{ cnt: number }>(),
        db.prepare(`SELECT MAX(n.last_modified_at) AS max_last_modified_at ${from} WHERE ${where}`)
            .bind(...bindings)
            .first<{ max_last_modified_at: string | null }>(),
    ])

    return {
        notes: listResult.results,
        total: countRow?.cnt ?? 0,
        max_last_modified_at: maxModifiedRow?.max_last_modified_at ?? null,
    }
}

export async function getNoteById(db: D1Database, userId: number, noteId: number): Promise<Note | null> {
    const note = await db
        .prepare('SELECT * FROM notes WHERE note_id = ? AND user_id = ? LIMIT 1')
        .bind(noteId, userId)
        .first<Note>()
    return note ?? null
}

export async function createNote(
    db: D1Database,
    input: { user_id: number; channel_id: number; content: string; created_at?: string },
): Promise<Note> {
    const content = input.content.trim()
    if (!content) throw new Error('Note content is required')
    await assertChannelOwnership(db, input.user_id, input.channel_id)

    // created_at override lets copied content (e.g. bookmark → blog draft) preserve its original date.
    const created = await db
        .prepare(
            input.created_at
                ? `INSERT INTO notes (user_id, channel_id, content, created_at)
                   VALUES (?, ?, ?, ?)
                   RETURNING *`
                : `INSERT INTO notes (user_id, channel_id, content)
                   VALUES (?, ?, ?)
                   RETURNING *`,
        )
        .bind(...(input.created_at
            ? [input.user_id, input.channel_id, content, input.created_at]
            : [input.user_id, input.channel_id, content]))
        .first<Note>()

    if (!created) throw new Error('Failed to create note')

    await db.prepare(
        `UPDATE note_channels
         SET last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ? AND user_id = ?`,
    ).bind(input.channel_id, input.user_id).run()

    return created
}

export async function updateNote(db: D1Database, input: { user_id: number; note_id: number; content: string }): Promise<Note | null> {
    const content = input.content.trim()
    if (!content) throw new Error('Note content is required')

    const updated = await db
        .prepare(
            `UPDATE notes
             SET content = ?, last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE note_id = ? AND user_id = ?
             RETURNING *`,
        )
        .bind(content, input.note_id, input.user_id)
        .first<Note>()

    return updated ?? null
}

// ─── Blog metadata (title/tags/excerpt/slug) ───────────────────────────────

async function isSlugAvailable(db: D1Database, slug: string, excludeNoteId: number): Promise<boolean> {
    const row = await db
        .prepare('SELECT note_id FROM notes WHERE slug = ? AND note_id != ? LIMIT 1')
        .bind(slug, excludeNoteId)
        .first<{ note_id: number }>()
    return !row
}

// Slugs are global (blog is a single shared feed, not per-user) — appends -2, -3, ... on collision.
export async function generateUniqueSlug(db: D1Database, title: string, noteId: number): Promise<string> {
    const base = slugify(title)
    let candidate = base
    let attempt = 1
    while (!(await isSlugAvailable(db, candidate, noteId))) {
        attempt += 1
        candidate = `${base}-${attempt}`
    }
    return candidate
}

export async function listNoteTags(db: D1Database, userId: number): Promise<string[]> {
    const result = await db
        .prepare(
            `SELECT DISTINCT value AS tag
             FROM notes, json_each(notes.tag_list)
             WHERE notes.user_id = ? AND TRIM(value) != ''
             ORDER BY tag ASC`,
        )
        .bind(userId)
        .all<{ tag: string }>()
    return result.results.map((row) => row.tag)
}

export async function updateNoteMetadata(
    db: D1Database,
    input: {
        user_id: number
        note_id: number
        title?: string
        tag_list?: string[]
        excerpt?: string
        slug?: string
        published_at?: string | null
    },
): Promise<Note | null> {
    const note = await getNoteById(db, input.user_id, input.note_id)
    if (!note) return null

    const title = input.title !== undefined ? input.title.trim().slice(0, 200) : note.title
    const excerpt = input.excerpt !== undefined ? input.excerpt.trim().slice(0, 300) : note.excerpt
    const tagList = input.tag_list !== undefined ? JSON.stringify(input.tag_list) : note.tag_list
    // published_at is only touched here on an explicit user edit — never auto-stamped.
    const publishedAt = input.published_at !== undefined ? input.published_at : note.published_at

    let slug = note.slug
    if (input.slug !== undefined) {
        const requested = slugify(input.slug.trim() || title || 'post')
        if (!(await isSlugAvailable(db, requested, input.note_id))) {
            throw new Error(`Slug "${requested}" is already in use`)
        }
        slug = requested
    }

    const updated = await db
        .prepare(
            `UPDATE notes
             SET title = ?, excerpt = ?, tag_list = ?, slug = ?, published_at = ?, last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE note_id = ? AND user_id = ?
             RETURNING *`,
        )
        .bind(title, excerpt, tagList, slug, publishedAt, input.note_id, input.user_id)
        .first<Note>()

    return updated ?? null
}

// Pure DB state transition for the blog publish toggle — R2 sync + cache purge is
// orchestrated by the route handler (src/routes/notes.ts), which calls this after/before I/O.
export async function setNoteBlogFlags(
    db: D1Database,
    input: { user_id: number; note_id: number; is_blog: boolean; is_published: boolean },
): Promise<Note | null> {
    const note = await getNoteById(db, input.user_id, input.note_id)
    if (!note) return null

    let slug = note.slug
    if (input.is_blog && !slug) {
        slug = await generateUniqueSlug(db, note.title || `note-${input.note_id}`, input.note_id)
    }

    // published_at is set once on first publish and preserved afterwards (represents "first published").
    const shouldStampPublishedAt = input.is_blog && input.is_published && !note.published_at

    const updated = await db
        .prepare(
            `UPDATE notes
             SET is_blog = ?, is_published = ?, slug = ?,
                 published_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ELSE published_at END,
                 last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE note_id = ? AND user_id = ?
             RETURNING *`,
        )
        .bind(input.is_blog ? 1 : 0, input.is_published ? 1 : 0, slug, shouldStampPublishedAt ? 1 : 0, input.note_id, input.user_id)
        .first<Note>()

    return updated ?? null
}

export async function setAttachmentCdnInfo(
    db: D1Database,
    attachmentId: number,
    info: { cdn_key: string | null; cdn_url: string | null },
): Promise<void> {
    await db
        .prepare('UPDATE attachments SET cdn_key = ?, cdn_url = ? WHERE attachment_id = ?')
        .bind(info.cdn_key, info.cdn_url, attachmentId)
        .run()
}

export async function moveNote(db: D1Database, input: { user_id: number; note_id: number; channel_id: number }): Promise<Note | null> {
    await assertChannelOwnership(db, input.user_id, input.channel_id)
    const updated = await db
        .prepare(
            `UPDATE notes
             SET channel_id = ?, last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE note_id = ? AND user_id = ?
             RETURNING *`,
        )
        .bind(input.channel_id, input.note_id, input.user_id)
        .first<Note>()
    return updated ?? null
}

export async function setNotePinned(db: D1Database, input: { user_id: number; note_id: number; pinned: boolean }): Promise<Note | null> {
    const updated = await db
        .prepare(
            `UPDATE notes
             SET pinned = ?, last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE note_id = ? AND user_id = ?
             RETURNING *`,
        )
        .bind(input.pinned ? 1 : 0, input.note_id, input.user_id)
        .first<Note>()
    return updated ?? null
}

export async function setNoteArchived(db: D1Database, input: { user_id: number; note_id: number; is_archived: boolean }): Promise<Note | null> {
    const updated = await db
        .prepare(
            `UPDATE notes
             SET is_archived = ?, last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE note_id = ? AND user_id = ?
             RETURNING *`,
        )
        .bind(input.is_archived ? 1 : 0, input.note_id, input.user_id)
        .first<Note>()
    return updated ?? null
}

export async function listNoteAttachments(db: D1Database, userId: number, noteId: number): Promise<Attachment[]> {
    const note = await getNoteById(db, userId, noteId)
    if (!note) throw new Error('Note not found')

    const result = await db
        .prepare(
            `SELECT a.*
             FROM attachment_list al
             JOIN attachments a ON a.attachment_id = al.attachment_id
             WHERE al.note_id = ?
             ORDER BY al.sort_order ASC, a.attachment_id ASC`,
        )
        .bind(noteId)
        .all<Attachment>()

    return result.results
}

export async function addNoteAttachment(
    db: D1Database,
    input: {
        user_id: number
        note_id: number
        filename: string
        content_type: string
        size: number
        url: string
        file_last_modified?: string | null
        file_etag?: string | null
    },
): Promise<Attachment> {
    const note = await getNoteById(db, input.user_id, input.note_id)
    if (!note) throw new Error('Note not found')

    let created: Attachment | null = null
    let attempts = 0
    while (!created && attempts < 3) {
        attempts += 1
        const slug = createAttachmentSlug()
        try {
            created = await db
                .prepare(
                    `INSERT INTO attachments (
                        attachment_slug, owner_user_id, filename, content_type, size, url, file_last_modified, file_etag
                    )
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     RETURNING *`,
                )
                .bind(
                    slug,
                    input.user_id,
                    input.filename,
                    input.content_type,
                    input.size,
                    input.url,
                    input.file_last_modified ?? null,
                    input.file_etag ?? null,
                )
                .first<Attachment>()
        } catch (err) {
            const message = (err as Error).message || ''
            if (!message.includes('attachments.attachment_slug')) throw err
        }
    }

    if (!created) throw new Error('Failed to create attachment record')

    const maxRow = await db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM attachment_list WHERE note_id = ?')
        .bind(input.note_id)
        .first<{ max_sort: number }>()

    const nextSort = (maxRow?.max_sort ?? -1) + 1

    await db
        .prepare(
            `INSERT INTO attachment_list (note_id, sort_order, attachment_id)
             VALUES (?, ?, ?)`,
        )
        .bind(input.note_id, nextSort, created.attachment_id)
        .run()

    await db
        .prepare(
            `UPDATE notes
             SET attachment_count = (
               SELECT COUNT(*) FROM attachment_list WHERE note_id = ?
             ),
             last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE note_id = ? AND user_id = ?`,
        )
        .bind(input.note_id, input.note_id, input.user_id)
        .run()

    return created
}

export async function getNoteAttachment(db: D1Database, userId: number, noteId: number, attachmentId: number): Promise<Attachment | null> {
    const note = await getNoteById(db, userId, noteId)
    if (!note) return null

    const attachment = await db
        .prepare(
            `SELECT a.*
             FROM attachment_list al
             JOIN attachments a ON a.attachment_id = al.attachment_id
             WHERE al.note_id = ? AND a.attachment_id = ?
             LIMIT 1`,
        )
        .bind(noteId, attachmentId)
        .first<Attachment>()

    return attachment ?? null
}

export async function removeNoteAttachment(
    db: D1Database,
    input: { user_id: number; note_id: number; attachment_id: number },
): Promise<{ attachment: Attachment; should_delete_object: boolean } | null> {
    const attachment = await getNoteAttachment(db, input.user_id, input.note_id, input.attachment_id)
    if (!attachment) return null

    await db
        .prepare('DELETE FROM attachment_list WHERE note_id = ? AND attachment_id = ?')
        .bind(input.note_id, input.attachment_id)
        .run()

    const refsRemaining = await countAttachmentReferences(db, input.attachment_id)
    let shouldDeleteObject = false
    if (refsRemaining === 0) {
        await db
            .prepare('DELETE FROM attachments WHERE attachment_id = ?')
            .bind(input.attachment_id)
            .run()
        shouldDeleteObject = true
    }

    await db
        .prepare(
            `UPDATE notes
             SET attachment_count = (
               SELECT COUNT(*) FROM attachment_list WHERE note_id = ?
             ),
             last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE note_id = ? AND user_id = ?`,
        )
        .bind(input.note_id, input.note_id, input.user_id)
        .run()

    return { attachment, should_delete_object: shouldDeleteObject }
}

export async function deleteNoteWithAttachments(
    db: D1Database,
    userId: number,
    noteId: number,
): Promise<{ noteDeleted: boolean; attachmentUrls: string[] }> {
    const note = await getNoteById(db, userId, noteId)
    if (!note) return { noteDeleted: false, attachmentUrls: [] }

    const attachments = await db
        .prepare(
            `SELECT a.attachment_id, a.url
             FROM attachment_list al
             JOIN attachments a ON a.attachment_id = al.attachment_id
             WHERE al.note_id = ?`,
        )
        .bind(noteId)
        .all<{ attachment_id: number; url: string }>()

    const attachmentIds = attachments.results.map((attachment) => attachment.attachment_id)
    const attachmentUrlById = new Map(attachments.results.map((attachment) => [attachment.attachment_id, attachment.url]))
    const deletableUrls: string[] = []

    await db.prepare('DELETE FROM attachment_list WHERE note_id = ?').bind(noteId).run()
    for (const attachmentId of attachmentIds) {
        const refsRemaining = await countAttachmentReferences(db, attachmentId)
        if (refsRemaining === 0) {
            await db.prepare('DELETE FROM attachments WHERE attachment_id = ?').bind(attachmentId).run()
            const url = attachmentUrlById.get(attachmentId)
            if (typeof url === 'string' && url) deletableUrls.push(url)
        }
    }
    await db.prepare('DELETE FROM notes WHERE note_id = ? AND user_id = ?').bind(noteId, userId).run()

    return { noteDeleted: true, attachmentUrls: deletableUrls }
}

export async function getAttachmentForDownload(db: D1Database, noteId: number, attachmentId: number): Promise<(Attachment & { owner_user_id: number }) | null> {
    const attachment = await db
        .prepare(
            `SELECT a.*, n.user_id AS owner_user_id
             FROM attachment_list al
             JOIN attachments a ON a.attachment_id = al.attachment_id
             JOIN notes n ON n.note_id = al.note_id
             WHERE al.note_id = ? AND a.attachment_id = ?
             LIMIT 1`,
        )
        .bind(noteId, attachmentId)
        .first<Attachment & { owner_user_id: number }>()

    return attachment ?? null
}

export async function getAttachmentBySlugForUser(
    db: D1Database,
    userId: number,
    attachmentSlug: string,
): Promise<(Attachment & { owner_user_id: number; note_id: number }) | null> {
    const attachment = await db
        .prepare(
            `SELECT a.*, n.user_id AS owner_user_id, n.note_id AS note_id
             FROM attachments a
             JOIN attachment_list al ON al.attachment_id = a.attachment_id
             JOIN notes n ON n.note_id = al.note_id
             WHERE a.attachment_slug = ? AND n.user_id = ?
             LIMIT 1`,
        )
        .bind(attachmentSlug, userId)
        .first<Attachment & { owner_user_id: number; note_id: number }>()

    return attachment ?? null
}

export async function appendAttachmentMarkdownToNote(
    db: D1Database,
    input: { user_id: number; note_id: number; markdown: string },
): Promise<Note | null> {
    const updated = await db
        .prepare(
            `UPDATE notes
             SET content = CASE
                 WHEN TRIM(content) = '' THEN ?
                 ELSE content || '\n' || ?
             END,
             last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE note_id = ? AND user_id = ?
             RETURNING *`,
        )
        .bind(input.markdown, input.markdown, input.note_id, input.user_id)
        .first<Note>()

    return updated ?? null
}