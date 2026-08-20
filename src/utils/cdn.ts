// src/utils/cdn.ts — shared helpers for env.CDN_BUCKET (R2) used by both the admin CDN
// router (src/routes/cdn.ts) and the notes → blog publishing flow (src/routes/notes.ts).

import { setAttachmentCdnInfo } from '../db/notes.ts'
import type { Attachment } from '../db/types.ts'
import type { Env } from '../index.ts'

export const CACHE_PRESETS = {
    immutable: 'public, max-age=31536000, immutable',
    revalidate: 'public, max-age=3600, must-revalidate',
    none: 'no-store, no-cache',
} as const

export const EXTENSION_CONTENT_TYPES: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', bmp: 'image/bmp',
    json: 'application/json', js: 'application/javascript', mjs: 'application/javascript',
    css: 'text/css', html: 'text/html', xml: 'application/xml', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    pdf: 'application/pdf', zip: 'application/zip',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
}

export function detectContentType(filename: string, declared: string): string {
    if (declared && declared !== 'application/octet-stream') return declared
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    return EXTENSION_CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export function resolveCacheControl(preset: string | null): string {
    if (preset && preset in CACHE_PRESETS) return CACHE_PRESETS[preset as keyof typeof CACHE_PRESETS]
    return CACHE_PRESETS.immutable
}

export function buildPublicUrl(env: Env, key: string): string {
    const base = (env.CDN_PUBLIC_BASE_URL || '').replace(/\/$/, '')
    // Encode each path segment (not the "/" separators) — R2 keys often contain spaces
    // (e.g. pasted screenshot filenames), which break unescaped Markdown link syntax.
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    return `${base}/${encodedKey}`
}

// Content types worth resizing/re-encoding to WebP before mirroring — excludes GIF (would
// collapse animations) and SVG (vector, resizing is meaningless/unsupported).
const RESIZABLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/bmp'])
const IMAGE_MAX_WIDTH = 1600
const IMAGE_QUALITY = 82

function webpFilename(filename: string): string {
    return filename.replace(/\.[^./]+$/, '') + '.webp'
}

// Copies a note attachment's bytes into CDN_BUCKET and records its public URL — used both
// when a post is first published and when new attachments are added to an already-published
// post (attachments added after publish previously kept their private permalink forever).
// Images are downscaled (max 1600px wide, never upscaled) and re-encoded as WebP for smaller,
// faster-loading public copies; the private ATTACHMENTS copy is left untouched.
export async function mirrorAttachmentToCdn(
    env: Env,
    noteId: number,
    attachment: Attachment,
): Promise<{ cdnKey: string; cdnUrl: string } | null> {
    if (!env.ATTACHMENTS || !env.CDN_BUCKET) return null
    const object = await env.ATTACHMENTS.get(attachment.url)
    if (!object || !object.body) return null

    if (env.IMAGES && RESIZABLE_IMAGE_TYPES.has(attachment.content_type)) {
        try {
            const result = await env.IMAGES.input(object.body)
                .transform({ width: IMAGE_MAX_WIDTH, fit: 'scale-down' })
                .output({ format: 'image/webp', quality: IMAGE_QUALITY })
            const cdnKey = `blog/${noteId}/${webpFilename(attachment.filename)}`
            await env.CDN_BUCKET.put(cdnKey, result.image(), {
                httpMetadata: { contentType: 'image/webp', cacheControl: CACHE_PRESETS.immutable },
            })
            const cdnUrl = buildPublicUrl(env, cdnKey)
            await setAttachmentCdnInfo(env.DB, attachment.attachment_id, { cdn_key: cdnKey, cdn_url: cdnUrl })
            return { cdnKey, cdnUrl }
        } catch (err) {
            console.error('image resize failed — falling back to raw copy', {
                noteId,
                attachmentId: attachment.attachment_id,
                error: (err as Error).message,
            })
            // Transform consumed the original stream — re-fetch for the raw fallback below.
            const fresh = await env.ATTACHMENTS.get(attachment.url)
            if (!fresh || !fresh.body) return null
            return mirrorRawToCdn(env, noteId, attachment, fresh.body)
        }
    }

    return mirrorRawToCdn(env, noteId, attachment, object.body)
}

async function mirrorRawToCdn(
    env: Env,
    noteId: number,
    attachment: Attachment,
    body: ReadableStream<Uint8Array>,
): Promise<{ cdnKey: string; cdnUrl: string }> {
    const cdnKey = `blog/${noteId}/${attachment.filename}`
    const contentType = detectContentType(attachment.filename, attachment.content_type)
    await env.CDN_BUCKET.put(cdnKey, body, {
        httpMetadata: { contentType, cacheControl: CACHE_PRESETS.immutable },
    })
    const cdnUrl = buildPublicUrl(env, cdnKey)
    await setAttachmentCdnInfo(env.DB, attachment.attachment_id, { cdn_key: cdnKey, cdn_url: cdnUrl })
    return { cdnKey, cdnUrl }
}

// Fire-and-forget Cloudflare zone cache purge for the public URLs of the given keys.
// No-ops quietly if CF_API_TOKEN/CF_ZONE_ID aren't configured yet.
export async function purgeCache(env: Env, keys: string[]): Promise<void> {
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

// Purges the cached blog list/feed pages plus, if given, specific post page(s) — needed
// whenever a note's publish state or published metadata changes, since blog.json/rss.xml
// are edge-cached (5min/1hr) and would otherwise keep serving stale data until they expire.
export async function purgeBlogCaches(env: Env, siteUrl: string, slugs: string[] = []): Promise<void> {
    const urls = [`${siteUrl}/rss.xml`, `${siteUrl}/api/blog.json`, `${siteUrl}/api/blog/tags`, `${siteUrl}/blog`]
    for (const slug of slugs) {
        if (slug) urls.push(`${siteUrl}/blog/${slug}`, `${siteUrl}/api/blog/${slug}`)
    }
    await purgeUrls(env, urls)
}

// Purges arbitrary public URLs that aren't necessarily CDN_BUCKET keys (e.g. blog.json, rss.xml).
export async function purgeUrls(env: Env, urls: string[]): Promise<void> {
    if (!env.CF_API_TOKEN || !env.CF_ZONE_ID || urls.length === 0) return
    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.CF_API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ files: urls }),
        })
        if (!res.ok) {
            console.error('CDN cache purge failed', res.status, await res.text())
        }
    } catch (err) {
        console.error('CDN cache purge error', (err as Error).message)
    }
}
