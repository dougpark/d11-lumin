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

// Copies a note attachment's bytes into CDN_BUCKET and records its public URL — used both
// when a post is first published and when new attachments are added to an already-published
// post (attachments added after publish previously kept their private permalink forever).
export async function mirrorAttachmentToCdn(env: Env, noteId: number, attachment: Attachment): Promise<void> {
    if (!env.ATTACHMENTS || !env.CDN_BUCKET) return
    const object = await env.ATTACHMENTS.get(attachment.url)
    if (!object || !object.body) return

    const cdnKey = `blog/${noteId}/${attachment.filename}`
    const contentType = detectContentType(attachment.filename, attachment.content_type)
    await env.CDN_BUCKET.put(cdnKey, object.body, {
        httpMetadata: { contentType, cacheControl: CACHE_PRESETS.immutable },
    })
    const cdnUrl = buildPublicUrl(env, cdnKey)
    await setAttachmentCdnInfo(env.DB, attachment.attachment_id, { cdn_key: cdnKey, cdn_url: cdnUrl })
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
