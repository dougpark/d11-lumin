// src/db/api_tokens.ts — D1 helper functions for the api_tokens table

import type { ApiToken } from './types.ts'

/** Look up an API token by its SHA-256 hash. Returns null if not found or expired. */
export async function getApiTokenByHash(
    db: D1Database,
    tokenHash: string,
): Promise<ApiToken | null> {
    const result = await db
        .prepare(
            `SELECT * FROM api_tokens
             WHERE token_hash = ?
               AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             LIMIT 1`,
        )
        .bind(tokenHash)
        .first<ApiToken>()
    return result ?? null
}

/** Update last_used_at for a token (fire-and-forget — use with waitUntil). */
export async function touchApiToken(db: D1Database, id: number): Promise<void> {
    await db
        .prepare(`UPDATE api_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`)
        .bind(id)
        .run()
}

/** Create a new named API token for a user. Stores only the hash; caller provides raw token. */
export async function createApiToken(
    db: D1Database,
    data: {
        user_id: number
        name: string
        token_hash: string
        scopes?: string[]
        expires_at?: string
    },
): Promise<ApiToken> {
    const scopes = JSON.stringify(data.scopes ?? ['posts:read', 'tags:read'])
    const result = await db
        .prepare(
            `INSERT INTO api_tokens (user_id, name, token_hash, scopes, expires_at)
             VALUES (?, ?, ?, ?, ?)
             RETURNING *`,
        )
        .bind(data.user_id, data.name.trim(), data.token_hash, scopes, data.expires_at ?? null)
        .first<ApiToken>()
    return result!
}

/** List all API tokens for a user (safe to return — token_hash is never raw). */
export async function listApiTokens(db: D1Database, userId: number): Promise<ApiToken[]> {
    const { results } = await db
        .prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC')
        .bind(userId)
        .all<ApiToken>()
    return results
}

/** Delete a single API token scoped to a user. Returns true if a row was deleted. */
export async function deleteApiToken(
    db: D1Database,
    id: number,
    userId: number,
): Promise<boolean> {
    const result = await db
        .prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?')
        .bind(id, userId)
        .run()
    return (result.meta.changes ?? 0) > 0
}
