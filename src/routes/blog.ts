// src/routes/blog.ts — public (unauthenticated) blog API backed by notes flagged is_blog+is_published.
// Mounted at '/api' in index.ts so paths resolve to /api/blog.json, /api/blog/tags, /api/blog/:slug.

import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import type { Attachment } from '../db/types.ts'
import { getAdjacentBlogPosts, getBlogPostBySlug, listAllBlogTags, listBlogAttachments, listBlogPosts } from '../db/blog.ts'

const blog = new Hono<{ Bindings: Env; Variables: Variables }>()

const LIST_CACHE_CONTROL = 'public, max-age=300, s-maxage=300'

blog.get('/blog.json', async (c) => {
    const tag = c.req.query('tag')?.trim() || undefined
    const q = c.req.query('q')?.trim() || undefined
    const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10)
    const limit = Number.isInteger(limitParam) ? limitParam : undefined

    const posts = await listBlogPosts(c.env.DB, { tag, q, limit })
    c.header('Cache-Control', LIST_CACHE_CONTROL)
    return c.json({
        data: posts.map((post) => ({
            id: post.note_id,
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt,
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
function rewriteContentToCdnUrls(content: string, attachments: Attachment[]): string {
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
            excerpt: post.excerpt,
            content: rewriteContentToCdnUrls(post.content, attachments),
            tags: JSON.parse(post.tag_list || '[]'),
            published_at: post.published_at,
            attachments: attachments.map((a) => ({ filename: a.filename, content_type: a.content_type, url: a.cdn_url })),
        },
        meta: { prev: neighbors.prev, next: neighbors.next },
    })
})

export default blog
