// src/utils/notifications.ts — brrr push notification helper

import { getUserSettings } from '../db/user_settings.ts'

export interface BrrrPayload {
    message: string
    title?: string
    thread_id?: string
    sound?: string
    expiration_date?: string
    volume?: number
}

export interface BrrrResult {
    ok: boolean
    status: number
    body: string
}

/**
 * Send a push notification via the brrr service.
 * @param apiKey  The brrr API key (br_usr_… or br_dev_…)
 * @param payload Plain-text string or a rich JSON payload object
 */
export async function sendBrrrNotification(
    apiKey: string,
    payload: string | BrrrPayload,
): Promise<BrrrResult> {
    const url = `https://api.brrr.now/v1/${encodeURIComponent(apiKey)}`

    const isJson = typeof payload !== 'string'
    const response = await fetch(url, {
        method: 'POST',
        headers: isJson
            ? { 'Content-Type': 'application/json' }
            : { 'Content-Type': 'text/plain' },
        body: isJson ? JSON.stringify(payload) : payload,
    })

    const body = await response.text()
    return { ok: response.ok, status: response.status, body }
}

/**
 * Look up the logged-in user's brrr API key from D1 and send them a notification.
 * Returns silently (ok: false) when no key is configured — callers decide whether to throw.
 *
 * @example
 * // inside any authenticated Hono handler:
 * await notifyUser(c.env.DB, c.get('user').id, { title: 'Done', message: 'Your export is ready.' })
 */
export async function notifyUser(
    db: D1Database,
    userId: number,
    payload: string | BrrrPayload,
): Promise<BrrrResult & { skipped?: boolean }> {
    const row = await getUserSettings(db, userId, 'system')
    if (!row) return { ok: false, skipped: true, status: 0, body: 'no system settings' }

    let systemSettings: Record<string, unknown> = {}
    try {
        const parsed = JSON.parse(row.settings)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            systemSettings = parsed as Record<string, unknown>
        }
    } catch {
        return { ok: false, skipped: true, status: 0, body: 'settings parse error' }
    }

    const notif = systemSettings.notifications
    const apiKey =
        notif &&
            typeof notif === 'object' &&
            !Array.isArray(notif) &&
            typeof (notif as Record<string, unknown>).brrr_api_key === 'string'
            ? ((notif as Record<string, unknown>).brrr_api_key as string).trim()
            : ''

    if (!apiKey) return { ok: false, skipped: true, status: 0, body: 'no api key configured' }

    return sendBrrrNotification(apiKey, payload)
}
