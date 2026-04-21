// src/middleware/apiTokenMiddleware.ts
//
// Authenticates requests to /api/v1/* using a Bearer token.
//
// Lookup order:
//   1. api_tokens table — named tokens issued via POST /api/v1/tokens
//   2. users.token_hash — fallback so the main session token also works on v1
//      (useful for local development and testing without creating a separate token)
//
// On success: sets c.var.user and (when via api_tokens) c.var.apiToken.
// On failure: returns 401 JSON.

import type { Context, Next } from 'hono'
import { extractBearer, hashToken } from '../utils/auth.ts'
import { getApiTokenByHash, touchApiToken } from '../db/api_tokens.ts'
import { getUserByTokenHash } from '../db/users.ts'
import type { Env, Variables } from '../index.ts'

export async function apiTokenMiddleware(
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next,
) {
    const rawToken = extractBearer(c.req.header('Authorization'))
    if (!rawToken) {
        return c.json({ error: 'Unauthorized', hint: 'Provide an API token via Authorization: Bearer <token>' }, 401)
    }

    const tokenHash = await hashToken(rawToken)

    // ── 1. Check api_tokens table ──────────────────────────────────────────────
    const apiToken = await getApiTokenByHash(c.env.DB, tokenHash)
    if (apiToken) {
        // Look up the owning user
        const user = await c.env.DB
            .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
            .bind(apiToken.user_id)
            .first<import('../db/types.ts').User>()

        if (!user) return c.json({ error: 'Unauthorized' }, 401)

        c.set('user', user)
        c.set('apiToken', apiToken)

        // Fire-and-forget: update last_used_at without blocking the response
        c.executionCtx.waitUntil(touchApiToken(c.env.DB, apiToken.id))

        return next()
    }

    // ── 2. Fall back to main session token (users.token_hash) ─────────────────
    const user = await getUserByTokenHash(c.env.DB, tokenHash)
    if (user) {
        c.set('user', user)
        return next()
    }

    return c.json({ error: 'Unauthorized' }, 401)
}
