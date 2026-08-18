// src/db/blog.ts — public read helpers for the notes → blog feature.
// Unlike src/db/notes.ts, everything here is scoped to is_blog=1 AND is_published=1
// and never exposes private-only columns (user_id, channel_id, etc.).

import type { Attachment, Note } from './types.ts'

export type BlogPostSummary = Pick<Note, 'note_id' | 'title' | 'slug' | 'excerpt' | 'tag_list' | 'published_at' | 'content'>

export async function listBlogPosts(
    db: D1Database,
    opts: { tag?: string; q?: string; limit?: number } = {},
): Promise<BlogPostSummary[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 50)
    const filters = ['is_blog = 1', 'is_published = 1']
    const bindings: (string | number)[] = []

    if (opts.tag) {
        filters.push('EXISTS (SELECT 1 FROM json_each(notes.tag_list) WHERE json_each.value = ?)')
        bindings.push(opts.tag)
    }

    if (opts.q) {
        filters.push('(title LIKE ? OR excerpt LIKE ?)')
        const like = `%${opts.q}%`
        bindings.push(like, like)
    }

    const result = await db
        .prepare(
            `SELECT note_id, title, slug, excerpt, tag_list, published_at, content
             FROM notes
             WHERE ${filters.join(' AND ')}
             ORDER BY published_at DESC
             LIMIT ?`,
        )
        .bind(...bindings, limit)
        .all<BlogPostSummary>()

    return result.results
}

export async function getBlogPostBySlug(db: D1Database, slug: string): Promise<Note | null> {
    const note = await db
        .prepare('SELECT * FROM notes WHERE slug = ? AND is_blog = 1 AND is_published = 1 LIMIT 1')
        .bind(slug)
        .first<Note>()
    return note ?? null
}

export async function listBlogAttachments(db: D1Database, noteId: number): Promise<Attachment[]> {
    const result = await db
        .prepare(
            `SELECT a.*
             FROM attachment_list al
             JOIN attachments a ON a.attachment_id = al.attachment_id
             WHERE al.note_id = ?
             ORDER BY al.sort_order ASC, a.attachment_id ASC`,
        )
        .bind(noteId)
        .all<Attachment>()
    return result.results
}

// Prev/next by published_at for single-post navigation.
export async function getAdjacentBlogPosts(
    db: D1Database,
    publishedAt: string,
): Promise<{ prev: BlogPostSummary | null; next: BlogPostSummary | null }> {
    const [prev, next] = await Promise.all([
        db
            .prepare(
                `SELECT note_id, title, slug, excerpt, tag_list, published_at
                 FROM notes
                 WHERE is_blog = 1 AND is_published = 1 AND published_at < ?
                 ORDER BY published_at DESC LIMIT 1`,
            )
            .bind(publishedAt)
            .first<BlogPostSummary>(),
        db
            .prepare(
                `SELECT note_id, title, slug, excerpt, tag_list, published_at
                 FROM notes
                 WHERE is_blog = 1 AND is_published = 1 AND published_at > ?
                 ORDER BY published_at ASC LIMIT 1`,
            )
            .bind(publishedAt)
            .first<BlogPostSummary>(),
    ])
    return { prev: prev ?? null, next: next ?? null }
}

export async function listAllBlogTags(db: D1Database): Promise<string[]> {
    const result = await db
        .prepare(
            `SELECT DISTINCT value AS tag
             FROM notes, json_each(notes.tag_list)
             WHERE is_blog = 1 AND is_published = 1 AND TRIM(value) != ''
             ORDER BY tag ASC`,
        )
        .all<{ tag: string }>()
    return result.results.map((row) => row.tag)
}

export type BlogRssPost = Pick<Note, 'note_id' | 'title' | 'slug' | 'excerpt' | 'content' | 'published_at'>

// Includes full content (unlike listBlogPosts) since RSS readers expect the full post body.
export async function listBlogPostsForRss(db: D1Database, limit = 20): Promise<BlogRssPost[]> {
    const result = await db
        .prepare(
            `SELECT note_id, title, slug, excerpt, content, published_at
             FROM notes
             WHERE is_blog = 1 AND is_published = 1
             ORDER BY published_at DESC
             LIMIT ?`,
        )
        .bind(limit)
        .all<BlogRssPost>()
    return result.results
}
