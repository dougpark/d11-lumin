// src/routes/settings.ts — user_settings CRUD scoped by app_id

import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import { authMiddleware } from '../middleware/authMiddleware.ts'
import {
    deleteUserSettings,
    getUserSettings,
    isAllowedUserSettingsAppId,
    upsertUserSettings,
} from '../db/user_settings.ts'

const settings = new Hono<{ Bindings: Env; Variables: Variables }>()

settings.use('*', authMiddleware)

function parseSettingsPayload(body: unknown): Record<string, unknown> | null {
    if (typeof body !== 'object' || body === null) return null
    if (!('settings' in body)) return null
    const payload = (body as Record<string, unknown>).settings
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
    return payload as Record<string, unknown>
}

settings.get('/:appId', async (c) => {
    const appId = c.req.param('appId').trim()
    if (!isAllowedUserSettingsAppId(appId)) {
        return c.json({ error: 'invalid app_id' }, 400)
    }

    const user = c.get('user')
    const row = await getUserSettings(c.env.DB, user.id, appId)
    if (!row) {
        return c.json({
            data: {
                user_id: user.id,
                app_id: appId,
                settings: {},
                updated_at: null,
            },
        })
    }

    let settingsJson: Record<string, unknown> = {}
    try {
        const parsed = JSON.parse(row.settings)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            settingsJson = parsed as Record<string, unknown>
        }
    } catch {
        settingsJson = {}
    }

    return c.json({
        data: {
            user_id: row.user_id,
            app_id: row.app_id,
            settings: settingsJson,
            updated_at: row.updated_at,
        },
    })
})

settings.put('/:appId', async (c) => {
    const appId = c.req.param('appId').trim()
    if (!isAllowedUserSettingsAppId(appId)) {
        return c.json({ error: 'invalid app_id' }, 400)
    }

    let body: unknown
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const settingsPayload = parseSettingsPayload(body)
    if (!settingsPayload) {
        return c.json({ error: 'settings object is required' }, 400)
    }

    const user = c.get('user')
    const row = await upsertUserSettings(c.env.DB, user.id, appId, settingsPayload)

    return c.json({
        data: {
            user_id: row.user_id,
            app_id: row.app_id,
            settings: settingsPayload,
            updated_at: row.updated_at,
        },
    })
})

settings.delete('/:appId', async (c) => {
    const appId = c.req.param('appId').trim()
    if (!isAllowedUserSettingsAppId(appId)) {
        return c.json({ error: 'invalid app_id' }, 400)
    }

    const user = c.get('user')
    const deleted = await deleteUserSettings(c.env.DB, user.id, appId)
    if (!deleted) {
        return c.json({ error: 'not found' }, 404)
    }

    return c.json({ deleted: true, app_id: appId })
})

export default settings