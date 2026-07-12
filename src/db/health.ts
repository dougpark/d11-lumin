import type {
    CreateHealthEntryInput,
    HealthEntry,
    ListHealthEntriesOptions,
    UpdateHealthEntryInput,
} from './types.ts'

type HealthPoint = { timestamp: string; value: number }
type BloodPressurePoint = { timestamp: string; systolic: number; diastolic: number }

export type HealthAnalysisResult = {
    summary: {
        total_entries: number
        range_start: string | null
        range_end: string | null
        latest_entry_at: string | null
        with_weight: number
        with_glucose_level: number
        with_blood_pressure: number
        with_heart_rate: number
        avg_weight: number | null
        avg_glucose_level: number | null
        avg_heart_rate: number | null
        avg_bp_systolic: number | null
        avg_bp_diastolic: number | null
    }
    series: {
        weight: HealthPoint[]
        glucose_level: HealthPoint[]
        heart_rate: HealthPoint[]
        blood_pressure: BloodPressurePoint[]
    }
}

function round2(value: number): number {
    return Math.round(value * 100) / 100
}

function parseBloodPressure(value: string | null): { systolic: number; diastolic: number } | null {
    if (!value) return null
    const match = value.trim().match(/^(\d{1,3})\s*\/\s*(\d{1,3})$/)
    if (!match) return null
    const systolic = Number.parseInt(match[1], 10)
    const diastolic = Number.parseInt(match[2], 10)
    if (!Number.isInteger(systolic) || !Number.isInteger(diastolic)) return null
    return { systolic, diastolic }
}

function clampPerPage(value: number): number {
    if (!Number.isInteger(value) || value < 1) return 20
    return Math.min(value, 100)
}

export async function listHealthEntries(
    db: D1Database,
    opts: ListHealthEntriesOptions,
): Promise<{ entries: HealthEntry[]; total: number }> {
    const {
        user_id,
        page = 1,
        per_page = 20,
        since,
        before,
    } = opts

    const safePage = Number.isInteger(page) && page > 0 ? page : 1
    const safePerPage = clampPerPage(per_page)
    const offset = (safePage - 1) * safePerPage

    const conditions: string[] = ['user_id = ?', 'deleted_at IS NULL']
    const bindings: Array<string | number> = [user_id]

    if (since) {
        conditions.push('timestamp >= ?')
        bindings.push(since)
    }
    if (before) {
        conditions.push('timestamp <= ?')
        bindings.push(before)
    }

    const where = conditions.join(' AND ')

    const [rowsResult, countResult] = await Promise.all([
        db
            .prepare(
                `SELECT *
                 FROM health_entries
                 WHERE ${where}
                 ORDER BY timestamp DESC, id DESC
                 LIMIT ? OFFSET ?`,
            )
            .bind(...bindings, safePerPage, offset)
            .all<HealthEntry>(),
        db
            .prepare(`SELECT COUNT(*) AS cnt FROM health_entries WHERE ${where}`)
            .bind(...bindings)
            .first<{ cnt: number }>(),
    ])

    return {
        entries: rowsResult.results,
        total: countResult?.cnt ?? 0,
    }
}

export async function getHealthEntry(
    db: D1Database,
    id: number,
    userId: number,
): Promise<HealthEntry | null> {
    const result = await db
        .prepare('SELECT * FROM health_entries WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1')
        .bind(id, userId)
        .first<HealthEntry>()
    return result ?? null
}

export async function createHealthEntry(
    db: D1Database,
    input: CreateHealthEntryInput,
): Promise<HealthEntry> {
    const {
        user_id,
        weight = null,
        glucose_level = null,
        blood_pressure = null,
        heart_rate = null,
        note = null,
        timestamp,
    } = input

    const result = await db
        .prepare(
            `INSERT INTO health_entries
                (user_id, weight, glucose_level, blood_pressure, heart_rate, note, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))
             RETURNING *`,
        )
        .bind(
            user_id,
            weight,
            glucose_level,
            blood_pressure,
            heart_rate,
            note,
            timestamp ?? null,
        )
        .first<HealthEntry>()

    if (!result) throw new Error('Failed to create health entry')
    return result
}

export async function updateHealthEntry(
    db: D1Database,
    id: number,
    userId: number,
    input: UpdateHealthEntryInput,
): Promise<HealthEntry | null> {
    const map: Record<string, unknown> = {}

    if ('weight' in input) map.weight = input.weight ?? null
    if ('glucose_level' in input) map.glucose_level = input.glucose_level ?? null
    if ('blood_pressure' in input) map.blood_pressure = input.blood_pressure ?? null
    if ('heart_rate' in input) map.heart_rate = input.heart_rate ?? null
    if ('note' in input) map.note = input.note ?? null
    if ('timestamp' in input) map.timestamp = input.timestamp

    const fields = Object.keys(map)
    if (fields.length === 0) return getHealthEntry(db, id, userId)

    const setClauses = fields.map((field) => `${field} = ?`).join(', ')
    const values = fields.map((field) => map[field] as string | number | null)

    const result = await db
        .prepare(
            `UPDATE health_entries
             SET ${setClauses}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ? AND user_id = ? AND deleted_at IS NULL
             RETURNING *`,
        )
        .bind(...values, id, userId)
        .first<HealthEntry>()

    return result ?? null
}

export async function softDeleteHealthEntry(
    db: D1Database,
    id: number,
    userId: number,
): Promise<boolean> {
    const result = await db
        .prepare(
            `UPDATE health_entries
             SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        )
        .bind(id, userId)
        .run()
    return (result.meta.changes ?? 0) > 0
}

export async function getHealthAnalysis(
    db: D1Database,
    userId: number,
    opts?: { since?: string; before?: string },
): Promise<HealthAnalysisResult> {
    const conditions: string[] = ['user_id = ?', 'deleted_at IS NULL']
    const bindings: Array<string | number> = [userId]

    if (opts?.since) {
        conditions.push('timestamp >= ?')
        bindings.push(opts.since)
    }
    if (opts?.before) {
        conditions.push('timestamp <= ?')
        bindings.push(opts.before)
    }

    const where = conditions.join(' AND ')

    const rows = await db
        .prepare(
            `SELECT id, timestamp, weight, glucose_level, blood_pressure, heart_rate
             FROM health_entries
             WHERE ${where}
             ORDER BY timestamp ASC, id ASC`,
        )
        .bind(...bindings)
        .all<Pick<HealthEntry, 'id' | 'timestamp' | 'weight' | 'glucose_level' | 'blood_pressure' | 'heart_rate'>>()

    const weightSeries: HealthPoint[] = []
    const glucoseSeries: HealthPoint[] = []
    const heartSeries: HealthPoint[] = []
    const bloodSeries: BloodPressurePoint[] = []

    let weightTotal = 0
    let glucoseTotal = 0
    let heartTotal = 0
    let bpSysTotal = 0
    let bpDiaTotal = 0

    let withWeight = 0
    let withGlucose = 0
    let withHeart = 0
    let withBp = 0

    for (const row of rows.results) {
        if (typeof row.weight === 'number') {
            weightSeries.push({ timestamp: row.timestamp, value: row.weight })
            withWeight += 1
            weightTotal += row.weight
        }

        if (typeof row.glucose_level === 'number') {
            glucoseSeries.push({ timestamp: row.timestamp, value: row.glucose_level })
            withGlucose += 1
            glucoseTotal += row.glucose_level
        }

        if (typeof row.heart_rate === 'number') {
            heartSeries.push({ timestamp: row.timestamp, value: row.heart_rate })
            withHeart += 1
            heartTotal += row.heart_rate
        }

        const bloodPressure = parseBloodPressure(row.blood_pressure)
        if (bloodPressure) {
            bloodSeries.push({ timestamp: row.timestamp, systolic: bloodPressure.systolic, diastolic: bloodPressure.diastolic })
            withBp += 1
            bpSysTotal += bloodPressure.systolic
            bpDiaTotal += bloodPressure.diastolic
        }
    }

    const totalEntries = rows.results.length
    const rangeStart = totalEntries > 0 ? rows.results[0].timestamp : null
    const rangeEnd = totalEntries > 0 ? rows.results[totalEntries - 1].timestamp : null

    return {
        summary: {
            total_entries: totalEntries,
            range_start: rangeStart,
            range_end: rangeEnd,
            latest_entry_at: rangeEnd,
            with_weight: withWeight,
            with_glucose_level: withGlucose,
            with_blood_pressure: withBp,
            with_heart_rate: withHeart,
            avg_weight: withWeight > 0 ? round2(weightTotal / withWeight) : null,
            avg_glucose_level: withGlucose > 0 ? round2(glucoseTotal / withGlucose) : null,
            avg_heart_rate: withHeart > 0 ? round2(heartTotal / withHeart) : null,
            avg_bp_systolic: withBp > 0 ? round2(bpSysTotal / withBp) : null,
            avg_bp_diastolic: withBp > 0 ? round2(bpDiaTotal / withBp) : null,
        },
        series: {
            weight: weightSeries,
            glucose_level: glucoseSeries,
            heart_rate: heartSeries,
            blood_pressure: bloodSeries,
        },
    }
}

export async function listHealthEntriesForExport(
    db: D1Database,
    userId: number,
    opts?: { since?: string; before?: string },
): Promise<HealthEntry[]> {
    const conditions: string[] = ['user_id = ?', 'deleted_at IS NULL']
    const bindings: Array<string | number> = [userId]

    if (opts?.since) {
        conditions.push('timestamp >= ?')
        bindings.push(opts.since)
    }
    if (opts?.before) {
        conditions.push('timestamp <= ?')
        bindings.push(opts.before)
    }

    const where = conditions.join(' AND ')
    const rows = await db
        .prepare(
            `SELECT *
             FROM health_entries
             WHERE ${where}
             ORDER BY timestamp ASC, id ASC`,
        )
        .bind(...bindings)
        .all<HealthEntry>()

    return rows.results
}
