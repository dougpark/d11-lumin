// src/routes/blog.ts — public (unauthenticated) blog API backed by notes flagged is_blog+is_published.
// Mounted at '/api' in index.ts so paths resolve to /api/blog.json, /api/blog/tags, /api/blog/:slug.

import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import type { Attachment } from '../db/types.ts'
import { getAdjacentBlogPosts, getBlogPostBySlug, listAllBlogTags, listBlogArchive, listBlogAttachments, listBlogAttachmentsForNotes, listBlogPosts } from '../db/blog.ts'
import { generateExcerpt } from '../utils/slug.ts'

const blog = new Hono<{ Bindings: Env; Variables: Variables }>()

const LIST_CACHE_CONTROL = 'public, max-age=300, s-maxage=300'

// Full posts per page on the blog home page (/blog, /blog/page/2, …).
export const BLOG_PAGE_SIZE = 20

// Falls back to the first 500 chars of the (markdown-stripped) post body when no excerpt is set.
function resolveExcerpt(excerpt: string, content: string): string {
    return excerpt.trim() || generateExcerpt(content, 500)
}

// ?page=N returns BLOG_PAGE_SIZE posts plus meta.has_more; without it, ?limit (max 50) keeps the old behaviour.
blog.get('/blog.json', async (c) => {
    const tag = c.req.query('tag')?.trim() || undefined
    const q = c.req.query('q')?.trim() || undefined
    const pageParam = Number.parseInt(c.req.query('page') ?? '', 10)
    const page = Number.isInteger(pageParam) && pageParam > 0 ? Math.min(pageParam, 1000) : null
    const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = page ? BLOG_PAGE_SIZE + 1 : Number.isInteger(limitParam) ? Math.min(limitParam, 50) : undefined
    const offset = page ? (page - 1) * BLOG_PAGE_SIZE : 0

    const rows = await listBlogPosts(c.env.DB, { tag, q, limit, offset })
    const hasMore = page !== null && rows.length > BLOG_PAGE_SIZE
    const posts = page ? rows.slice(0, BLOG_PAGE_SIZE) : rows
    const attachmentsByNoteId = await listBlogAttachmentsForNotes(c.env.DB, posts.map((post) => post.note_id))
    c.header('Cache-Control', LIST_CACHE_CONTROL)
    return c.json({
        data: posts.map((post) => ({
            id: post.note_id,
            title: post.title,
            slug: post.slug,
            excerpt: resolveExcerpt(post.excerpt, post.content),
            content: rewriteContentToCdnUrls(post.content, attachmentsByNoteId.get(post.note_id) ?? []),
            tags: JSON.parse(post.tag_list || '[]'),
            published_at: post.published_at,
        })),
        meta: page ? { page, page_size: BLOG_PAGE_SIZE, has_more: hasMore } : undefined,
    })
})

// Every matching post, title/slug/date only — powers the year-grouped archive page.
blog.get('/blog/archive.json', async (c) => {
    const tag = c.req.query('tag')?.trim() || undefined
    const q = c.req.query('q')?.trim() || undefined
    const posts = await listBlogArchive(c.env.DB, { tag, q })
    c.header('Cache-Control', LIST_CACHE_CONTROL)
    return c.json({ data: posts })
})

blog.get('/blog/tags', async (c) => {
    const tags = await listAllBlogTags(c.env.DB)
    c.header('Cache-Control', LIST_CACHE_CONTROL)
    return c.json({ data: tags })
})

// Rewrites private attachment permalinks (/api/notes/attachments/p/:slug) embedded in note
// content to their public CDN URLs — done at read time so the stored note content never
// needs mutating and unpublishing is a no-op for the editor's own copy of the content.
export function rewriteContentToCdnUrls(content: string, attachments: Attachment[]): string {
    let rewritten = content
    for (const attachment of attachments) {
        if (!attachment.cdn_url) continue
        const permalinkPattern = new RegExp(`https?://[^\\s)]*/api/notes/attachments/p/${attachment.attachment_slug}`, 'g')
        rewritten = rewritten.replace(permalinkPattern, attachment.cdn_url)
    }
    return rewritten
}

blog.get('/blog/:slug', async (c) => {
    const slug = c.req.param('slug')?.trim().toLowerCase() ?? ''
    if (!slug) return c.json({ error: 'Not found' }, 404)

    const post = await getBlogPostBySlug(c.env.DB, slug)
    if (!post) return c.json({ error: 'Not found' }, 404)

    const [attachments, neighbors] = await Promise.all([
        listBlogAttachments(c.env.DB, post.note_id),
        getAdjacentBlogPosts(c.env.DB, post.published_at as string),
    ])

    c.header('Cache-Control', LIST_CACHE_CONTROL)
    return c.json({
        data: {
            id: post.note_id,
            title: post.title,
            slug: post.slug,
            excerpt: resolveExcerpt(post.excerpt, post.content),
            content: rewriteContentToCdnUrls(post.content, attachments),
            tags: JSON.parse(post.tag_list || '[]'),
            published_at: post.published_at,
            attachments: attachments.map((a) => ({ filename: a.filename, content_type: a.content_type, url: a.cdn_url })),
        },
        meta: { prev: neighbors.prev, next: neighbors.next },
    })
})

export default blog
