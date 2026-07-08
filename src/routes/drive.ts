import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import { authMiddleware } from '../middleware/authMiddleware.ts'
import {
    createAttachmentForUser,
    createDriveFile,
    createDriveFolder,
    getDriveAttachmentInfoByAttachmentId,
    getDriveAttachmentInfoByDriveItemId,
    getDriveDownloadRecord,
    getDriveItemById,
    listDriveAttachPickerItems,
    listAttachmentShelf,
    listDriveChildren,
    patchDriveItem,
    searchDriveItems,
    softDeleteDriveItem,
    updateDriveAttachmentInspectorByAttachmentId,
    updateDriveAttachmentInspectorByDriveItemId,
} from '../db/drive.ts'
import { appendAttachmentMarkdownToNote } from '../db/notes.ts'

const drive = new Hono<{ Bindings: Env; Variables: Variables }>()

const MAX_DRIVE_UPLOAD_BYTES = 100 * 1024 * 1024
const DOWNLOAD_TOKEN_TTL_SECONDS = 300

function parseJsonArrayField(raw: string | null | undefined): string[] {
    if (typeof raw !== 'string' || !raw.trim()) return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
    } catch {
        return []
    }
}

function serializeDriveAttachmentInfo(info: Awaited<ReturnType<typeof getDriveAttachmentInfoByAttachmentId>>) {
    if (!info) return null
    return {
        ...info,
        tag_list: parseJsonArrayField(info.tag_list),
        ai_tags: parseJsonArrayField(info.ai_tags),
    }
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
        .slice(0, 180)
    return cleaned || 'file'
}

function escapeMarkdownLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

function buildDriveAttachmentMarkdown(filename: string, contentType: string, url: string): string {
    const label = escapeMarkdownLabel(filename || 'file')
    if (contentType.toLowerCase().startsWith('image/')) {
        return `![${label}](${url})`
    }
    return `📄 [${label}](${url})`
}

function buildNoteAttachmentPermalink(baseUrl: string, attachmentSlug: string): string {
    return new URL(`/api/notes/attachments/p/${attachmentSlug}`, baseUrl).toString()
}

function getTokenSecret(secret: string | undefined | null): string | null {
    if (typeof secret !== 'string') return null
    const normalized = secret.trim()
    return normalized.length > 0 ? normalized : null
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

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
    return diff === 0
}

async function signToken(secret: string, payload: string): Promise<string> {
    const normalizedSecret = getTokenSecret(secret)
    if (!normalizedSecret) throw new Error('TOKEN_SECRET is not configured')

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(normalizedSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    return encodeBase64Url(new Uint8Array(sig))
}

async function createDownloadToken(secret: string, userId: number, driveItemId: number): Promise<{ token: string; exp: number }> {
    const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TOKEN_TTL_SECONDS
    const payload = `${userId}.${driveItemId}.${exp}`
    const signature = await signToken(secret, payload)
    return { token: `${payload}.${signature}`, exp }
}

async function verifyDownloadToken(secret: string, token: string): Promise<{ userId: number; driveItemId: number; exp: number } | null> {
    const parts = token.split('.')
    if (parts.length !== 4) return null
    const [userPart, itemPart, expPart, signaturePart] = parts

    const userId = parseInt(userPart, 10)
    const driveItemId = parseInt(itemPart, 10)
    const exp = parseInt(expPart, 10)
    if (!Number.isInteger(userId) || !Number.isInteger(driveItemId) || !Number.isInteger(exp)) return null
    if (exp < Math.floor(Date.now() / 1000)) return null

    const payload = `${userId}.${driveItemId}.${exp}`
    const expectedSig = await signToken(secret, payload)
    const expectedBytes = decodeBase64Url(expectedSig)
    const actualBytes = decodeBase64Url(signaturePart)
    if (!timingSafeEqual(expectedBytes, actualBytes)) return null

    return { userId, driveItemId, exp }
}

function parseParentIdParam(raw: string | null | undefined): number | null {
    if (typeof raw !== 'string') return null
    const trimmed = raw.trim().toLowerCase()
    if (!trimmed || trimmed === 'root' || trimmed === 'null') return null
    const parsed = parseInt(trimmed, 10)
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error('Invalid parent_id')
    return parsed
}

// Signed download endpoint (token-auth only)
drive.get('/download', async (c) => {
    const token = c.req.query('t')?.trim() ?? ''
    if (!token) return c.json({ error: 'Unauthorized' }, 401)
    if (!c.env.ATTACHMENTS) return c.json({ error: 'Attachments storage is not configured' }, 500)

    const tokenSecret = getTokenSecret(c.env.TOKEN_SECRET)
    if (!tokenSecret) return c.json({ error: 'Attachment signing is not configured' }, 500)

    const parsed = await verifyDownloadToken(tokenSecret, token)
    if (!parsed) return c.json({ error: 'Unauthorized' }, 401)

    const item = await getDriveDownloadRecord(c.env.DB, parsed.userId, parsed.driveItemId)
    if (!item) return c.json({ error: 'File not found' }, 404)

    const object = await c.env.ATTACHMENTS.get(item.url)
    if (!object || !object.body) return c.json({ error: 'Attachment payload missing' }, 404)

    const inline = c.req.query('inline') === '1'
    const safeFilename = (item.filename || 'download').replace(/"/g, '')

    c.header('Content-Type', item.content_type || 'application/octet-stream')
    c.header('Content-Length', String(item.size ?? 0))
    c.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeFilename}"`)
    c.header('Cache-Control', 'private, max-age=60')
    return c.body(object.body)
})

drive.use('*', authMiddleware)

drive.get('/tree', async (c) => {
    const user = c.get('user')
    const parentRaw = c.req.query('parent_id')?.trim()

    if (parentRaw === 'attachments') {
        const items = await listAttachmentShelf(c.env.DB, user.id)
        return c.json({
            data: items.map((item) => ({
                source: 'attachment',
                attachment_id: item.attachment_id,
                drive_item_id: item.linked_drive_item_id,
                kind: 'file',
                display_name: item.filename,
                content_type: item.content_type,
                size: item.size,
                created_at: item.created_at,
                attachment_slug: item.attachment_slug,
                tag_list: parseJsonArrayField(item.tag_list),
                summary: item.summary,
                ai_tags: parseJsonArrayField(item.ai_tags),
                ai_summary: item.ai_summary,
                note_ref_count: item.note_ref_count,
                is_attached_to_note: item.note_ref_count > 0 ? 1 : 0,
            })),
            parent_id: 'attachments',
        })
    }

    let parentId: number | null
    try {
        parentId = parseParentIdParam(parentRaw)
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400)
    }

    const items = await listDriveChildren(c.env.DB, user.id, parentId)
    const data: Array<Record<string, unknown>> = items.map((item) => ({ ...item, source: 'drive' }))

    if (parentId === null) {
        data.unshift({
            source: 'virtual',
            drive_item_id: 0,
            user_id: user.id,
            parent_id: null,
            kind: 'folder',
            display_name: 'Attachments',
            is_public: 0,
            deleted_at: null,
            created_at: new Date(0).toISOString(),
            updated_at: new Date(0).toISOString(),
            attachment_id: null,
            attachment_slug: null,
            filename: null,
            content_type: null,
            size: null,
            virtual_key: 'attachments',
        })
    }

    return c.json({ data, parent_id: parentId })
})

drive.post('/folders', async (c) => {
    const user = c.get('user')

    let body: { parent_id?: number | null; display_name?: string }
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const displayName = (body.display_name || '').trim()
    if (!displayName) return c.json({ error: 'display_name is required' }, 400)

    let parentId: number | null = null
    if (body.parent_id !== undefined && body.parent_id !== null) {
        if (!Number.isInteger(body.parent_id) || body.parent_id < 1) return c.json({ error: 'Invalid parent_id' }, 400)
        parentId = body.parent_id
    }

    try {
        const created = await createDriveFolder(c.env.DB, user.id, { parent_id: parentId, display_name: displayName })
        return c.json({ data: created }, 201)
    } catch (err) {
        return c.json({ error: (err as Error).message || 'Failed to create folder' }, 400)
    }
})

drive.post('/files', async (c) => {
    const user = c.get('user')
    if (!c.env.ATTACHMENTS) return c.json({ error: 'Attachments storage is not configured' }, 500)

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
    if (size > MAX_DRIVE_UPLOAD_BYTES) return c.json({ error: 'File exceeds 100MB limit' }, 400)

    let parentId: number | null
    try {
        parentId = parseParentIdParam((form.get('parent_id') as string | null) ?? null)
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400)
    }

    const fileLastModifiedRaw = form.get('fileLastModified')
    let fileLastModified: string | null = null
    if (typeof fileLastModifiedRaw === 'string' && fileLastModifiedRaw.trim()) {
        const parsedMs = parseInt(fileLastModifiedRaw, 10)
        if (Number.isInteger(parsedMs) && parsedMs > 0) {
            fileLastModified = new Date(parsedMs).toISOString()
        }
    }

    const objectKey = `drive/${user.id}/${Date.now()}-${crypto.randomUUID()}-${filename}`

    try {
        await c.env.ATTACHMENTS.put(objectKey, filePart.stream(), {
            httpMetadata: { contentType },
            customMetadata: {
                userId: String(user.id),
                filename,
            },
        })

        const attachment = await createAttachmentForUser(c.env.DB, {
            user_id: user.id,
            filename,
            content_type: contentType,
            size,
            url: objectKey,
            file_last_modified: fileLastModified,
            file_etag: null,
        })

        const driveItem = await createDriveFile(c.env.DB, user.id, {
            parent_id: parentId,
            display_name: filename,
            attachment_id: attachment.attachment_id,
        })

        return c.json({ data: { drive_item: driveItem, attachment } }, 201)
    } catch (err) {
        try { await c.env.ATTACHMENTS.delete(objectKey) } catch { /* ignore */ }
        return c.json({ error: (err as Error).message || 'Upload failed' }, 400)
    }
})

drive.patch('/items/:id', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid item id' }, 400)

    let body: { display_name?: string; parent_id?: number | null }
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    try {
        const updated = await patchDriveItem(c.env.DB, user.id, id, {
            display_name: body.display_name,
            parent_id: body.parent_id,
        })
        if (!updated) return c.json({ error: 'Item not found' }, 404)
        return c.json({ data: updated })
    } catch (err) {
        return c.json({ error: (err as Error).message || 'Update failed' }, 400)
    }
})

drive.delete('/items/:id', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid item id' }, 400)

    const deleted = await softDeleteDriveItem(c.env.DB, user.id, id)
    if (!deleted) return c.json({ error: 'Item not found' }, 404)

    return c.json({ data: { drive_item_id: id } })
})

drive.get('/search', async (c) => {
    const user = c.get('user')
    const q = (c.req.query('q') || '').trim()
    if (!q) return c.json({ data: [] })

    const results = await searchDriveItems(c.env.DB, user.id, q)
    return c.json({ data: results })
})

drive.get('/picker', async (c) => {
    const user = c.get('user')
    const q = (c.req.query('q') || '').trim()
    const defaultLimit = q ? 24 : 5
    const rawLimit = parseInt(c.req.query('limit') || String(defaultLimit), 10)
    const limit = Math.min(Math.max(Number.isInteger(rawLimit) ? rawLimit : defaultLimit, 1), 50)

    const results = await listDriveAttachPickerItems(c.env.DB, user.id, q, limit)
    return c.json({
        data: results,
        meta: {
            q,
            mode: q ? 'search' : 'recent',
            limit,
        },
    })
})

drive.get('/items/:id/download', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid item id' }, 400)

    const item = await getDriveDownloadRecord(c.env.DB, user.id, id)
    if (!item) return c.json({ error: 'File not found' }, 404)

    const tokenSecret = getTokenSecret(c.env.TOKEN_SECRET)
    if (!tokenSecret) return c.json({ error: 'Attachment signing is not configured' }, 500)

    const signed = await createDownloadToken(tokenSecret, user.id, id)
    const downloadUrl = new URL('/api/drive/download', c.req.url)
    downloadUrl.searchParams.set('t', signed.token)
    const inlineUrl = new URL(downloadUrl.toString())
    inlineUrl.searchParams.set('inline', '1')

    return c.json({
        data: {
            drive_item_id: id,
            filename: item.filename,
            url: downloadUrl.toString(),
            inline_url: inlineUrl.toString(),
            expires_at: new Date(signed.exp * 1000).toISOString(),
        },
    })
})

drive.get('/items/:id/info', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid item id' }, 400)

    const info = await getDriveAttachmentInfoByDriveItemId(c.env.DB, user.id, id)
    if (!info) return c.json({ error: 'File not found' }, 404)

    return c.json({ data: serializeDriveAttachmentInfo(info) })
})

drive.get('/attachments/:attachmentId/info', async (c) => {
    const user = c.get('user')
    const attachmentId = parseInt(c.req.param('attachmentId') ?? '', 10)
    if (!Number.isInteger(attachmentId) || attachmentId < 1) return c.json({ error: 'Invalid attachment id' }, 400)

    const info = await getDriveAttachmentInfoByAttachmentId(c.env.DB, user.id, attachmentId)
    if (!info) return c.json({ error: 'Attachment not found' }, 404)

    return c.json({ data: serializeDriveAttachmentInfo(info) })
})

drive.patch('/items/:id/inspector', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid item id' }, 400)

    let body: { filename?: unknown; summary?: unknown; tag_list?: unknown }
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (body.filename !== undefined && typeof body.filename !== 'string') {
        return c.json({ error: 'filename must be a string' }, 400)
    }
    if (body.summary !== undefined && typeof body.summary !== 'string') {
        return c.json({ error: 'summary must be a string' }, 400)
    }
    if (body.tag_list !== undefined && !Array.isArray(body.tag_list)) {
        return c.json({ error: 'tag_list must be an array of strings' }, 400)
    }

    const info = await updateDriveAttachmentInspectorByDriveItemId(c.env.DB, user.id, id, {
        filename: body.filename as string | undefined,
        summary: body.summary as string | undefined,
        tag_list: body.tag_list as string[] | undefined,
    })

    if (!info) return c.json({ error: 'File not found' }, 404)
    return c.json({ data: serializeDriveAttachmentInfo(info) })
})

drive.patch('/attachments/:attachmentId/inspector', async (c) => {
    const user = c.get('user')
    const attachmentId = parseInt(c.req.param('attachmentId') ?? '', 10)
    if (!Number.isInteger(attachmentId) || attachmentId < 1) return c.json({ error: 'Invalid attachment id' }, 400)

    let body: { filename?: unknown; summary?: unknown; tag_list?: unknown }
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (body.filename !== undefined && typeof body.filename !== 'string') {
        return c.json({ error: 'filename must be a string' }, 400)
    }
    if (body.summary !== undefined && typeof body.summary !== 'string') {
        return c.json({ error: 'summary must be a string' }, 400)
    }
    if (body.tag_list !== undefined && !Array.isArray(body.tag_list)) {
        return c.json({ error: 'tag_list must be an array of strings' }, 400)
    }

    const info = await updateDriveAttachmentInspectorByAttachmentId(c.env.DB, user.id, attachmentId, {
        filename: body.filename as string | undefined,
        summary: body.summary as string | undefined,
        tag_list: body.tag_list as string[] | undefined,
    })

    if (!info) return c.json({ error: 'Attachment not found' }, 404)
    return c.json({ data: serializeDriveAttachmentInfo(info) })
})

// Attach a file from Drive to a note without duplicating the R2 object.
drive.post('/items/:id/attach-to-note', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid item id' }, 400)

    const driveItem = await getDriveItemById(c.env.DB, user.id, id)
    if (!driveItem || driveItem.kind !== 'file') return c.json({ error: 'File not found' }, 404)

    let body: { note_id?: number }
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const noteIdRaw = body.note_id
    if (typeof noteIdRaw !== 'number' || !Number.isInteger(noteIdRaw) || noteIdRaw < 1) {
        return c.json({ error: 'note_id is required' }, 400)
    }
    const noteId = noteIdRaw as number

    const link = await c.env.DB
        .prepare('SELECT attachment_id FROM drive_list WHERE drive_item_id = ? LIMIT 1')
        .bind(id)
        .first<{ attachment_id: number }>()

    if (!link) return c.json({ error: 'Attachment link not found' }, 404)

    const attachment = await c.env.DB
        .prepare('SELECT attachment_id, attachment_slug, filename, content_type FROM attachments WHERE attachment_id = ? LIMIT 1')
        .bind(link.attachment_id)
        .first<{ attachment_id: number; attachment_slug: string; filename: string; content_type: string }>()

    if (!attachment) return c.json({ error: 'Attachment not found' }, 404)

    const note = await c.env.DB
        .prepare('SELECT note_id FROM notes WHERE note_id = ? AND user_id = ? LIMIT 1')
        .bind(noteId, user.id)
        .first<{ note_id: number }>()

    if (!note) return c.json({ error: 'Note not found' }, 404)

    const maxRow = await c.env.DB
        .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM attachment_list WHERE note_id = ?')
        .bind(noteId)
        .first<{ max_sort: number }>()

    const nextSort = (maxRow?.max_sort ?? -1) + 1

    await c.env.DB
        .prepare('INSERT OR IGNORE INTO attachment_list (note_id, sort_order, attachment_id) VALUES (?, ?, ?)')
        .bind(noteId, nextSort, link.attachment_id)
        .run()

    await c.env.DB
        .prepare(
            `UPDATE notes
             SET attachment_count = (SELECT COUNT(*) FROM attachment_list WHERE note_id = ?),
                 last_modified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE note_id = ? AND user_id = ?`,
        )
        .bind(noteId, noteId, user.id)
        .run()

    const permalinkUrl = buildNoteAttachmentPermalink(c.req.url, attachment.attachment_slug)
    const markdown = buildDriveAttachmentMarkdown(
        attachment.filename || driveItem.display_name,
        attachment.content_type || 'application/octet-stream',
        permalinkUrl,
    )
    const updatedNote = await appendAttachmentMarkdownToNote(c.env.DB, {
        user_id: user.id,
        note_id: noteId,
        markdown,
    })

    return c.json({
        data: { note_id: noteId, attachment_id: link.attachment_id, markdown },
        note: updatedNote,
    })
})

export default drive
