// src/middleware/authMiddleware.ts
// Hono middleware: validates Bearer token, attaches user to context

import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { extractBearer, hashToken } from '../utils/auth.ts'
import { getUserByTokenHash } from '../db/users.ts'
import type { Env, Variables } from '../index.ts'

export async function authMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
    const bearerToken = extractBearer(c.req.header('Authorization'))
    const cookieToken = getCookie(c, 'd11_auth')
    const token = bearerToken || (cookieToken ? decodeURIComponent(cookieToken) : null)
    if (!token) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    const tokenHash = await hashToken(token)
    const user = await getUserByTokenHash(c.env.DB, tokenHash)
    if (!user) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    // Attach user to context variables for downstream handlers
    c.set('user', user)
    await next()
}
