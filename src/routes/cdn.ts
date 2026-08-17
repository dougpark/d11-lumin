// src/routes/cdn.ts — Admin-only CDN media manager backed by env.CDN_BUCKET (R2)

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env, Variables } from '../index.ts'
import type { User } from '../db/types.ts'
import { authMiddleware } from '../middleware/authMiddleware.ts'

const cdn = new Hono<{ Bindings: Env; Variables: Variables }>()

const MAX_CDN_UPLOAD_BYTES = 100 * 1024 * 1024

const CACHE_PRESETS = {
    immutable: 'public, max-age=31536000, immutable',
    revalidate: 'public, max-age=3600, must-revalidate',
    none: 'no-store, no-cache',
} as const

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', bmp: 'image/bmp',
    json: 'application/json', js: 'application/javascript', mjs: 'application/javascript',
    css: 'text/css', html: 'text/html', xml: 'application/xml', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    pdf: 'application/pdf', zip: 'application/zip',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
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

function requireAdmin(c: Context<{ Bindings: Env; Variables: Variables }>): Response | null {
    const user = c.var.user as User
    if (!user || user.is_admin !== 1) {
        return c.json({ error: 'Forbidden' }, 403) as Response
    }
    return null
}

function sanitizeFilename(filename: string): string {
    const cleaned = filename
        .replace(/[\\/]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180)
    return cleaned || 'file'
}

// Normalizes a user-supplied folder path into a safe `a/b/` key prefix (or '' for the root).
function sanitizePrefix(raw: string): string {
    const segments = raw
        .replace(/\\/g, '/')
        .split('/')
        .map((seg) => seg.trim())
        .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
    return segments.length ? `${segments.join('/')}/` : ''
}

function detectContentType(filename: string, declared: string): string {
    if (declared && declared !== 'application/octet-stream') return declared
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    return EXTENSION_CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

function resolveCacheControl(preset: string | null): string {
    if (preset && preset in CACHE_PRESETS) return CACHE_PRESETS[preset as keyof typeof CACHE_PRESETS]
    return CACHE_PRESETS.immutable
}

function buildPublicUrl(env: Env, key: string): string {
    const base = (env.CDN_PUBLIC_BASE_URL || '').replace(/\/$/, '')
    return `${base}/${key}`
}

// Fire-and-forget Cloudflare zone cache purge for the public URLs of the given keys.
// No-ops quietly if CF_API_TOKEN/CF_ZONE_ID aren't configured yet.
async function purgeCache(env: Env, keys: string[]): Promise<void> {
    if (!env.CF_API_TOKEN || !env.CF_ZONE_ID || keys.length === 0) return
    const files = keys.map((key) => buildPublicUrl(env, key))
    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.CF_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ files }),
        })
        if (!res.ok) {
            console.error('CDN cache purge failed', res.status, await res.text())
        }
    } catch (err) {
        console.error('CDN cache purge error', (err as Error).message)
    }
}

// GET /api/admin/cdn/stats — object count + total size across the whole bucket.
cdn.get('/stats', authMiddleware, async (c) => {
    const deny = requireAdmin(c)
    if (deny) return deny

    let cursor: string | undefined
    let count = 0
    let totalSize = 0
    let pages = 0
    do {
        const listed: R2Objects = await c.env.CDN_BUCKET.list({ cursor, limit: 1000 })
        for (const obj of listed.objects) {
            count += 1
            totalSize += obj.size
        }
        cursor = listed.truncated ? listed.cursor : undefined
        pages += 1
    } while (cursor && pages < 50)

    return c.json({ count, total_size: totalSize })
})

// GET /api/admin/cdn/objects?prefix=&cursor=&limit= — folder-style browsing via R2 delimiter.
cdn.get('/objects', authMiddleware, async (c) => {
    const deny = requireAdmin(c)
    if (deny) return deny

    const prefix = sanitizePrefix(c.req.query('prefix') ?? '')
    const cursor = c.req.query('cursor') || undefined
    const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 1), 1000) : 200

    const listed: R2Objects = await c.env.CDN_BUCKET.list({
        prefix,
        delimiter: '/',
        cursor,
        limit,
        // R2 list() omits httpMetadata/customMetadata by default — must opt in to get contentType/cacheControl.
        include: ['httpMetadata', 'customMetadata'],
    })

    const folders = (listed.delimitedPrefixes ?? []).map((full) => ({
        prefix: full,
        name: full.slice(prefix.length).replace(/\/$/, ''),
    }))

    const objects = listed.objects.map((obj) => ({
        key: obj.key,
        name: obj.key.slice(prefix.length),
        size: obj.size,
        uploaded: obj.uploaded,
        etag: obj.httpEtag,
        content_type: obj.httpMetadata?.contentType || 'application/octet-stream',
        cache_control: obj.httpMetadata?.cacheControl || null,
        url: buildPublicUrl(c.env, obj.key),
    }))

    return c.json({
        prefix,
        folders,
        objects,
        truncated: listed.truncated,
        cursor: listed.truncated ? listed.cursor : null,
    })
})

// POST /api/admin/cdn/objects — multipart upload: file, prefix, cachePreset, overwrite.
cdn.post('/objects', authMiddleware, async (c) => {
    const deny = requireAdmin(c)
    if (deny) return deny

    // Content-Length is the only signal we have before formData() buffers the whole body.
    const declaredLength = Number.parseInt(c.req.header('content-length') ?? '', 10)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CDN_UPLOAD_BYTES) {
        return c.json({ error: 'File exceeds 100MB limit' }, 413)
    }

    let form: FormData
    try {
        form = await c.req.formData()
    } catch {
        return c.json({ error: 'Expected multipart/form-data' }, 400)
    }

    const filePart = form.get('file')
    if (!isUploadFileLike(filePart)) return c.json({ error: 'file is required' }, 400)

    const size = filePart.size
    if (!size || size < 1) return c.json({ error: 'File is empty' }, 400)
    if (size > MAX_CDN_UPLOAD_BYTES) return c.json({ error: 'File exceeds 100MB limit' }, 400)

    const prefix = sanitizePrefix((form.get('prefix') as string | null) ?? '')
    const filename = sanitizeFilename(filePart.name)
    const key = `${prefix}${filename}`

    const overwriteField = ((form.get('overwrite') as string | null) ?? '').toLowerCase()
    const overwrite = overwriteField === 'true' || overwriteField === '1'
    if (!overwrite) {
        const existing = await c.env.CDN_BUCKET.head(key)
        if (existing) return c.json({ error: 'An object with this name already exists', key }, 409)
    }

    // Prefer the client's extension-based hint over filePart.type — drag-and-dropped files often
    // arrive with an empty/generic browser-sniffed type, unlike files picked via <input type=file>.
    const contentTypeHint = (form.get('contentType') as string | null) ?? ''
    const contentType = detectContentType(filename, contentTypeHint || filePart.type)
    const cacheControl = resolveCacheControl((form.get('cachePreset') as string | null) ?? null)

    await c.env.CDN_BUCKET.put(key, filePart.stream(), {
        httpMetadata: { contentType, cacheControl },
    })

    // Replacing an existing object can leave a stale edge cache — purge it.
    if (overwrite) c.executionCtx.waitUntil(purgeCache(c.env, [key]))

    return c.json({ data: { key, size, content_type: contentType, cache_control: cacheControl, url: buildPublicUrl(c.env, key) } }, 201)
})

// DELETE /api/admin/cdn/objects — bulk delete. Body: { keys: string[] }
cdn.delete('/objects', authMiddleware, async (c) => {
    const deny = requireAdmin(c)
    if (deny) return deny

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    const keys = Array.isArray((body as { keys?: unknown })?.keys)
        ? (body as { keys: unknown[] }).keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
        : []
    if (keys.length === 0) return c.json({ error: 'keys is required' }, 400)

    await c.env.CDN_BUCKET.delete(keys)
    c.executionCtx.waitUntil(purgeCache(c.env, keys))

    return c.json({ ok: true, deleted: keys.length })
})

// POST /api/admin/cdn/purge — manual cache purge. Body: { keys: string[] }
cdn.post('/purge', authMiddleware, async (c) => {
    const deny = requireAdmin(c)
    if (deny) return deny

    if (!c.env.CF_API_TOKEN || !c.env.CF_ZONE_ID) {
        return c.json({ error: 'Cache purge is not configured (missing CF_API_TOKEN / CF_ZONE_ID)' }, 500)
    }

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    const keys = Array.isArray((body as { keys?: unknown })?.keys)
        ? (body as { keys: unknown[] }).keys.filter((k): k is string => typeof k === 'string' && k.length > 0)
        : []
    if (keys.length === 0) return c.json({ error: 'keys is required' }, 400)

    await purgeCache(c.env, keys)
    return c.json({ ok: true, purged: keys.length })
})

export default cdn
