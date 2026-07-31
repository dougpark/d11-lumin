// src/db/invites.ts — D1 helper functions for invite_codes / invite_redemptions
//
// Registration always requires a valid invite code (see routes/auth.ts).
// Redemption uses an atomic UPDATE ... WHERE ... (not SELECT-then-UPDATE) so
// two simultaneous redemptions of a single-use code can't both succeed — D1
// has no interactive multi-statement transactions to fall back on.

import type { InviteCode } from './types.ts'

/** Generate a cryptographically random invite code (32 bytes → 64 hex chars). */
export function generateInviteCode(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

/** Create a new invite code. `expiresInDays` defaults to 7. */
export async function createInviteCode(
    db: D1Database,
    data: {
        created_by: number
        note?: string
        max_uses?: number
        expires_in_days?: number
    },
): Promise<InviteCode> {
    const { created_by, note = null, max_uses = 1, expires_in_days = 7 } = data
    const code = generateInviteCode()
    const expiresAt = new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z')

    const result = await db
        .prepare(
            `INSERT INTO invite_codes (code, created_by, note, max_uses, expires_at)
       VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
        )
        .bind(code, created_by, note, max_uses, expiresAt)
        .first<InviteCode>()

    if (!result) throw new Error('Failed to create invite code')
    return result
}

/** List all invite codes (admin view), newest first. */
export async function listInviteCodes(db: D1Database): Promise<InviteCode[]> {
    const result = await db
        .prepare('SELECT * FROM invite_codes ORDER BY created_at DESC')
        .all<InviteCode>()
    return result.results
}

/** Look up an invite code by its raw code value. */
export async function getInviteByCode(db: D1Database, code: string): Promise<InviteCode | null> {
    const result = await db
        .prepare('SELECT * FROM invite_codes WHERE code = ? LIMIT 1')
        .bind(code)
        .first<InviteCode>()
    return result ?? null
}

export type InviteValidity =
    | { valid: true }
    | { valid: false; reason: 'not_found' | 'revoked' | 'expired' | 'used_up' }

/** Pure validity check against an already-fetched row (used for pre-flight checks). */
export function checkInviteValidity(invite: InviteCode | null, now: string): InviteValidity {
    if (!invite) return { valid: false, reason: 'not_found' }
    if (invite.revoked_at) return { valid: false, reason: 'revoked' }
    if (invite.expires_at <= now) return { valid: false, reason: 'expired' }
    if (invite.use_count >= invite.max_uses) return { valid: false, reason: 'used_up' }
    return { valid: true }
}

/**
 * Atomically claim one use of an invite code. Returns the updated row if the
 * claim succeeded (code was valid at the moment of the UPDATE), or null if it
 * was invalid (not found, revoked, expired, or exhausted).
 *
 * Call this BEFORE creating the user account, and call releaseInviteCode()
 * to compensate if account creation subsequently fails.
 */
export async function redeemInviteCode(db: D1Database, code: string): Promise<InviteCode | null> {
    const now = new Date().toISOString()
    const result = await db
        .prepare(
            `UPDATE invite_codes
       SET use_count = use_count + 1
       WHERE code = ? AND revoked_at IS NULL AND expires_at > ? AND use_count < max_uses
       RETURNING *`,
        )
        .bind(code, now)
        .first<InviteCode>()
    return result ?? null
}

/** Compensating release of a claimed slot — call if registration fails after redeemInviteCode(). */
export async function releaseInviteCode(db: D1Database, inviteCodeId: number): Promise<void> {
    await db
        .prepare('UPDATE invite_codes SET use_count = use_count - 1 WHERE id = ? AND use_count > 0')
        .bind(inviteCodeId)
        .run()
}

/** Record which user redeemed which invite code (audit trail). */
export async function recordInviteRedemption(
    db: D1Database,
    inviteCodeId: number,
    userId: number,
): Promise<void> {
    await db
        .prepare('INSERT INTO invite_redemptions (invite_code_id, user_id) VALUES (?, ?)')
        .bind(inviteCodeId, userId)
        .run()
}

export type InviteRedemptionWithUser = {
    id: number
    invite_code_id: number
    user_id: number
    created_at: string
    slug_prefix: string
    full_name: string | null
    email: string | null
}

/** List everyone who redeemed a given invite code, newest first (admin view). */
export async function getInviteRedemptions(
    db: D1Database,
    inviteCodeId: number,
): Promise<InviteRedemptionWithUser[]> {
    const result = await db
        .prepare(
            `SELECT r.id, r.invite_code_id, r.user_id, r.created_at,
              u.slug_prefix, u.full_name, u.email
       FROM invite_redemptions r
       JOIN users u ON u.id = r.user_id
       WHERE r.invite_code_id = ?
       ORDER BY r.created_at DESC`,
        )
        .bind(inviteCodeId)
        .all<InviteRedemptionWithUser>()
    return result.results
}

/** Revoke an invite code (sets revoked_at to now). Returns the updated row, or null if not found. */
export async function revokeInviteCode(db: D1Database, id: number): Promise<InviteCode | null> {
    const result = await db
        .prepare(
            `UPDATE invite_codes
       SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND revoked_at IS NULL
       RETURNING *`,
        )
        .bind(id)
        .first<InviteCode>()
    return result ?? null
}
