// src/db/user_settings.ts — D1 helper functions for the user_settings table

import type { UserSettings } from './types.ts'

export const USER_SETTINGS_DEFAULT_APP_IDS = [
    'dashboard',
    'news',
    'explore',
    'chat',
    'notes',
    'health',
    'food',
    'drive',
    'profile',
    'system',
] as const

export type UserSettingsAppId = (typeof USER_SETTINGS_DEFAULT_APP_IDS)[number]

export function isAllowedUserSettingsAppId(appId: string): appId is UserSettingsAppId {
    return (USER_SETTINGS_DEFAULT_APP_IDS as readonly string[]).includes(appId)
}

export async function getUserSettings(
    db: D1Database,
    userId: number,
    appId: string,
): Promise<UserSettings | null> {
    const row = await db
        .prepare('SELECT * FROM user_settings WHERE user_id = ? AND app_id = ? LIMIT 1')
        .bind(userId, appId)
        .first<UserSettings>()
    return row ?? null
}

export async function upsertUserSettings(
    db: D1Database,
    userId: number,
    appId: string,
    settings: Record<string, unknown>,
): Promise<UserSettings> {
    const payload = JSON.stringify(settings ?? {})
    const row = await db
        .prepare(
            `INSERT INTO user_settings (user_id, app_id, settings, updated_at)
             VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             ON CONFLICT(user_id, app_id) DO UPDATE SET
               settings = excluded.settings,
               updated_at = excluded.updated_at
             RETURNING *`,
        )
        .bind(userId, appId, payload)
        .first<UserSettings>()

    if (!row) throw new Error('Failed to upsert user settings')
    return row
}

export async function deleteUserSettings(
    db: D1Database,
    userId: number,
    appId: string,
): Promise<boolean> {
    const result = await db
        .prepare('DELETE FROM user_settings WHERE user_id = ? AND app_id = ?')
        .bind(userId, appId)
        .run()
    return (result.meta.changes ?? 0) > 0
}