// src/db/sharedTags.ts — D1 helper functions for the shared_tags table
// A row is the sole gate for GET /:handle/share/:tag — no row means 404,
// regardless of whether bookmarks under that tag are public.

import type { SharedTag } from './types.ts'

/** List every tag a user has shared, most recently shared first. */
export async function listSharedTags(db: D1Database, userId: number): Promise<SharedTag[]> {
    const result = await db
        .prepare('SELECT * FROM shared_tags WHERE user_id = ? ORDER BY created_at DESC')
        .bind(userId)
        .all<SharedTag>()
    return result.results
}

/** Look up a single shared-tag row, scoped to its owner. Returns null if not shared. */
export async function getSharedTag(db: D1Database, userId: number, tag: string): Promise<SharedTag | null> {
    const result = await db
        .prepare('SELECT * FROM shared_tags WHERE user_id = ? AND tag = ? LIMIT 1')
        .bind(userId, tag)
        .first<SharedTag>()
    return result ?? null
}

/** Enable sharing for a tag (idempotent — re-sharing an already-shared tag is a no-op). */
export async function shareTag(db: D1Database, userId: number, tag: string): Promise<SharedTag> {
    const result = await db
        .prepare(
            `INSERT INTO shared_tags (user_id, tag) VALUES (?, ?)
             ON CONFLICT (user_id, tag) DO UPDATE SET tag = tag
             RETURNING *`,
        )
        .bind(userId, tag)
        .first<SharedTag>()
    if (!result) throw new Error('Failed to share tag')
    return result
}

/** Disable sharing for a tag. Returns false if it wasn't shared. */
export async function unshareTag(db: D1Database, userId: number, tag: string): Promise<boolean> {
    const result = await db
        .prepare('DELETE FROM shared_tags WHERE user_id = ? AND tag = ?')
        .bind(userId, tag)
        .run()
    return result.meta.changes > 0
}

/** Fire-and-forget view counter — only call for non-owner visits. */
export async function incrementSharedTagViews(db: D1Database, id: number): Promise<void> {
    await db.prepare('UPDATE shared_tags SET view_count = view_count + 1 WHERE id = ?').bind(id).run()
}
