// scripts/recover-images.ts — one-time pass over imported Pelican posts that tries to rescue dead
// image links (old WordPress, Posterous, Ghost hosts) from the live web and the Wayback Machine,
// then mirrors anything found into R2 exactly like import-pelican.ts does.
//
// Usage (run with Bun from the repo root):
//   bun scripts/recover-images.ts --target remote --dry-run      # probe only, no writes
//   bun scripts/recover-images.ts --target remote --yes
//
// Flags: --target local|remote, --email (default parkdn+pin@gmail.com), --channel (default 64zbit),
//        --dry-run, --yes (required for remote writes), --limit <n posts>
//
// Safe to re-run: images already rewritten to the CDN are no longer "remote", so they're skipped.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const TARGET = arg('target')
const OWNER_EMAIL = arg('email') ?? 'parkdn+pin@gmail.com'
const CHANNEL_NAME = arg('channel') ?? '64zbit'
const DRY_RUN = flag('dry-run')
const LIMIT = arg('limit') ? Number.parseInt(arg('limit')!, 10) : Infinity

if (TARGET !== 'local' && TARGET !== 'remote') {
    console.error('Usage: bun scripts/recover-images.ts --target local|remote [--dry-run] [--yes]')
    process.exit(1)
}
if (TARGET === 'remote' && !DRY_RUN && !flag('yes')) {
    console.error('Refusing to write to the REMOTE (production) database without --yes.')
    process.exit(1)
}

const DB_NAME = 'd11-db'
const PRIVATE_BUCKET = 'd11-note-attachments'
const CDN_BUCKET = 'cdn-bucket'
const wranglerToml = readFileSync(join(import.meta.dir, '..', 'wrangler.toml'), 'utf8')
const PROD_CDN_BASE = (wranglerToml.match(/^CDN_PUBLIC_BASE_URL\s*=\s*"([^"]+)"/m)?.[1] ?? '').replace(/\/$/, '')
const CDN_BASE = TARGET === 'local' ? (arg('local-origin') ?? 'http://localhost:8787') + '/cdn-local' : PROD_CDN_BASE
if (!PROD_CDN_BASE) throw new Error('CDN_PUBLIC_BASE_URL not found in wrangler.toml')

const TRACKING_HOSTS = ['feeds.feedburner.com', 'feedproxy.google.com', 'stats.wordpress.com', 'pixel.wp.com', 'doubleclick.net']
const IMAGE_TYPES: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
}
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const locationFlag = TARGET === 'remote' ? '--remote' : '--local'

// ─── Wrangler helpers (same behaviour as import-pelican.ts) ─────────────────

function sleep(seconds: number) {
    spawnSync('sleep', [String(seconds)])
}

function wrangler(args: string[]): string {
    let lastErr = ''
    for (let attempt = 1; attempt <= 4; attempt++) {
        const res = spawnSync(process.execPath, ['--bun', 'x', 'wrangler', ...args], {
            cwd: join(import.meta.dir, '..'),
            encoding: 'utf8',
            maxBuffer: 256 * 1024 * 1024,
        })
        if (res.status === 0) return res.stdout
        lastErr = res.stderr || res.stdout
        if (!/fetch failed|connectivity|ECONNRESET|ETIMEDOUT|ENOTFOUND|5\d\d/.test(lastErr)) break
        sleep(attempt * 3)
    }
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed:\n${lastErr}`)
}

function d1Rows<T>(sql: string): T[] {
    for (let attempt = 1; ; attempt++) {
        try {
            const out = wrangler(['d1', 'execute', DB_NAME, locationFlag, '--json', '--command', sql])
            const parsed = JSON.parse(out.slice(out.indexOf('[')))
            return (parsed[0]?.results ?? []) as T[]
        } catch (err) {
            if (attempt >= 4) throw err
            sleep(attempt * 3)
        }
    }
}

function d1All<T>(sql: string, pageSize = 50): T[] {
    const all: T[] = []
    for (let offset = 0; ; offset += pageSize) {
        const rows = d1Rows<T>(`${sql} LIMIT ${pageSize} OFFSET ${offset}`)
        all.push(...rows)
        if (rows.length < pageSize) return all
    }
}

function d1File(sql: string, tmp: string): void {
    const file = join(tmp, `batch-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`)
    writeFileSync(file, sql)
    wrangler(['d1', 'execute', DB_NAME, locationFlag, '--yes', '--file', file])
}

function r2Put(bucket: string, key: string, file: string, contentType: string, cacheControl?: string): void {
    const args = ['r2', 'object', 'put', `${bucket}/${key}`, locationFlag, '--file', file, '--content-type', contentType]
    if (cacheControl) args.push('--cache-control', cacheControl)
    wrangler(args)
}

const q = (v: string | number | null): string => {
    if (v === null) return 'NULL'
    if (typeof v === 'number') return String(v)
    return `'${v.replace(/'/g, "''")}'`
}

function cdnUrlFor(key: string): string {
    return `${CDN_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function sanitizeFilename(name: string): string {
    return name.replace(/[^\w.@+-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'image'
}

function safeDecode(s: string): string {
    try { return decodeURIComponent(s) } catch { return s }
}

// ─── Finding dead images in post content ────────────────────────────────────

interface DeadImage {
    url: string
    linkedUrl?: string   // href of a wrapping [![](img)](href), often the full-size image
}

function absolute(url: string): string {
    return url.startsWith('//') ? `https:${url}` : url
}

function isCandidate(url: string): boolean {
    if (!/^(https?:)?\/\//i.test(url)) return false
    if (url.startsWith(CDN_BASE) || url.startsWith(PROD_CDN_BASE)) return false
    try {
        const host = new URL(absolute(url)).hostname
        return !TRACKING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
    } catch {
        return false
    }
}

function findRemoteImages(md: string): DeadImage[] {
    const found = new Map<string, DeadImage>()
    // Linked images first so their href is captured.
    for (const m of md.matchAll(/\[\s*!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)(?:\{[^}]*\})?\s*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) {
        if (isCandidate(m[1])) found.set(m[1], { url: m[1], linkedUrl: m[2] })
    }
    for (const m of md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
        if (isCandidate(m[1]) && !found.has(m[1])) found.set(m[1], { url: m[1] })
    }
    for (const m of md.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
        if (isCandidate(m[1]) && !found.has(m[1])) found.set(m[1], { url: m[1] })
    }
    return [...found.values()]
}

// Alternate URLs worth trying, best (largest) first.
function variants(img: DeadImage): string[] {
    const out: string[] = []
    const add = (u: string | undefined) => { if (u && !out.includes(u)) out.push(u) }
    const url = absolute(img.url)
    const looksLikeImage = (u: string) => /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(u) || /posterous\.com\/getfile/i.test(u)

    if (img.linkedUrl && looksLikeImage(img.linkedUrl)) add(absolute(img.linkedUrl))
    add(url.replace(/\.scaled\d+\.(\w+)$/, '.scaled1000.$1'))                         // Posterous larger render
    add(url.replace(/-\d{2,4}x\d{2,4}(\.\w+)(\?.*)?$/, '$1'))                          // WordPress full-size
    add(url)
    add(url.replace(/\?.*$/, ''))                                                      // drop resize query
    add(url.startsWith('https:') ? url.replace(/^https:/, 'http:') : url.replace(/^http:/, 'https:'))
    // Posterous served the same file from getfileN. hosts and the bare host.
    if (/posterous\.com\/getfile\//.test(url)) {
        add(url.replace(/\/\/getfile\d*\.posterous\.com\//, '//posterous.com/'))
        for (let n = 0; n <= 9; n++) add(url.replace(/\/\/(getfile\d*\.)?posterous\.com\//, `//getfile${n}.posterous.com/`))
    }
    // Ghost images moved between ghost.64zbit.com and 64zbit.com, and Ghost serves resized copies under /size/wNNN/.
    const ghost = url.match(/^https?:\/\/(?:ghost\.|www\.)?64zbit\.com\/content\/images\/(?:size\/w\d+\/)?(.+)$/)
    if (ghost) {
        for (const host of ['64zbit.com', 'ghost.64zbit.com', 'www.64zbit.com']) {
            for (const size of ['', 'size/w2000/', 'size/w1000/', 'size/w600/']) add(`https://${host}/content/images/${size}${ghost[1]}`)
        }
    }
    return out
}

let lastWayback = 0
async function tryFetch(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(30_000),
            headers: { 'User-Agent': 'Mozilla/5.0 (Lumin image recovery)' },
            redirect: 'follow',
        })
        if (res.status === 429) {
            await Bun.sleep(20_000)
            return tryFetch(url)
        }
        if (!res.ok) return null
        let contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
        // Wayback sometimes labels archived images as octet-stream.
        if (!contentType.startsWith('image/')) {
            const ext = extname(new URL(url).pathname.replace(/\.scaled\d+/, '')).slice(1).toLowerCase()
            if (contentType === 'application/octet-stream' && IMAGE_TYPES[ext]) contentType = IMAGE_TYPES[ext]
            else return null
        }
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (bytes.length < 100 || bytes.length > MAX_IMAGE_BYTES) return null
        return { bytes, contentType }
    } catch {
        return null
    }
}

async function recover(img: DeadImage, postDate: string): Promise<{ bytes: Uint8Array; contentType: string; source: string; from: string } | null> {
    const cands = variants(img)
    for (const c of cands) {
        const got = await tryFetch(c)
        if (got) return { ...got, source: 'live', from: c }
    }
    // `id_` returns the raw archived bytes; the timestamp just picks the nearest capture.
    const stamp = postDate.slice(0, 10).replace(/-/g, '')
    for (const c of cands.slice(0, 16)) {
        const wait = 1500 - (Date.now() - lastWayback)
        if (wait > 0) await Bun.sleep(wait)
        lastWayback = Date.now()
        const got = await tryFetch(`https://web.archive.org/web/${stamp}id_/${c}`)
        if (got) return { ...got, source: 'wayback', from: c }
    }
    return null
}

// ─── Main ───────────────────────────────────────────────────────────────────

interface Row { note_id: number; slug: string; content: string; attachment_count: number; published_at: string }

async function main() {
    const user = d1Rows<{ id: number }>(`SELECT id FROM users WHERE email = ${q(OWNER_EMAIL)}`)[0]
    if (!user) throw new Error(`No user with email ${OWNER_EMAIL} in the ${TARGET} database`)
    const channel = d1Rows<{ id: number }>(`SELECT id FROM note_channels WHERE user_id = ${user.id} AND name = ${q(CHANNEL_NAME)}`)[0]
    if (!channel) throw new Error(`No channel "${CHANNEL_NAME}" for ${OWNER_EMAIL}`)

    // Only pull ids first, then the posts that still reference remote images (keeps responses small).
    const ids = d1All<{ note_id: number }>(
        `SELECT note_id FROM notes WHERE channel_id = ${channel.id} AND (content LIKE '%![%](http%' OR content LIKE '%![%](//%' OR content LIKE '%<img%') ORDER BY note_id`)
    console.log(`User #${user.id}, channel #${channel.id}: ${ids.length} posts may reference external images.`)

    const tmp = mkdtempSync(join(tmpdir(), 'recover-images-'))
    const recovered: string[] = []
    const stillMissing: string[] = []
    let processed = 0

    for (const { note_id } of ids) {
        if (processed >= LIMIT) break
        const row = d1Rows<Row>(`SELECT note_id, slug, content, attachment_count, published_at FROM notes WHERE note_id = ${note_id}`)[0]
        const images = findRemoteImages(row.content)
        if (!images.length) continue
        processed++

        let content = row.content
        let order = row.attachment_count
        const stmts: string[] = []
        const usedNames = new Set<string>()

        for (const img of images) {
            const got = await recover(img, row.published_at)
            if (!got) {
                stillMissing.push(`${row.slug}  ${img.url}`)
                console.log(`  ✗ ${row.slug}  ${img.url.slice(0, 100)}`)
                continue
            }
            console.log(`  ✓ ${row.slug}  [${got.source}]  ${got.from.slice(0, 100)}`)
            recovered.push(`${row.slug}  [${got.source}]  ${got.from}`)
            if (DRY_RUN) continue

            let filename = sanitizeFilename(basename(safeDecode(new URL(got.from).pathname)).replace(/\.scaled\d+(\.\w+)$/, '$1'))
            if (!extname(filename)) filename += `.${Object.entries(IMAGE_TYPES).find(([, t]) => t === got.contentType)?.[0] ?? 'img'}`
            while (usedNames.has(filename.toLowerCase())) filename = filename.replace(/(\.[^.]+)?$/, `-${order}$1`)
            usedNames.add(filename.toLowerCase())

            const cdnKey = `blog/${row.note_id}/${filename}`
            const privateKey = `notes/${user.id}/${row.note_id}/${Date.now()}-${crypto.randomUUID()}-${filename}`
            const file = join(tmp, `asset-${row.note_id}-${order}`)
            writeFileSync(file, got.bytes)
            r2Put(CDN_BUCKET, cdnKey, file, got.contentType, 'public, max-age=31536000, immutable')
            r2Put(PRIVATE_BUCKET, privateKey, file, got.contentType)
            rmSync(file)

            const attSlug = `att_${crypto.randomUUID().replace(/-/g, '')}`
            stmts.push(`INSERT INTO attachments (attachment_slug, owner_user_id, filename, content_type, size, url, cdn_key, cdn_url)
VALUES (${q(attSlug)}, ${user.id}, ${q(filename)}, ${q(got.contentType)}, ${got.bytes.length}, ${q(privateKey)}, ${q(cdnKey)}, ${q(cdnUrlFor(cdnKey))});`)
            stmts.push(`INSERT INTO attachment_list (note_id, sort_order, attachment_id)
VALUES (${row.note_id}, ${order}, (SELECT attachment_id FROM attachments WHERE attachment_slug = ${q(attSlug)}));`)
            content = content.split(img.url).join(cdnUrlFor(cdnKey))
            // A wrapping link to the same (dead) full-size image should now open the recovered copy.
            if (img.linkedUrl && absolute(img.linkedUrl) === got.from) content = content.split(img.linkedUrl).join(cdnUrlFor(cdnKey))
            order++
        }

        if (stmts.length) {
            stmts.push(`UPDATE notes SET content = ${q(content)}, attachment_count = ${order} WHERE note_id = ${row.note_id};`)
            d1File(stmts.join('\n'), tmp)
        }
    }

    rmSync(tmp, { recursive: true, force: true })
    const reportPath = join(process.cwd(), '.recover-images-report.json')
    writeFileSync(reportPath, JSON.stringify({ target: TARGET, dryRun: DRY_RUN, recovered, stillMissing }, null, 2))
    console.log(`\n── Summary ──\nposts checked: ${processed}\nimages ${DRY_RUN ? 'recoverable' : 'recovered'}: ${recovered.length}\nstill missing: ${stillMissing.length}\nreport: ${reportPath}`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
