import { toFtsQuery } from '../utils/search.ts'
import type { Note, NoteChannel } from './types.ts'

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

export async function listNoteChannels(db: D1Database, userId: number): Promise<NoteChannel[]> {
    await ensureDefaultNoteChannel(db, userId)
    const result = await db
        .prepare('SELECT * FROM note_channels WHERE user_id = ? ORDER BY created_at ASC')
        .bind(userId)
        .all<NoteChannel>()
    return result.results
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

async function assertChannelOwnership(db: D1Database, userId: number, channelId: number): Promise<void> {
    const row = await db
        .prepare('SELECT id FROM note_channels WHERE id = ? AND user_id = ? LIMIT 1')
        .bind(channelId, userId)
        .first<{ id: number }>()

    if (!row) throw new Error('Note channel not found')
}

export async function listNotes(
    db: D1Database,
    opts: { user_id: number; channel_id: number; q?: string; limit?: number; before_id?: number; include_archived?: boolean },
): Promise<{ notes: Note[]; total: number }> {
    await assertChannelOwnership(db, opts.user_id, opts.channel_id)

    const q = opts.q?.trim() ?? ''
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200)
    const filters = ['n.user_id = ?', 'n.channel_id = ?', 'n.is_hidden = 0']
    const bindings: (string | number)[] = [opts.user_id, opts.channel_id]

    if (!opts.include_archived) {
        filters.push('n.is_archived = 0')
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
    const orderBy = 'n.pinned DESC, n.last_modified_at DESC, n.note_id DESC'

    const [listResult, countRow] = await Promise.all([
        db.prepare(`SELECT n.* ${from} WHERE ${where} ORDER BY ${orderBy} LIMIT ?`)
            .bind(...bindings, limit)
            .all<Note>(),
        db.prepare(`SELECT COUNT(*) AS cnt ${from} WHERE ${where}`)
            .bind(...bindings)
            .first<{ cnt: number }>(),
    ])

    return { notes: listResult.results, total: countRow?.cnt ?? 0 }
}

export async function getNoteById(db: D1Database, userId: number, noteId: number): Promise<Note | null> {
    const note = await db
        .prepare('SELECT * FROM notes WHERE note_id = ? AND user_id = ? LIMIT 1')
        .bind(noteId, userId)
        .first<Note>()
    return note ?? null
}

export async function createNote(db: D1Database, input: { user_id: number; channel_id: number; content: string }): Promise<Note> {
    const content = input.content.trim()
    if (!content) throw new Error('Note content is required')
    await assertChannelOwnership(db, input.user_id, input.channel_id)

    const created = await db
        .prepare(
            `INSERT INTO notes (user_id, channel_id, content)
             VALUES (?, ?, ?)
             RETURNING *`,
        )
        .bind(input.user_id, input.channel_id, content)
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