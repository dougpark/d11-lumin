// scripts/import-pelican.ts — one-time import of a Pelican blog (Markdown + front matter) into
// Lumin's notes/blog tables, mirroring referenced images into R2.
//
// Usage (run with Bun from the repo root):
//   bun scripts/import-pelican.ts --src /path/to/64zbit.com_pelican/content --target local --dry-run
//   bun scripts/import-pelican.ts --src /path/to/content --target local
//   bun scripts/import-pelican.ts --src /path/to/content --target remote --yes
//
// Flags:
//   --src <dir>        Pelican `content/` directory (required)
//   --target <t>       local | remote   (required; remote also needs --yes)
//   --email <addr>     owner account (default parkdn+pin@gmail.com)
//   --channel <name>   notes channel to create/use (default 64zbit)
//   --tag <name>       tag added to every post (default 64zbit)
//   --dry-run          parse + report only; no database or bucket writes, no network
//   --skip-images      import posts only; leave image links untouched
//   --limit <n>        only process the first n posts (useful for a trial run)
//
// Re-running is safe: posts already present in the channel are skipped, and a post that was
// inserted but never got its images (attachment_count = 0) is retried.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { generateExcerpt, slugify } from '../src/utils/slug.ts'

// ─── CLI ─────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const SRC = arg('src') ? resolve(arg('src')!) : ''
const TARGET = arg('target')
const OWNER_EMAIL = arg('email') ?? 'parkdn+pin@gmail.com'
const CHANNEL_NAME = arg('channel') ?? '64zbit'
const EXTRA_TAG = arg('tag') ?? '64zbit'
const DRY_RUN = flag('dry-run')
const SKIP_IMAGES = flag('skip-images')
const LIMIT = arg('limit') ? Number.parseInt(arg('limit')!, 10) : Infinity

if (!SRC || !existsSync(SRC) || (TARGET !== 'local' && TARGET !== 'remote')) {
    console.error('Usage: bun scripts/import-pelican.ts --src <content dir> --target local|remote [--dry-run] [--yes]')
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
// The local dev Worker can't reach the production CDN domain, so local imports point at its /cdn-local proxy.
const CDN_BASE = TARGET === 'local' ? (arg('local-origin') ?? 'http://localhost:8787') + '/cdn-local' : PROD_CDN_BASE
if (!PROD_CDN_BASE) throw new Error('CDN_PUBLIC_BASE_URL not found in wrangler.toml')

// Directories under content/ that hold posts. Pages, Projects, projects_ are static site pages.
const POST_DIRS = ['64', 'Link', 'RobotCraft', 'blog']
const SKIP_PATH_PARTS = ['pages2']

// Tracking pixels / feed badges that should simply be dropped from content.
const TRACKING_HOSTS = ['feeds.feedburner.com', 'feedproxy.google.com', 'stats.wordpress.com', 'pixel.wp.com', 'doubleclick.net']

const IMAGE_TYPES: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
}
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

// ─── Wrangler helpers ────────────────────────────────────────────────────────

const locationFlag = TARGET === 'remote' ? '--remote' : '--local'

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
        // Only network flakes are worth retrying
        if (!/fetch failed|connectivity|ECONNRESET|ETIMEDOUT|ENOTFOUND|5\d\d/.test(lastErr)) break
        spawnSync('sleep', [String(attempt * 3)])
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
            spawnSync('sleep', [String(attempt * 3)])
        }
    }
}

// Pages through a query so large result sets don't produce huge single responses.
function d1All<T>(sql: string, pageSize = 100): T[] {
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

// ─── Parsing ─────────────────────────────────────────────────────────────────

interface Post {
    file: string
    title: string
    slug: string
    isoDate: string
    category: string
    tags: string[]
    summary: string
    body: string
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, out)
        else out.push(full)
    }
    return out
}

function parsePost(file: string): { post?: Post; skip?: string } {
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    const split = raw.indexOf('\n\n')
    const header = split >= 0 ? raw.slice(0, split) : raw
    const body = split >= 0 ? raw.slice(split + 2) : ''

    const meta: Record<string, string> = {}
    for (const line of header.split('\n')) {
        const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
        if (m) meta[m[1].toLowerCase()] = m[2].trim()
    }

    if (!meta.title || !meta.date) return { skip: 'no title/date (not a post)' }
    const status = (meta.status ?? 'published').toLowerCase()
    if (status === 'hidden' || status === 'draft') return { skip: `status: ${status}` }

    const date = new Date(`${meta.date.replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(meta.date) ? '' : 'Z'}`)
    if (Number.isNaN(date.getTime())) return { skip: `bad date: ${meta.date}` }

    const tags: string[] = []
    const seen = new Set<string>()
    for (const t of [...(meta.tags ?? '').split(','), meta.category ?? '', EXTRA_TAG]) {
        const tag = t.trim()
        if (tag && !seen.has(tag.toLowerCase())) {
            seen.add(tag.toLowerCase())
            tags.push(tag)
        }
    }

    return {
        post: {
            file,
            title: meta.title,
            slug: meta.slug ? slugify(meta.slug) : '',
            isoDate: date.toISOString().replace(/\.\d{3}Z$/, 'Z'),
            category: meta.category ?? '',
            tags: tags.slice(0, 20),
            summary: meta.summary ?? '',
            body: body.trim(),
        },
    }
}

// ─── Content / image handling ────────────────────────────────────────────────

interface ImageRef {
    original: string   // exact URL text as written in the markdown
    kind: 'local' | 'remote' | 'tracking'
}

// `![alt](url "title"){width="500" height="500" border="0"}` → keep only `{width=500}` (the form the blog renders).
function normalizeImageAttrs(md: string): string {
    return md.replace(/(!\[[^\]]*\]\([^)]*\))\{([^}]*)\}/g, (_m, img: string, attrs: string) => {
        const w = attrs.match(/width\s*=\s*"?(\d{1,4})/i)?.[1]
        return w ? `${img}{width=${w}}` : img
    })
}

function extractImageRefs(md: string): ImageRef[] {
    const urls = new Set<string>()
    for (const m of md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) urls.add(m[1])
    for (const m of md.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) urls.add(m[1])

    const refs: ImageRef[] = []
    for (const url of urls) {
        if (url.startsWith('data:')) continue
        if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
            const host = new URL(url.startsWith('//') ? `https:${url}` : url).hostname
            refs.push({ original: url, kind: TRACKING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? 'tracking' : 'remote' })
        } else {
            refs.push({ original: url, kind: 'local' })
        }
    }
    return refs
}

// Basename index of every non-markdown file in content/, used as a fallback for moved/relative images.
const assetIndex = new Map<string, string>()
for (const f of walk(SRC)) {
    if (IMAGE_TYPES[extname(f).slice(1).toLowerCase()]) assetIndex.set(basename(f).toLowerCase(), f)
}

function safeDecode(s: string): string {
    try { return decodeURIComponent(s) } catch { return s }
}

function resolveLocal(url: string, postFile: string): string | null {
    const clean = safeDecode(url.replace(/^\{(static|filename|attach)\}/, '').split(/[?#]/)[0])
    const candidates = [
        join(SRC, clean.replace(/^\/+/, '')),
        join(dirname(postFile), clean),
        join(SRC, 'images', basename(clean)),
    ]
    for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c
    return assetIndex.get(basename(clean).toLowerCase()) ?? null
}

function cdnUrlFor(key: string): string {
    return `${CDN_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function sanitizeFilename(name: string): string {
    return name.replace(/[^\w.@+-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120) || 'image'
}

async function fetchRemote(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
        const res = await fetch(url.startsWith('//') ? `https:${url}` : url, {
            signal: AbortSignal.timeout(15_000),
            headers: { 'User-Agent': 'Mozilla/5.0 (Lumin importer)' },
            redirect: 'follow',
        })
        if (!res.ok) return null
        const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
        if (!contentType.startsWith('image/')) return null
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null
        return { bytes, contentType }
    } catch {
        return null
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface Report {
    target: string
    dryRun: boolean
    posts: { found: number; skipped: { file: string; reason: string }[]; imported: number; alreadyPresent: number; slugsRenamed: { file: string; from: string; to: string }[] }
    images: { uploaded: number; trackingRemoved: number; broken: string[] }
    warnings: string[]
}

const report: Report = {
    target: TARGET,
    dryRun: DRY_RUN,
    posts: { found: 0, skipped: [], imported: 0, alreadyPresent: 0, slugsRenamed: [] },
    images: { uploaded: 0, trackingRemoved: 0, broken: [] },
    warnings: [],
}

function brokenLine(post: Post, url: string, reason: string): string {
    const short = url.length > 90 ? `${url.slice(0, 60)}…${url.slice(-25)}` : url
    return `${post.slug}  [${reason}]  ${short}`
}

async function main() {
    // 1. Parse
    const files = POST_DIRS
        .map((d) => join(SRC, d))
        .filter(existsSync)
        .flatMap((d) => walk(d))
        .filter((f) => f.endsWith('.md') && !SKIP_PATH_PARTS.some((p) => f.split('/').includes(p)))
        .sort()

    const posts: Post[] = []
    for (const file of files) {
        const { post, skip } = parsePost(file)
        if (skip) report.posts.skipped.push({ file: relative(SRC, file), reason: skip })
        else posts.push(post!)
    }
    // Oldest first so slug suffixes (-2, -3) go to the newer duplicates, and ids follow chronology.
    posts.sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.file.localeCompare(b.file))
    if (posts.length > LIMIT) posts.length = LIMIT
    report.posts.found = posts.length
    console.log(`Parsed ${posts.length} posts, skipped ${report.posts.skipped.length}.`)

    // 2. Look up owner + existing slugs (skipped in dry-run so it needs no wrangler/DB at all)
    let userId = 0
    let channelId = 0
    const takenSlugs = new Set<string>()
    const existingInChannel = new Map<string, { note_id: number; attachment_count: number }>()
    const tmp = mkdtempSync(join(tmpdir(), 'pelican-import-'))

    if (!DRY_RUN) {
        const user = d1Rows<{ id: number }>(`SELECT id FROM users WHERE email = ${q(OWNER_EMAIL)}`)[0]
        if (!user) throw new Error(`No user with email ${OWNER_EMAIL} in the ${TARGET} database`)
        userId = user.id

        d1File(`INSERT OR IGNORE INTO note_channels (user_id, name) VALUES (${userId}, ${q(CHANNEL_NAME)});`, tmp)
        channelId = d1Rows<{ id: number }>(`SELECT id FROM note_channels WHERE user_id = ${userId} AND name = ${q(CHANNEL_NAME)}`)[0].id

        for (const row of d1All<{ slug: string; channel_id: number; note_id: number; attachment_count: number }>(
            'SELECT slug, channel_id, note_id, attachment_count FROM notes WHERE slug IS NOT NULL ORDER BY note_id')) {
            if (row.channel_id === channelId) existingInChannel.set(row.slug, { note_id: row.note_id, attachment_count: row.attachment_count })
            else takenSlugs.add(row.slug)
        }
        console.log(`Owner user #${userId}, channel "${CHANNEL_NAME}" #${channelId}, ${existingInChannel.size} posts already imported.`)
    }

    // 3. Assign unique slugs (deterministic, so re-runs map to the same slugs)
    const batchSlugs = new Set<string>()
    for (const post of posts) {
        const base = post.slug || slugify(post.title)
        let slug = base
        for (let n = 2; takenSlugs.has(slug) || batchSlugs.has(slug); n++) slug = `${base}-${n}`
        if (slug !== base) report.posts.slugsRenamed.push({ file: relative(SRC, post.file), from: base, to: slug })
        batchSlugs.add(slug)
        post.slug = slug
    }

    // 4. Insert new posts
    const toInsert = posts.filter((p) => !existingInChannel.has(p.slug))
    report.posts.alreadyPresent = posts.length - toInsert.length
    report.posts.imported = toInsert.length

    if (!DRY_RUN && toInsert.length) {
        const CHUNK = 40
        for (let i = 0; i < toInsert.length; i += CHUNK) {
            const sql = toInsert.slice(i, i + CHUNK).map((p) => {
                const content = normalizeImageAttrs(p.body)
                if (content.length > 90_000) report.warnings.push(`${relative(SRC, p.file)} is ${content.length} chars — near D1's 100KB statement limit`)
                const excerpt = p.summary || generateExcerpt(p.body, 300)
                return `INSERT INTO notes (user_id, channel_id, type, content, tag_list, created_at, last_modified_at, title, excerpt, slug, is_blog, is_published, published_at)
VALUES (${userId}, ${channelId}, 'note', ${q(content)}, ${q(JSON.stringify(p.tags))}, ${q(p.isoDate)}, ${q(p.isoDate)}, ${q(p.title)}, ${q(excerpt)}, ${q(p.slug)}, 1, 1, ${q(p.isoDate)});`
            }).join('\n')
            d1File(sql, tmp)
            console.log(`  inserted posts ${i + 1}–${Math.min(i + CHUNK, toInsert.length)} of ${toInsert.length}`)
        }
        for (const row of d1All<{ slug: string; note_id: number; attachment_count: number }>(
            `SELECT slug, note_id, attachment_count FROM notes WHERE channel_id = ${channelId} ORDER BY note_id`)) {
            existingInChannel.set(row.slug, { note_id: row.note_id, attachment_count: row.attachment_count })
        }
    }

    // 5. Images
    let trackingPostCount = 0
    for (const [index, post] of posts.entries()) {
        let content = normalizeImageAttrs(post.body)
        const refs = extractImageRefs(content)
        if (!refs.length) continue

        const tracking = refs.filter((r) => r.kind === 'tracking')
        report.images.trackingRemoved += tracking.length
        if (tracking.length) trackingPostCount++
        for (const r of tracking) {
            const escaped = r.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            content = content.replace(new RegExp(`!\\[[^\\]]*\\]\\(\\s*<?${escaped}>?[^)]*\\)(\\{[^}]*\\})?`, 'g'), '')
            content = content.replace(new RegExp(`<img\\b[^>]*\\bsrc=["']${escaped}["'][^>]*>`, 'gi'), '')
        }

        const wanted = refs.filter((r) => r.kind !== 'tracking')
        const existing = existingInChannel.get(post.slug)
        const needsImages = !SKIP_IMAGES && !DRY_RUN && existing && existing.attachment_count === 0

        if (DRY_RUN || SKIP_IMAGES || !needsImages) {
            if (DRY_RUN) {
                for (const r of wanted) {
                    if (r.kind === 'local' && !resolveLocal(r.original, post.file)) {
                        report.images.broken.push(brokenLine(post, r.original, 'local file not found'))
                    }
                }
            }
            continue
        }

        const noteId = existing!.note_id
        const usedNames = new Set<string>()
        const stmts: string[] = []
        let order = 0

        for (const ref of wanted) {
            let bytes: Uint8Array | null = null
            let contentType = ''
            let filename = ''

            if (ref.kind === 'local') {
                const path = resolveLocal(ref.original, post.file)
                if (path) {
                    bytes = new Uint8Array(readFileSync(path))
                    filename = basename(path)
                    contentType = IMAGE_TYPES[extname(path).slice(1).toLowerCase()] ?? ''
                }
            } else {
                const got = await fetchRemote(ref.original)
                if (got) {
                    bytes = got.bytes
                    contentType = got.contentType
                    filename = basename(safeDecode(new URL(ref.original.startsWith('//') ? `https:${ref.original}` : ref.original).pathname))
                } else {
                    // Old hotlinks are often dead; a same-named file in the repo is a good second chance.
                    const alt = assetIndex.get(basename(safeDecode(ref.original.split(/[?#]/)[0])).toLowerCase())
                    if (alt) {
                        bytes = new Uint8Array(readFileSync(alt))
                        filename = basename(alt)
                        contentType = IMAGE_TYPES[extname(alt).slice(1).toLowerCase()] ?? ''
                    }
                }
            }

            if (!bytes || !contentType) {
                report.images.broken.push(brokenLine(post, ref.original, ref.kind === 'local' ? 'local file not found' : 'download failed (site gone or image removed)'))
                continue
            }

            filename = sanitizeFilename(filename)
            if (!extname(filename)) filename += `.${Object.entries(IMAGE_TYPES).find(([, t]) => t === contentType)?.[0] ?? 'img'}`
            while (usedNames.has(filename.toLowerCase())) filename = filename.replace(/(\.[^.]+)$/, `-${order + 1}$1`)
            usedNames.add(filename.toLowerCase())

            const cdnKey = `blog/${noteId}/${filename}`
            const privateKey = `notes/${userId}/${noteId}/${Date.now()}-${crypto.randomUUID()}-${filename}`
            const file = join(tmp, `asset-${index}-${order}`)
            writeFileSync(file, bytes)
            r2Put(CDN_BUCKET, cdnKey, file, contentType, 'public, max-age=31536000, immutable')
            r2Put(PRIVATE_BUCKET, privateKey, file, contentType)
            rmSync(file)

            const attSlug = `att_${crypto.randomUUID().replace(/-/g, '')}`
            stmts.push(`INSERT INTO attachments (attachment_slug, owner_user_id, filename, content_type, size, url, cdn_key, cdn_url)
VALUES (${q(attSlug)}, ${userId}, ${q(filename)}, ${q(contentType)}, ${bytes.length}, ${q(privateKey)}, ${q(cdnKey)}, ${q(cdnUrlFor(cdnKey))});`)
            stmts.push(`INSERT INTO attachment_list (note_id, sort_order, attachment_id)
VALUES (${noteId}, ${order}, (SELECT attachment_id FROM attachments WHERE attachment_slug = ${q(attSlug)}));`)

            content = content.split(ref.original).join(cdnUrlFor(cdnKey))
            order++
            report.images.uploaded++
        }

        if (order > 0 || tracking.length) {
            stmts.push(`UPDATE notes SET content = ${q(content)}, attachment_count = ${order} WHERE note_id = ${noteId};`)
            d1File(stmts.join('\n'), tmp)
            console.log(`  ${post.slug}: ${order} image(s)`)
        }
    }
    if (DRY_RUN) {
        report.images.uploaded = 0
        console.log(`(dry run) ${trackingPostCount} posts contain tracking pixels that would be removed.`)
    }

    rmSync(tmp, { recursive: true, force: true })

    const reportPath = join(process.cwd(), '.import-pelican-report.json')
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log('\n── Summary ──')
    console.log(`posts: ${report.posts.found} found, ${report.posts.imported} ${DRY_RUN ? 'to import' : 'imported'}, ${report.posts.alreadyPresent} already present, ${report.posts.skipped.length} skipped`)
    console.log(`slugs renamed for uniqueness: ${report.posts.slugsRenamed.length}`)
    console.log(`images: ${report.images.uploaded} uploaded, ${report.images.trackingRemoved} tracking pixels removed, ${report.images.broken.length} broken`)
    if (report.warnings.length) console.log(`warnings: ${report.warnings.length}`)
    for (const line of report.images.broken) console.log(`  ✗ ${line}`)
    console.log(`full report: ${reportPath}`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
