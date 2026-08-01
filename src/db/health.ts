import type {
    CreateHealthEntryInput,
    HealthEntry,
    HealthProfile,
    ListHealthEntriesOptions,
    UpdateHealthEntryInput,
} from './types.ts'
import { getUserSettings, upsertUserSettings } from './user_settings.ts'

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

// ─── Health profile (static details, stored as JSON in user_settings) ────────

const HEALTH_PROFILE_APP_ID = 'health'
const GENDER_OPTIONS = ['Male', 'Female', ''] as const
const BLOOD_TYPE_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', ''] as const

const HEALTH_PROFILE_DEFAULTS: HealthProfile = {
    full_name: '',
    birthday: '',
    gender: '',
    emergency_contact: '',
    medications: '',
    height_inches: null,
    target_weight: null,
    target_bmi: null,
    health_history: '',
    vaccinations: '',
    allergies: '',
    blood_type: '',
    primary_care_physician: '',
    notes: '',
}

const HEALTH_PROFILE_TEXT_LIMITS = {
    full_name: 200,
    birthday: 10,
    emergency_contact: 2000,
    medications: 4000,
    health_history: 4000,
    vaccinations: 4000,
    allergies: 4000,
    primary_care_physician: 300,
    notes: 4000,
} as const

function sanitizeHealthProfileText(
    value: unknown,
    field: string,
    maxLen: number,
): { value: string; error?: string } {
    if (value === undefined || value === null) return { value: '' }
    if (typeof value !== 'string') return { value: '', error: `${field} must be a string` }
    const trimmed = value.trim()
    if (trimmed.length > maxLen) return { value: trimmed, error: `${field} must be ${maxLen} characters or fewer` }
    return { value: trimmed }
}

function sanitizeHealthProfileNumber(
    value: unknown,
    field: string,
    min: number,
    max: number,
): { value: number | null; error?: string } {
    if (value === undefined || value === null || value === '') return { value: null }
    if (typeof value !== 'number' || !Number.isFinite(value)) return { value: null, error: `${field} must be a number` }
    if (value < min || value > max) return { value: null, error: `${field} must be between ${min} and ${max}` }
    return { value }
}

function isValidBirthday(value: string): boolean {
    if (!value) return true
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const date = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return false
    return date.getTime() <= Date.now()
}

/** Allowlists and validates a raw settings JSON body into a HealthProfile — never trust the shape a client posts. */
export function sanitizeHealthProfile(body: Record<string, unknown>): { profile: HealthProfile } | { error: string } {
    const fullName = sanitizeHealthProfileText(body.full_name, 'full_name', HEALTH_PROFILE_TEXT_LIMITS.full_name)
    if (fullName.error) return { error: fullName.error }

    const birthday = sanitizeHealthProfileText(body.birthday, 'birthday', HEALTH_PROFILE_TEXT_LIMITS.birthday)
    if (birthday.error) return { error: birthday.error }
    if (!isValidBirthday(birthday.value)) return { error: 'birthday must be a valid date (yyyy-mm-dd) not in the future' }

    const genderRaw = body.gender
    if (genderRaw !== undefined && genderRaw !== null) {
        if (typeof genderRaw !== 'string' || !(GENDER_OPTIONS as readonly string[]).includes(genderRaw)) {
            return { error: 'gender must be Male, Female, or empty' }
        }
    }

    const emergencyContact = sanitizeHealthProfileText(body.emergency_contact, 'emergency_contact', HEALTH_PROFILE_TEXT_LIMITS.emergency_contact)
    if (emergencyContact.error) return { error: emergencyContact.error }

    const medications = sanitizeHealthProfileText(body.medications, 'medications', HEALTH_PROFILE_TEXT_LIMITS.medications)
    if (medications.error) return { error: medications.error }

    const heightInches = sanitizeHealthProfileNumber(body.height_inches, 'height_inches', 0, 120)
    if (heightInches.error) return { error: heightInches.error }

    const targetWeight = sanitizeHealthProfileNumber(body.target_weight, 'target_weight', 0, 2000)
    if (targetWeight.error) return { error: targetWeight.error }

    const targetBmi = sanitizeHealthProfileNumber(body.target_bmi, 'target_bmi', 0, 100)
    if (targetBmi.error) return { error: targetBmi.error }

    const healthHistory = sanitizeHealthProfileText(body.health_history, 'health_history', HEALTH_PROFILE_TEXT_LIMITS.health_history)
    if (healthHistory.error) return { error: healthHistory.error }

    const vaccinations = sanitizeHealthProfileText(body.vaccinations, 'vaccinations', HEALTH_PROFILE_TEXT_LIMITS.vaccinations)
    if (vaccinations.error) return { error: vaccinations.error }

    const allergies = sanitizeHealthProfileText(body.allergies, 'allergies', HEALTH_PROFILE_TEXT_LIMITS.allergies)
    if (allergies.error) return { error: allergies.error }

    const bloodTypeRaw = body.blood_type
    if (bloodTypeRaw !== undefined && bloodTypeRaw !== null) {
        if (typeof bloodTypeRaw !== 'string' || !(BLOOD_TYPE_OPTIONS as readonly string[]).includes(bloodTypeRaw)) {
            return { error: 'blood_type must be a valid blood type or empty' }
        }
    }

    const primaryCarePhysician = sanitizeHealthProfileText(body.primary_care_physician, 'primary_care_physician', HEALTH_PROFILE_TEXT_LIMITS.primary_care_physician)
    if (primaryCarePhysician.error) return { error: primaryCarePhysician.error }

    const notes = sanitizeHealthProfileText(body.notes, 'notes', HEALTH_PROFILE_TEXT_LIMITS.notes)
    if (notes.error) return { error: notes.error }

    return {
        profile: {
            full_name: fullName.value,
            birthday: birthday.value,
            gender: (typeof genderRaw === 'string' ? genderRaw : '') as HealthProfile['gender'],
            emergency_contact: emergencyContact.value,
            medications: medications.value,
            height_inches: heightInches.value,
            target_weight: targetWeight.value,
            target_bmi: targetBmi.value,
            health_history: healthHistory.value,
            vaccinations: vaccinations.value,
            allergies: allergies.value,
            blood_type: (typeof bloodTypeRaw === 'string' ? bloodTypeRaw : '') as HealthProfile['blood_type'],
            primary_care_physician: primaryCarePhysician.value,
            notes: notes.value,
        },
    }
}

export async function getHealthProfile(db: D1Database, userId: number): Promise<HealthProfile> {
    const row = await getUserSettings(db, userId, HEALTH_PROFILE_APP_ID)
    if (!row) return { ...HEALTH_PROFILE_DEFAULTS }

    try {
        const parsed = JSON.parse(row.settings)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...HEALTH_PROFILE_DEFAULTS }
        const sanitized = sanitizeHealthProfile(parsed as Record<string, unknown>)
        return 'error' in sanitized ? { ...HEALTH_PROFILE_DEFAULTS } : sanitized.profile
    } catch {
        return { ...HEALTH_PROFILE_DEFAULTS }
    }
}

export async function upsertHealthProfile(
    db: D1Database,
    userId: number,
    profile: HealthProfile,
): Promise<HealthProfile> {
    await upsertUserSettings(db, userId, HEALTH_PROFILE_APP_ID, profile)
    return profile
}
