// src/routes/auth.ts — POST /api/auth/register and POST /api/auth/login

import { Hono } from 'hono'
import type { Env } from '../index.ts'
import { hashToken, generateToken, extractBearer, checkInviteRateLimit } from '../utils/auth.ts'
import { getUserByTokenHash, createUser, updateUserTokenHash } from '../db/users.ts'
import {
    getInviteByCode,
    checkInviteValidity,
    redeemInviteCode,
    releaseInviteCode,
    recordInviteRedemption,
} from '../db/invites.ts'

const auth = new Hono<{ Bindings: Env }>()

/** Best-effort client identifier for rate limiting (Cloudflare sets this at the edge). */
function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
    return c.req.header('CF-Connecting-IP') || 'unknown'
}

/**
 * GET /api/auth/bootstrap-status
 *
 * Tells the registration UI whether this is a fresh install with zero users —
 * the only case where registering without an invite code is allowed (there's
 * no admin yet to have created one). Once any user exists this always
 * reports false and every subsequent registration requires a valid invite.
 */
auth.get('/bootstrap-status', async (c) => {
    const row = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM users').first<{ cnt: number }>()
    return c.json({ bootstrap_available: (row?.cnt ?? 0) === 0 })
})

/**
 * GET /api/auth/invite/:code
 *
 * Pre-flight validation, used by the registration UI to show an error
 * before the user fills out the form. Does not consume a use.
 */
auth.get('/invite/:code', async (c) => {
    if (!checkInviteRateLimit(clientIp(c))) {
        return c.json({ valid: false, reason: 'rate_limited' }, 429)
    }

    const code = c.req.param('code')
    if (!code) return c.json({ valid: false, reason: 'not_found' }, 400)

    const invite = await getInviteByCode(c.env.DB, code)
    const now = new Date().toISOString()
    const result = checkInviteValidity(invite, now)

    return c.json(result)
})

/**
 * POST /api/auth/register
 * Body: { slug_prefix, full_name?, email?, phone?, invite }
 *
 * Creates a new user and returns a plain token (shown once — never stored).
 * The client must save this token; subsequent requests use it as Bearer.
 *
 * Registration requires a valid invite code, EXCEPT for the very first user
 * ever created (bootstrap case — no admin exists yet to have created an
 * invite). See docs/88-user-register/invite.md and AGENTS.md for the manual
 * is_admin promotion step that follows that bootstrap registration.
 *
 * The invite is claimed atomically (redeemInviteCode) before the user row is
 * created; if account creation then fails, the claimed slot is released
 * (releaseInviteCode) so the code remains usable.
 */
auth.post('/register', async (c) => {
    if (!checkInviteRateLimit(clientIp(c))) {
        return c.json({ error: 'Too many attempts. Try again in a minute.' }, 429)
    }

    const body = await c.req.json<{
        slug_prefix?: string
        full_name?: string
        email?: string
        phone?: string
        invite?: string
    }>()

    const { slug_prefix, full_name, email, phone, invite } = body

    if (!slug_prefix || !/^[a-z0-9_-]{2,32}$/.test(slug_prefix)) {
        return c.json(
            { error: 'slug_prefix is required and must be 2-32 lowercase alphanumeric/dash/underscore characters' },
            400,
        )
    }

    const userCountRow = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM users').first<{ cnt: number }>()
    const isBootstrap = (userCountRow?.cnt ?? 0) === 0

    let claimed: Awaited<ReturnType<typeof redeemInviteCode>> = null
    if (!isBootstrap) {
        if (!invite || typeof invite !== 'string') {
            return c.json({ error: 'An invite code is required to register. Contact an admin for an invite link.' }, 400)
        }

        claimed = await redeemInviteCode(c.env.DB, invite)
        if (!claimed) {
            return c.json({ error: 'This invite link is invalid, expired, revoked, or has already been used. Contact an admin for a new invite.' }, 400)
        }
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

        if (claimed) {
            c.executionCtx.waitUntil(recordInviteRedemption(c.env.DB, claimed.id, user.id))
        }

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
        // Account creation failed (e.g. slug_prefix/email already taken) — release the
        // claimed slot so the invite code remains usable for a retry.
        if (claimed) {
            c.executionCtx.waitUntil(releaseInviteCode(c.env.DB, claimed.id))
        }
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
