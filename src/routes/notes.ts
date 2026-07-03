import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import { authMiddleware } from '../middleware/authMiddleware.ts'
import {
    addNoteAttachment,
    appendAttachmentMarkdownToNote,
    createNote,
    createNoteChannel,
    deleteNoteWithAttachments,
    getAttachmentBySlugForUser,
    getAttachmentForDownload,
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
const MAX_ATTACHMENTS_PER_NOTE = 12
const DOWNLOAD_TOKEN_TTL_SECONDS = 300
const ATTACHMENT_SLUG_PATTERN = /^att_[a-f0-9]{32}$/

const ALLOWED_ATTACHMENT_TYPES: Record<string, string[]> = {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/webp': ['webp'],
    'image/gif': ['gif'],
    'application/pdf': ['pdf'],
    'text/plain': ['txt'],
    'text/markdown': ['md'],
    'text/csv': ['csv'],
}

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

function getExtension(filename: string): string {
    const idx = filename.lastIndexOf('.')
    if (idx < 0) return ''
    return filename.slice(idx + 1).toLowerCase()
}

function isAllowedAttachment(filename: string, contentType: string): boolean {
    const extension = getExtension(filename)
    if (!extension) return false
    const allowedExtensions = ALLOWED_ATTACHMENT_TYPES[contentType.toLowerCase()]
    if (!allowedExtensions) return false
    return allowedExtensions.includes(extension)
}

function isImageContentType(contentType: string): boolean {
    return contentType.toLowerCase().startsWith('image/')
}

function buildAttachmentPermalink(baseUrl: string, attachmentSlug: string): string {
    return new URL(`/api/notes/attachments/p/${attachmentSlug}`, baseUrl).toString()
}

function buildAttachmentMarkdown(filename: string, contentType: string, permalinkUrl: string): string {
    if (isImageContentType(contentType)) {
        return `![${filename}](${permalinkUrl})`
    }
    return `📄 [${filename}](${permalinkUrl})`
}

function encodeBase64Url(bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
}

async function signToken(secret: string, payload: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    return encodeBase64Url(new Uint8Array(sig))
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
    return diff === 0
}

async function createDownloadToken(secret: string, userId: number, noteId: number, attachmentId: number): Promise<{ token: string; exp: number }> {
    const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TOKEN_TTL_SECONDS
    const payload = `${userId}.${noteId}.${attachmentId}.${exp}`
    const signature = await signToken(secret, payload)
    return { token: `${payload}.${signature}`, exp }
}

async function verifyDownloadToken(secret: string, token: string): Promise<{ userId: number; noteId: number; attachmentId: number; exp: number } | null> {
    const parts = token.split('.')
    if (parts.length !== 5) return null
    const [userPart, notePart, attachmentPart, expPart, signaturePart] = parts

    const userId = parseInt(userPart, 10)
    const noteId = parseInt(notePart, 10)
    const attachmentId = parseInt(attachmentPart, 10)
    const exp = parseInt(expPart, 10)
    if (!Number.isInteger(userId) || !Number.isInteger(noteId) || !Number.isInteger(attachmentId) || !Number.isInteger(exp)) return null
    if (exp < Math.floor(Date.now() / 1000)) return null

    const payload = `${userId}.${noteId}.${attachmentId}.${exp}`
    const expectedSig = await signToken(secret, payload)
    const expectedBytes = decodeBase64Url(expectedSig)
    const actualBytes = decodeBase64Url(signaturePart)
    if (!timingSafeEqual(expectedBytes, actualBytes)) return null

    return { userId, noteId, attachmentId, exp }
}

notes.get('/attachments/download', async (c) => {
    const token = c.req.query('t')?.trim() ?? ''
    if (!token) return c.json({ error: 'Unauthorized' }, 401)
    if (!c.env.ATTACHMENTS) return c.json({ error: 'Attachments storage is not configured' }, 500)

    const parsed = await verifyDownloadToken(c.env.TOKEN_SECRET, token)
    if (!parsed) return c.json({ error: 'Unauthorized' }, 401)

    const attachment = await getAttachmentForDownload(c.env.DB, parsed.noteId, parsed.attachmentId)
    if (!attachment) return c.json({ error: 'Attachment not found' }, 404)
    if (attachment.owner_user_id !== parsed.userId) return c.json({ error: 'Unauthorized' }, 401)

    const object = await c.env.ATTACHMENTS.get(attachment.url)
    if (!object || !object.body) return c.json({ error: 'Attachment payload missing' }, 404)

    c.header('Content-Type', attachment.content_type || 'application/octet-stream')
    c.header('Content-Length', String(attachment.size))
    c.header('Content-Disposition', `attachment; filename="${attachment.filename.replace(/"/g, '')}"`)
    c.header('Cache-Control', 'private, max-age=60')
    return c.body(object.body)
})

notes.use('*', authMiddleware)

notes.get('/attachments/p/:slug', async (c) => {
    const user = c.get('user')
    const slug = (c.req.param('slug') ?? '').trim().toLowerCase()
    if (!ATTACHMENT_SLUG_PATTERN.test(slug)) return c.json({ error: 'Invalid attachment slug' }, 400)
    if (!c.env.ATTACHMENTS) return c.json({ error: 'Attachments storage is not configured' }, 500)

    const attachment = await getAttachmentBySlugForUser(c.env.DB, user.id, slug)
    if (!attachment) return c.json({ error: 'Attachment not found' }, 404)

    const object = await c.env.ATTACHMENTS.get(attachment.url)
    if (!object || !object.body) return c.json({ error: 'Attachment payload missing' }, 404)

    const etag = `"${attachment.attachment_slug}-${attachment.size}-${attachment.cache_version}"`
    c.header('Cache-Control', 'private, no-cache, must-revalidate, max-age=31536000')
    c.header('Vary', 'Authorization')
    c.header('ETag', etag)
    c.header('X-Robots-Tag', 'noindex, nofollow')

    const ifNoneMatch = c.req.header('if-none-match')
    if (ifNoneMatch && ifNoneMatch.split(',').map((v) => v.trim()).includes(etag)) {
        return c.body(null, 304)
    }

    c.header('Content-Type', attachment.content_type || 'application/octet-stream')
    c.header('Content-Length', String(attachment.size))
    c.header(
        'Content-Disposition',
        `${isImageContentType(attachment.content_type) ? 'inline' : 'attachment'}; filename="${attachment.filename.replace(/"/g, '')}"`,
    )
    return c.body(object.body)
})

notes.get('/channels', async (c) => {
    const user = c.get('user')
    const summary = await listNoteChannels(c.env.DB, user.id)
    return c.json({
        data: summary.channels,
        meta: {
            all_active_count: summary.all_active_count,
            archived_count: summary.archived_count,
        },
    })
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
    const rawChannelId = c.req.query('channel_id')?.trim() ?? ''
    const channelId = rawChannelId ? parseInt(rawChannelId, 10) : undefined
    if (rawChannelId && (!Number.isInteger(channelId) || (channelId as number) < 1)) {
        return c.json({ error: 'channel_id must be a positive integer' }, 400)
    }

    const q = c.req.query('q')?.trim() ?? ''
    const archivedQuery = (c.req.query('archived') ?? '').trim().toLowerCase()
    const archivedMode = archivedQuery === 'only'
        ? 'only'
        : archivedQuery === '1'
            ? 'include'
            : 'exclude'
    const beforeId = c.req.query('before_id') ? parseInt(c.req.query('before_id')!, 10) : undefined
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 200)

    try {
        const result = await listNotes(c.env.DB, {
            user_id: user.id,
            channel_id: channelId,
            q,
            archived_mode: archivedMode,
            before_id: beforeId,
            limit,
        })
        return c.json({
            data: result.notes,
            meta: {
                total: result.total,
                channel_id: channelId ?? null,
                q,
                archived: archivedMode,
                limit,
                before_id: beforeId ?? null,
            },
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

notes.delete('/:id', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)

    const note = await getNoteById(c.env.DB, user.id, id)
    if (!note) return c.json({ error: 'Note not found' }, 404)
    if (note.is_archived !== 1) return c.json({ error: 'Only archived notes can be deleted' }, 400)

    try {
        const deleted = await deleteNoteWithAttachments(c.env.DB, user.id, id)
        if (!deleted.noteDeleted) return c.json({ error: 'Note not found' }, 404)

        if (c.env.ATTACHMENTS) {
            for (const url of deleted.attachmentUrls) {
                try { await c.env.ATTACHMENTS.delete(url) } catch { /* ignore */ }
            }
        }

        return c.json({ data: { note_id: id, deleted: true } })
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400)
    }
})

notes.get('/:id/attachments', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)

    try {
        const data = (await listNoteAttachments(c.env.DB, user.id, id)).map((attachment) => {
            const permalink_url = buildAttachmentPermalink(c.req.url, attachment.attachment_slug)
            return {
                ...attachment,
                permalink_url,
                markdown: buildAttachmentMarkdown(attachment.filename, attachment.content_type, permalink_url),
            }
        })
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
    if (!isAllowedAttachment(filename, contentType)) {
        return c.json({ error: 'Attachment type is not allowed' }, 400)
    }

    const currentAttachments = await listNoteAttachments(c.env.DB, user.id, id)
    if (currentAttachments.length >= MAX_ATTACHMENTS_PER_NOTE) {
        return c.json({ error: `Maximum ${MAX_ATTACHMENTS_PER_NOTE} attachments per note` }, 400)
    }

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

        const permalink_url = buildAttachmentPermalink(c.req.url, attachment.attachment_slug)
        const markdown = buildAttachmentMarkdown(attachment.filename, attachment.content_type, permalink_url)
        const updatedNote = await appendAttachmentMarkdownToNote(c.env.DB, {
            user_id: user.id,
            note_id: id,
            markdown,
        })

        return c.json({
            data: {
                ...attachment,
                permalink_url,
                markdown,
            },
            note: updatedNote,
        }, 201)
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

notes.get('/:id/attachments/:attachmentId/access', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    const attachmentId = parseInt(c.req.param('attachmentId') ?? '', 10)

    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid note id' }, 400)
    if (!Number.isInteger(attachmentId) || attachmentId < 1) return c.json({ error: 'Invalid attachment id' }, 400)

    const attachment = await getNoteAttachment(c.env.DB, user.id, id, attachmentId)
    if (!attachment) return c.json({ error: 'Attachment not found' }, 404)

    const signed = await createDownloadToken(c.env.TOKEN_SECRET, user.id, id, attachmentId)
    const downloadUrl = new URL('/api/notes/attachments/download', c.req.url)
    downloadUrl.searchParams.set('t', signed.token)

    return c.json({
        data: {
            url: downloadUrl.toString(),
            permalink_url: buildAttachmentPermalink(c.req.url, attachment.attachment_slug),
            expires_at: new Date(signed.exp * 1000).toISOString(),
            attachment_id: attachmentId,
            filename: attachment.filename,
        },
    })
})

export default notes