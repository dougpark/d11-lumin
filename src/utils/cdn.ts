// src/utils/cdn.ts — shared helpers for env.CDN_BUCKET (R2) used by both the admin CDN
// router (src/routes/cdn.ts) and the notes → blog publishing flow (src/routes/notes.ts).

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
    return `${base}/${key}`
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
