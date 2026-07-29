// src/routes/auth.ts — POST /api/auth/register and POST /api/auth/login

import { Hono } from 'hono'
import type { Env } from '../index.ts'
import { hashToken, generateToken, extractBearer } from '../utils/auth.ts'
import { getUserByTokenHash, createUser, updateUserTokenHash } from '../db/users.ts'

const auth = new Hono<{ Bindings: Env }>()

/**
 * POST /api/auth/register
 * Body: { slug_prefix, full_name?, email?, phone? }
 *
 * Creates a new user and returns a plain token (shown once — never stored).
 * The client must save this token; subsequent requests use it as Bearer.
 */
auth.post('/register', async (c) => {
    const body = await c.req.json<{
        slug_prefix?: string
        full_name?: string
        email?: string
        phone?: string
    }>()

    const { slug_prefix, full_name, email, phone } = body

    if (!slug_prefix || !/^[a-z0-9_-]{2,32}$/.test(slug_prefix)) {
        return c.json(
            { error: 'slug_prefix is required and must be 2-32 lowercase alphanumeric/dash/underscore characters' },
            400,
        )
    }

    const plainToken = generateToken()
    const tokenHash = await hashToken(plainToken)

    try {
        const user = await createUser(c.env.DB, {
            token_hash: tokenHash,
            slug_prefix,
            full_name,
            email,
            phone,
        })

        return c.json({
            message: 'User created. Save your token — it will not be shown again.',
            token: plainToken,   // shown exactly once
            user: {
                id: user.id,
                slug_prefix: user.slug_prefix,
                full_name: user.full_name,
                email: user.email,
                created_at: user.created_at,
            },
        }, 201)
    } catch {
        return c.json({ error: 'slug_prefix or email already taken' }, 409)
    }
})

/**
 * GET /api/auth/me
 * Returns the authenticated user's profile.
 * Requires Bearer token.
 */
auth.get('/me', async (c) => {
    const authHeader = c.req.header('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
    if (!token) return c.json({ error: 'Unauthorized' }, 401)

    const tokenHash = await hashToken(token)
    const user = await getUserByTokenHash(c.env.DB, tokenHash)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    return c.json({
        id: user.id,
        slug_prefix: user.slug_prefix,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        created_at: user.created_at,
        is_admin: user.is_admin,
    })
})

/**
 * POST /api/auth/rotate-token
 * Requires Bearer token (current session token).
 *
 * Issues a brand new session token for the authenticated user and
 * invalidates the old one immediately (single global token per user —
 * this signs out every other browser/device, not just this one).
 * Returns the plain token — shown once — never stored.
 */
auth.post('/rotate-token', async (c) => {
    const token = extractBearer(c.req.header('Authorization'))
    if (!token) return c.json({ error: 'Unauthorized' }, 401)

    const tokenHash = await hashToken(token)
    const user = await getUserByTokenHash(c.env.DB, tokenHash)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const plainToken = generateToken()
    const newTokenHash = await hashToken(plainToken)
    const updated = await updateUserTokenHash(c.env.DB, user.id, newTokenHash)
    if (!updated) return c.json({ error: 'Could not rotate token' }, 500)

    console.log('session token rotated', { userId: user.id, at: new Date().toISOString() })

    return c.json({
        message: 'Session token rotated. Save it now — it will not be shown again.',
        token: plainToken,   // shown exactly once
    })
})

export default auth
