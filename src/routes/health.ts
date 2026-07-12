import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import {
    createHealthEntry,
    getHealthAnalysis,
    listHealthEntries,
    listHealthEntriesForExport,
    softDeleteHealthEntry,
    updateHealthEntry,
} from '../db/health.ts'

const health = new Hono<{ Bindings: Env; Variables: Variables }>()

function parseNullableNumber(value: unknown, field: string): { value: number | null; error?: string } {
    if (value === undefined) return { value: null }
    if (value === null || value === '') return { value: null }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { value: null, error: `${field} must be a number` }
    }
    return { value }
}

function parseNullableInteger(value: unknown, field: string): { value: number | null; error?: string } {
    const parsed = parseNullableNumber(value, field)
    if (parsed.error) return parsed
    if (parsed.value === null) return parsed
    if (!Number.isInteger(parsed.value)) {
        return { value: null, error: `${field} must be an integer` }
    }
    return { value: parsed.value }
}

function isIsoTimestamp(value: string): boolean {
    if (!value.trim()) return false
    const date = new Date(value)
    return !Number.isNaN(date.getTime())
}

function normalizeBloodPressureInput(body: Record<string, unknown>): { value: string | null; error?: string } {
    if (typeof body.blood_pressure === 'string') {
        const trimmed = body.blood_pressure.trim()
        if (!trimmed) return { value: null }
        if (!/^[0-9]{1,3}\s*\/\s*[0-9]{1,3}$/.test(trimmed)) {
            return { value: null, error: 'blood_pressure must be in Systolic/Diastolic format' }
        }
        return { value: trimmed.replace(/\s+/g, '') }
    }

    const systolicRaw = body.systolic
    const diastolicRaw = body.diastolic
    if (systolicRaw === undefined && diastolicRaw === undefined) {
        return { value: null }
    }

    if (systolicRaw === null || diastolicRaw === null || systolicRaw === '' || diastolicRaw === '') {
        return { value: null }
    }

    if (typeof systolicRaw !== 'number' || typeof diastolicRaw !== 'number') {
        return { value: null, error: 'systolic and diastolic must be numbers' }
    }
    if (!Number.isInteger(systolicRaw) || !Number.isInteger(diastolicRaw)) {
        return { value: null, error: 'systolic and diastolic must be integers' }
    }
    if (systolicRaw < 1 || systolicRaw > 300 || diastolicRaw < 1 || diastolicRaw > 300) {
        return { value: null, error: 'systolic and diastolic must be between 1 and 300' }
    }
    return { value: `${systolicRaw}/${diastolicRaw}` }
}

function csvEscape(value: unknown): string {
    if (value === null || value === undefined) return ''
    const raw = String(value)
    if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
        return `"${raw.replace(/"/g, '""')}"`
    }
    return raw
}

health.get('/entries', async (c) => {
    const user = c.get('user')
    const q = c.req.query()
    const page = q.page ? Number.parseInt(q.page, 10) : 1
    const per_page = q.per_page ? Number.parseInt(q.per_page, 10) : 20

    const { entries, total } = await listHealthEntries(c.env.DB, {
        user_id: user.id,
        page,
        per_page,
        since: q.since || undefined,
        before: q.before || undefined,
    })

    const safePerPage = Number.isInteger(per_page) && per_page > 0 ? Math.min(per_page, 100) : 20
    const safePage = Number.isInteger(page) && page > 0 ? page : 1

    return c.json({
        data: entries,
        meta: {
            total,
            page: safePage,
            per_page: safePerPage,
            total_pages: Math.ceil(total / safePerPage),
        },
    })
})

health.post('/entries', async (c) => {
    const user = c.get('user')
    let body: Record<string, unknown>

    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const weight = parseNullableNumber(body.weight, 'weight')
    const glucose = parseNullableNumber(body.glucose_level, 'glucose_level')
    const heart = parseNullableInteger(body.heart_rate, 'heart_rate')
    const bloodPressure = normalizeBloodPressureInput(body)

    if (weight.error) return c.json({ error: weight.error }, 400)
    if (glucose.error) return c.json({ error: glucose.error }, 400)
    if (heart.error) return c.json({ error: heart.error }, 400)
    if (bloodPressure.error) return c.json({ error: bloodPressure.error }, 400)

    const note = typeof body.note === 'string' ? body.note.trim() : null
    const timestamp = typeof body.timestamp === 'string' ? body.timestamp.trim() : undefined
    if (timestamp && !isIsoTimestamp(timestamp)) {
        return c.json({ error: 'timestamp must be a valid date/time string' }, 400)
    }

    const created = await createHealthEntry(c.env.DB, {
        user_id: user.id,
        weight: weight.value,
        glucose_level: glucose.value,
        blood_pressure: bloodPressure.value,
        heart_rate: heart.value,
        note,
        timestamp,
    })

    return c.json({ data: created }, 201)
})

health.patch('/entries/:id', async (c) => {
    const user = c.get('user')
    const id = Number.parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid entry id' }, 400)

    let body: Record<string, unknown>
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const update: {
        weight?: number | null
        glucose_level?: number | null
        blood_pressure?: string | null
        heart_rate?: number | null
        note?: string | null
        timestamp?: string
    } = {}

    if ('weight' in body) {
        const parsed = parseNullableNumber(body.weight, 'weight')
        if (parsed.error) return c.json({ error: parsed.error }, 400)
        update.weight = parsed.value
    }

    if ('glucose_level' in body) {
        const parsed = parseNullableNumber(body.glucose_level, 'glucose_level')
        if (parsed.error) return c.json({ error: parsed.error }, 400)
        update.glucose_level = parsed.value
    }

    if ('heart_rate' in body) {
        const parsed = parseNullableInteger(body.heart_rate, 'heart_rate')
        if (parsed.error) return c.json({ error: parsed.error }, 400)
        update.heart_rate = parsed.value
    }

    if ('blood_pressure' in body || 'systolic' in body || 'diastolic' in body) {
        const parsed = normalizeBloodPressureInput(body)
        if (parsed.error) return c.json({ error: parsed.error }, 400)
        update.blood_pressure = parsed.value
    }

    if ('note' in body) {
        if (body.note === null || body.note === '') update.note = null
        else if (typeof body.note === 'string') update.note = body.note.trim()
        else return c.json({ error: 'note must be a string' }, 400)
    }

    if ('timestamp' in body) {
        if (typeof body.timestamp !== 'string' || !isIsoTimestamp(body.timestamp.trim())) {
            return c.json({ error: 'timestamp must be a valid date/time string' }, 400)
        }
        update.timestamp = body.timestamp.trim()
    }

    const updated = await updateHealthEntry(c.env.DB, id, user.id, update)
    if (!updated) return c.json({ error: 'Health entry not found' }, 404)

    return c.json({ data: updated })
})

health.delete('/entries/:id', async (c) => {
    const user = c.get('user')
    const id = Number.parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid entry id' }, 400)

    const deleted = await softDeleteHealthEntry(c.env.DB, id, user.id)
    if (!deleted) return c.json({ error: 'Health entry not found' }, 404)
    return c.json({ ok: true })
})

health.get('/analysis', async (c) => {
    const user = c.get('user')
    const q = c.req.query()

    if (q.since && !isIsoTimestamp(q.since)) return c.json({ error: 'since must be a valid date/time string' }, 400)
    if (q.before && !isIsoTimestamp(q.before)) return c.json({ error: 'before must be a valid date/time string' }, 400)

    const result = await getHealthAnalysis(c.env.DB, user.id, {
        since: q.since || undefined,
        before: q.before || undefined,
    })
    return c.json(result)
})

health.get('/export.csv', async (c) => {
    const user = c.get('user')
    const q = c.req.query()

    if (q.since && !isIsoTimestamp(q.since)) return c.json({ error: 'since must be a valid date/time string' }, 400)
    if (q.before && !isIsoTimestamp(q.before)) return c.json({ error: 'before must be a valid date/time string' }, 400)

    const rows = await listHealthEntriesForExport(c.env.DB, user.id, {
        since: q.since || undefined,
        before: q.before || undefined,
    })

    const headers = [
        'id',
        'timestamp',
        'weight',
        'glucose_level',
        'blood_pressure',
        'heart_rate',
        'note',
        'created_at',
        'updated_at',
    ]

    const lines = [headers.join(',')]
    for (const row of rows) {
        lines.push([
            csvEscape(row.id),
            csvEscape(row.timestamp),
            csvEscape(row.weight),
            csvEscape(row.glucose_level),
            csvEscape(row.blood_pressure),
            csvEscape(row.heart_rate),
            csvEscape(row.note),
            csvEscape(row.created_at),
            csvEscape(row.updated_at),
        ].join(','))
    }

    const date = new Date().toISOString().split('T')[0]
    return new Response(lines.join('\n'), {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="lumin-health-${date}.csv"`,
        },
    })
})

export default health
