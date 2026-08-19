// src/routes/blog.ts — public (unauthenticated) blog API backed by notes flagged is_blog+is_published.
// Mounted at '/api' in index.ts so paths resolve to /api/blog.json, /api/blog/tags, /api/blog/:slug.

import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import type { Attachment } from '../db/types.ts'
import { getAdjacentBlogPosts, getBlogPostBySlug, listAllBlogTags, listBlogAttachments, listBlogAttachmentsForNotes, listBlogPosts } from '../db/blog.ts'
import { generateExcerpt } from '../utils/slug.ts'

const blog = new Hono<{ Bindings: Env; Variables: Variables }>()

const LIST_CACHE_CONTROL = 'public, max-age=300, s-maxage=300'

// Falls back to the first 500 chars of the (markdown-stripped) post body when no excerpt is set.
function resolveExcerpt(excerpt: string, content: string): string {
    return excerpt.trim() || generateExcerpt(content, 500)
}

blog.get('/blog.json', async (c) => {
    const tag = c.req.query('tag')?.trim() || undefined
    const q = c.req.query('q')?.trim() || undefined
    const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = Number.isInteger(limitParam) ? limitParam : undefined

    const posts = await listBlogPosts(c.env.DB, { tag, q, limit })
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
    })
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
