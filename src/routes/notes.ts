import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import {
    addNoteAttachment,
    createNote,
    createNoteChannel,
    getNoteAttachment,
    getNoteById,
    listNoteAttachments,
    listNoteChannels,
    listNotes,
    moveNote,
    removeNoteAttachment,
    setNoteArchived,
    setNotePinned,
    updateNote,
} from '../db/notes.ts'

const notes = new Hono<{ Bindings: Env; Variables: Variables }>()

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

type UploadFileLike = {
    name: string
    type: string
    size: number
    stream: () => ReadableStream
}

function isUploadFileLike(value: unknown): value is UploadFileLike {
    return Boolean(
        value
        && typeof value === 'object'
        && typeof (value as UploadFileLike).name === 'string'
        && typeof (value as UploadFileLike).type === 'string'
        && typeof (value as UploadFileLike).size === 'number'
        && typeof (value as UploadFileLike).stream === 'function',
    )
}

function sanitizeFilename(filename: string): string {
    const cleaned = filename
        .replace(/[\\/]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160)

    return cleaned || 'attachment'
}

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

notes.get('/:id/attachments', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)

    try {
        const data = await listNoteAttachments(c.env.DB, user.id, id)
        return c.json({ data })
    } catch (err) {
        return c.json({ error: (err as Error).message }, 404)
    }
})

notes.post('/:id/attachments', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)

    if (!c.env.ATTACHMENTS) {
        return c.json({ error: 'Attachments storage is not configured' }, 500)
    }

    let form: FormData
    try {
        form = await c.req.formData()
    } catch {
        return c.json({ error: 'Expected multipart/form-data' }, 400)
    }

    const filePart = form.get('file')
    if (!isUploadFileLike(filePart)) return c.json({ error: 'file is required' }, 400)

    const filename = sanitizeFilename(filePart.name)
    const contentType = filePart.type || 'application/octet-stream'
    const size = filePart.size
    if (!size || size < 1) return c.json({ error: 'File is empty' }, 400)
    if (size > MAX_ATTACHMENT_BYTES) return c.json({ error: 'File exceeds 20MB limit' }, 400)

    const objectKey = `notes/${user.id}/${id}/${Date.now()}-${crypto.randomUUID()}-${filename}`

    try {
        await c.env.ATTACHMENTS.put(objectKey, filePart.stream(), {
            httpMetadata: { contentType },
            customMetadata: {
                noteId: String(id),
                userId: String(user.id),
                filename,
            },
        })

        const attachment = await addNoteAttachment(c.env.DB, {
            user_id: user.id,
            note_id: id,
            filename,
            content_type: contentType,
            size,
            url: objectKey,
        })

        return c.json({ data: attachment }, 201)
    } catch (err) {
        // Best-effort cleanup if DB insert fails after object upload.
        try { await c.env.ATTACHMENTS.delete(objectKey) } catch { /* ignore */ }
        return c.json({ error: (err as Error).message || 'Upload failed' }, 400)
    }
})

notes.delete('/:id/attachments/:attachmentId', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    const attachmentId = parseInt(c.req.param('attachmentId') ?? '', 10)

    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)
    if (!Number.isInteger(attachmentId) || attachmentId < 1) return c.json({ error: 'Invalid attachment id' }, 400)

    const deleted = await removeNoteAttachment(c.env.DB, {
        user_id: user.id,
        note_id: id,
        attachment_id: attachmentId,
    })
    if (!deleted) return c.json({ error: 'Attachment not found' }, 404)

    if (c.env.ATTACHMENTS) {
        try { await c.env.ATTACHMENTS.delete(deleted.url) } catch { /* ignore */ }
    }

    return c.json({ data: { attachment_id: attachmentId } })
})

notes.get('/:id/attachments/:attachmentId/download', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    const attachmentId = parseInt(c.req.param('attachmentId') ?? '', 10)

    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)
    if (!Number.isInteger(attachmentId) || attachmentId < 1) return c.json({ error: 'Invalid attachment id' }, 400)
    if (!c.env.ATTACHMENTS) return c.json({ error: 'Attachments storage is not configured' }, 500)

    const attachment = await getNoteAttachment(c.env.DB, user.id, id, attachmentId)
    if (!attachment) return c.json({ error: 'Attachment not found' }, 404)

    const object = await c.env.ATTACHMENTS.get(attachment.url)
    if (!object || !object.body) return c.json({ error: 'Attachment payload missing' }, 404)

    c.header('Content-Type', attachment.content_type || 'application/octet-stream')
    c.header('Content-Length', String(attachment.size))
    c.header('Content-Disposition', `inline; filename="${attachment.filename.replace(/"/g, '')}"`)
    c.header('Cache-Control', 'private, max-age=60')
    return c.body(object.body)
})

export default notes