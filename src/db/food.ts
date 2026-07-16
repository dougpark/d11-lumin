import type {
    CreateFoodEntryInput,
    FoodEntry,
    ListFoodEntriesOptions,
    UpdateFoodEntryInput,
} from './types.ts'

function clampPerPage(value: number): number {
    if (!Number.isInteger(value) || value < 1) return 20
    return Math.min(value, 100)
}

function getTimeOfDayFromIso(isoTimestamp: string): 'breakfast' | 'lunch' | 'dinner' | 'late-night' {
    const date = new Date(isoTimestamp)
    const totalMinutes = (date.getUTCHours() * 60) + date.getUTCMinutes()

    if (totalMinutes <= ((11 * 60) + 0)) return 'breakfast'
    if (totalMinutes <= ((15 * 60) + 0)) return 'lunch'
    if (totalMinutes <= ((20 * 60) + 0)) return 'dinner'
    return 'late-night'
}

export async function listFoodEntries(
    db: D1Database,
    opts: ListFoodEntriesOptions,
): Promise<{ entries: FoodEntry[]; total: number }> {
    const { user_id, page = 1, per_page = 20 } = opts

    const safePage = Number.isInteger(page) && page > 0 ? page : 1
    const safePerPage = clampPerPage(per_page)
    const offset = (safePage - 1) * safePerPage

    const [rowsResult, countResult] = await Promise.all([
        db
            .prepare(
                `SELECT *
                 FROM food_entries
                 WHERE user_id = ? AND deleted_at IS NULL
                 ORDER BY timestamp DESC, id DESC
                 LIMIT ? OFFSET ?`,
            )
            .bind(user_id, safePerPage, offset)
            .all<FoodEntry>(),
        db
            .prepare('SELECT COUNT(*) AS cnt FROM food_entries WHERE user_id = ? AND deleted_at IS NULL')
            .bind(user_id)
            .first<{ cnt: number }>(),
    ])

    return {
        entries: rowsResult.results,
        total: countResult?.cnt ?? 0,
    }
}

export async function getFoodEntry(
    db: D1Database,
    id: number,
    userId: number,
): Promise<FoodEntry | null> {
    const result = await db
        .prepare('SELECT * FROM food_entries WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1')
        .bind(id, userId)
        .first<FoodEntry>()

    return result ?? null
}

export async function createFoodEntry(
    db: D1Database,
    input: CreateFoodEntryInput,
): Promise<FoodEntry> {
    const {
        user_id,
        feel = null,
        energy = null,
        location = 'home',
        location_exif = null,
        note = null,
        image_url = null,
        timestamp,
    } = input

    const effectiveTimestamp = timestamp ?? new Date().toISOString()
    const timeOfDay = getTimeOfDayFromIso(effectiveTimestamp)

    const created = await db
        .prepare(
            `INSERT INTO food_entries
                (user_id, feel, energy, location, location_exif, time_of_day, note, image_url, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING *`,
        )
        .bind(
            user_id,
            feel,
            energy,
            location,
            location_exif,
            timeOfDay,
            note,
            image_url,
            effectiveTimestamp,
        )
        .first<FoodEntry>()

    if (!created) throw new Error('Failed to create food entry')
    return created
}

export async function updateFoodEntry(
    db: D1Database,
    id: number,
    userId: number,
    input: UpdateFoodEntryInput,
): Promise<FoodEntry | null> {
    const map: Record<string, unknown> = {}

    if ('feel' in input) map.feel = input.feel ?? null
    if ('energy' in input) map.energy = input.energy ?? null
    if ('location' in input) map.location = input.location ?? null
    if ('location_exif' in input) map.location_exif = input.location_exif ?? null
    if ('note' in input) map.note = input.note ?? null
    if ('image_url' in input) map.image_url = input.image_url ?? null
    if ('timestamp' in input && typeof input.timestamp === 'string') {
        map.timestamp = input.timestamp
        map.time_of_day = getTimeOfDayFromIso(input.timestamp)
    }

    const fields = Object.keys(map)
    if (fields.length === 0) return getFoodEntry(db, id, userId)

    const setClauses = fields.map((field) => `${field} = ?`).join(', ')
    const values = fields.map((field) => map[field] as string | number | null)

    const updated = await db
        .prepare(
            `UPDATE food_entries
             SET ${setClauses}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ? AND user_id = ? AND deleted_at IS NULL
             RETURNING *`,
        )
        .bind(...values, id, userId)
        .first<FoodEntry>()

    return updated ?? null
}

export async function softDeleteFoodEntry(
    db: D1Database,
    id: number,
    userId: number,
): Promise<boolean> {
    const result = await db
        .prepare(
            `UPDATE food_entries
             SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        )
        .bind(id, userId)
        .run()

    return (result.meta.changes ?? 0) > 0
}

export async function getFoodImageKey(
    db: D1Database,
    id: number,
    userId: number,
): Promise<string | null> {
    const row = await db
        .prepare('SELECT image_url FROM food_entries WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1')
        .bind(id, userId)
        .first<{ image_url: string | null }>()

    return row?.image_url ?? null
}
