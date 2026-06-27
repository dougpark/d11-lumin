import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import {
    createNote,
    createNoteChannel,
    getNoteById,
    listNoteChannels,
    listNotes,
    moveNote,
    setNoteArchived,
    setNotePinned,
    updateNote,
} from '../db/notes.ts'

const notes = new Hono<{ Bindings: Env; Variables: Variables }>()

notes.get('/channels', async (c) => {
    const user = c.get('user')
    const data = await listNoteChannels(c.env.DB, user.id)
    return c.json({ data })
})

notes.post('/channels', async (c) => {
    const user = c.get('user')
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)

    const name = typeof (body as Record<string, unknown>).name === 'string'
        ? (body as Record<string, unknown>).name as string
        : ''

    try {
        const created = await createNoteChannel(c.env.DB, user.id, name)
        return c.json({ data: created }, 201)
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400)
    }
})

notes.get('/', async (c) => {
    const user = c.get('user')
    const channelId = parseInt(c.req.query('channel_id') ?? '', 10)
    if (!Number.isInteger(channelId) || channelId < 1) return c.json({ error: 'channel_id is required' }, 400)

    const q = c.req.query('q')?.trim() ?? ''
    const includeArchived = c.req.query('archived') === '1'
    const beforeId = c.req.query('before_id') ? parseInt(c.req.query('before_id')!, 10) : undefined
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 200)

    try {
        const result = await listNotes(c.env.DB, {
            user_id: user.id,
            channel_id: channelId,
            q,
            include_archived: includeArchived,
            before_id: beforeId,
            limit,
        })
        return c.json({
            data: result.notes,
            meta: { total: result.total, channel_id: channelId, q, archived: includeArchived ? 1 : 0, limit, before_id: beforeId ?? null },
        })
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400)
    }
})

notes.get('/:id', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)

    const note = await getNoteById(c.env.DB, user.id, id)
    if (!note) return c.json({ error: 'Note not found' }, 404)
    return c.json({ data: note })
})

notes.post('/', async (c) => {
    const user = c.get('user')
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)

    const payload = body as Record<string, unknown>
    const channel_id = typeof payload.channel_id === 'number' ? payload.channel_id : NaN
    const content = typeof payload.content === 'string' ? payload.content : ''
    if (!Number.isInteger(channel_id) || channel_id < 1) return c.json({ error: 'channel_id is required' }, 400)

    try {
        const created = await createNote(c.env.DB, { user_id: user.id, channel_id, content })
        return c.json({ data: created }, 201)
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400)
    }
})

notes.patch('/:id', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)

    const content = typeof (body as Record<string, unknown>).content === 'string' ? (body as Record<string, unknown>).content as string : ''

    try {
        const updated = await updateNote(c.env.DB, { user_id: user.id, note_id: id, content })
        if (!updated) return c.json({ error: 'Note not found' }, 404)
        return c.json({ data: updated })
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400)
    }
})

notes.post('/:id/move', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)
    const channel_id = typeof (body as Record<string, unknown>).channel_id === 'number' ? (body as Record<string, unknown>).channel_id as number : NaN
    if (!Number.isInteger(channel_id) || channel_id < 1) return c.json({ error: 'channel_id is required' }, 400)

    try {
        const updated = await moveNote(c.env.DB, { user_id: user.id, note_id: id, channel_id })
        if (!updated) return c.json({ error: 'Note not found' }, 404)
        return c.json({ data: updated })
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400)
    }
})

notes.post('/:id/pin', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)
    const pinned = (body as Record<string, unknown>).pinned
    if (pinned !== true && pinned !== false) return c.json({ error: 'pinned must be true or false' }, 400)

    const updated = await setNotePinned(c.env.DB, { user_id: user.id, note_id: id, pinned })
    if (!updated) return c.json({ error: 'Note not found' }, 404)
    return c.json({ data: updated })
})

notes.post('/:id/archive', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)
    const is_archived = (body as Record<string, unknown>).is_archived
    if (is_archived !== true && is_archived !== false) return c.json({ error: 'is_archived must be true or false' }, 400)

    const updated = await setNoteArchived(c.env.DB, { user_id: user.id, note_id: id, is_archived })
    if (!updated) return c.json({ error: 'Note not found' }, 404)
    return c.json({ data: updated })
})

export default notes