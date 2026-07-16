import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import {
    createFoodEntry,
    getFoodImageKey,
    listFoodEntries,
    softDeleteFoodEntry,
    updateFoodEntry,
} from '../db/food.ts'

const food = new Hono<{ Bindings: Env; Variables: Variables }>()

const MAX_FOOD_IMAGE_BYTES = 8 * 1024 * 1024
const HOME_LAT = 32.7189961
const HOME_LNG = -97.3563706

type UploadFileLike = {
    name: string
    type: string
    size: number
    stream: () => ReadableStream
}

function isUploadFileLike(value: unknown): value is UploadFileLike {
    return Boolean(
        value
        && typeof value === 'object'
        && typeof (value as UploadFileLike).name === 'string'
        && typeof (value as UploadFileLike).type === 'string'
        && typeof (value as UploadFileLike).size === 'number'
        && typeof (value as UploadFileLike).stream === 'function',
    )
}

function sanitizeFilename(filename: string): string {
    const cleaned = filename
        .replace(/[\\/]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)

    return cleaned || 'food-photo'
}

function sanitizeExifText(raw: unknown): string | null {
    if (typeof raw !== 'string') return null
    const trimmed = raw.trim()
    if (!trimmed) return null
    return trimmed.slice(0, 500)
}

function parseNullableEnum<T extends string>(
    value: unknown,
    field: string,
    allowed: readonly T[],
): { value: T | null; error?: string } {
    if (value === undefined || value === null || value === '') return { value: null }
    if (typeof value !== 'string') return { value: null, error: `${field} must be a string` }

    const normalized = value.trim().toLowerCase() as T
    if (!allowed.includes(normalized)) {
        return { value: null, error: `${field} must be one of: ${allowed.join(', ')}` }
    }

    return { value: normalized }
}

function parseLocation(value: unknown): { value: 'home' | 'away' | null; error?: string } {
    return parseNullableEnum(value, 'location', ['home', 'away'])
}

function parseFeel(value: unknown): { value: 'happy' | 'sad' | null; error?: string } {
    return parseNullableEnum(value, 'feel', ['happy', 'sad'])
}

function parseEnergy(value: unknown): { value: 'energized' | 'sluggish' | null; error?: string } {
    return parseNullableEnum(value, 'energy', ['energized', 'sluggish'])
}

function isIsoTimestamp(value: string): boolean {
    if (!value.trim()) return false
    const date = new Date(value)
    return !Number.isNaN(date.getTime())
}

function parseLocalOffsetMinutes(value: unknown): { value?: number; error?: string } {
    if (value === undefined || value === null || value === '') return { value: undefined }

    let parsed: number
    if (typeof value === 'number' && Number.isInteger(value)) {
        parsed = value
    } else if (typeof value === 'string' && value.trim()) {
        parsed = Number.parseInt(value.trim(), 10)
    } else {
        return { error: 'local_offset_minutes must be an integer' }
    }

    if (!Number.isInteger(parsed) || parsed < -840 || parsed > 840) {
        return { error: 'local_offset_minutes must be between -840 and 840' }
    }

    return { value: parsed }
}

food.get('/entries', async (c) => {
    const user = c.get('user')
    const q = c.req.query()
    const page = q.page ? Number.parseInt(q.page, 10) : 1
    const per_page = q.per_page ? Number.parseInt(q.per_page, 10) : 20

    const { entries, total } = await listFoodEntries(c.env.DB, {
        user_id: user.id,
        page,
        per_page,
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

food.post('/entries', async (c) => {
    const user = c.get('user')

    let body: Record<string, unknown>
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const feel = parseFeel(body.feel)
    const energy = parseEnergy(body.energy)
    const location = parseLocation(body.location)

    if (feel.error) return c.json({ error: feel.error }, 400)
    if (energy.error) return c.json({ error: energy.error }, 400)
    if (location.error) return c.json({ error: location.error }, 400)

    const note = typeof body.note === 'string' ? body.note.trim() : null
    const locationExif = sanitizeExifText(body.location_exif)
    const timestamp = typeof body.timestamp === 'string' ? body.timestamp.trim() : undefined
    const localOffset = parseLocalOffsetMinutes(body.local_offset_minutes)

    if (timestamp && !isIsoTimestamp(timestamp)) {
        return c.json({ error: 'timestamp must be a valid date/time string' }, 400)
    }
    if (localOffset.error) return c.json({ error: localOffset.error }, 400)

    const created = await createFoodEntry(c.env.DB, {
        user_id: user.id,
        feel: feel.value,
        energy: energy.value,
        location: location.value ?? 'home',
        location_exif: locationExif,
        note,
        timestamp,
        local_offset_minutes: localOffset.value,
    })

    return c.json({ data: created, meta: { home: { lat: HOME_LAT, lng: HOME_LNG } } }, 201)
})

food.patch('/entries/:id', async (c) => {
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
        feel?: 'happy' | 'sad' | null
        energy?: 'energized' | 'sluggish' | null
        location?: 'home' | 'away' | null
        location_exif?: string | null
        note?: string | null
        timestamp?: string
        image_url?: string | null
        local_offset_minutes?: number
    } = {}

    if ('feel' in body) {
        const parsed = parseFeel(body.feel)
        if (parsed.error) return c.json({ error: parsed.error }, 400)
        update.feel = parsed.value
    }

    if ('energy' in body) {
        const parsed = parseEnergy(body.energy)
        if (parsed.error) return c.json({ error: parsed.error }, 400)
        update.energy = parsed.value
    }

    if ('location' in body) {
        const parsed = parseLocation(body.location)
        if (parsed.error) return c.json({ error: parsed.error }, 400)
        update.location = parsed.value
    }

    if ('location_exif' in body) {
        update.location_exif = sanitizeExifText(body.location_exif)
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

    if ('local_offset_minutes' in body) {
        const localOffset = parseLocalOffsetMinutes(body.local_offset_minutes)
        if (localOffset.error) return c.json({ error: localOffset.error }, 400)
        update.local_offset_minutes = localOffset.value
    }

    const updated = await updateFoodEntry(c.env.DB, id, user.id, update)
    if (!updated) return c.json({ error: 'Food entry not found' }, 404)

    return c.json({ data: updated })
})

food.post('/entries/photo', async (c) => {
    const user = c.get('user')

    if (!c.env.FOOD_ENTRIES) {
        return c.json({ error: 'Food image storage is not configured' }, 500)
    }

    let form: FormData
    try {
        form = await c.req.formData()
    } catch {
        return c.json({ error: 'Expected multipart/form-data' }, 400)
    }

    const filePart = form.get('file')
    if (!isUploadFileLike(filePart)) return c.json({ error: 'file is required' }, 400)

    const contentType = filePart.type || 'application/octet-stream'
    if (!contentType.toLowerCase().startsWith('image/')) {
        return c.json({ error: 'Only image uploads are supported' }, 400)
    }

    const size = filePart.size
    if (!size || size < 1) return c.json({ error: 'File is empty' }, 400)
    if (size > MAX_FOOD_IMAGE_BYTES) {
        return c.json({ error: 'File exceeds 8MB limit' }, 400)
    }

    const filename = sanitizeFilename(filePart.name)

    const entryIdRaw = (form.get('entry_id') as string | null)?.trim() ?? ''
    const entryId = entryIdRaw ? Number.parseInt(entryIdRaw, 10) : null
    if (entryIdRaw && (!Number.isInteger(entryId) || (entryId as number) < 1)) {
        return c.json({ error: 'entry_id must be a positive integer' }, 400)
    }

    const feel = parseFeel((form.get('feel') as string | null) ?? undefined)
    const energy = parseEnergy((form.get('energy') as string | null) ?? undefined)
    const location = parseLocation((form.get('location') as string | null) ?? undefined)

    if (feel.error) return c.json({ error: feel.error }, 400)
    if (energy.error) return c.json({ error: energy.error }, 400)
    if (location.error) return c.json({ error: location.error }, 400)

    const noteRaw = (form.get('note') as string | null) ?? ''
    const note = noteRaw.trim() ? noteRaw.trim() : null
    const locationExif = sanitizeExifText((form.get('location_exif') as string | null) ?? null)
    const timestampRaw = (form.get('timestamp') as string | null)?.trim() ?? ''
    const localOffset = parseLocalOffsetMinutes((form.get('local_offset_minutes') as string | null) ?? undefined)
    if (timestampRaw && !isIsoTimestamp(timestampRaw)) {
        return c.json({ error: 'timestamp must be a valid date/time string' }, 400)
    }
    if (localOffset.error) return c.json({ error: localOffset.error }, 400)

    const objectKey = `food/${user.id}/${Date.now()}-${crypto.randomUUID()}-${filename}`

    try {
        await c.env.FOOD_ENTRIES.put(objectKey, filePart.stream(), {
            httpMetadata: { contentType },
            customMetadata: {
                userId: String(user.id),
                filename,
            },
        })

        if (entryId) {
            const updated = await updateFoodEntry(c.env.DB, entryId, user.id, {
                image_url: objectKey,
                feel: feel.value,
                energy: energy.value,
                location: location.value,
                location_exif: locationExif,
                note,
                timestamp: timestampRaw || undefined,
                local_offset_minutes: localOffset.value,
            })

            if (!updated) {
                await c.env.FOOD_ENTRIES.delete(objectKey)
                return c.json({ error: 'Food entry not found' }, 404)
            }

            return c.json({ data: updated, meta: { home: { lat: HOME_LAT, lng: HOME_LNG } } })
        }

        const created = await createFoodEntry(c.env.DB, {
            user_id: user.id,
            feel: feel.value,
            energy: energy.value,
            location: location.value ?? 'home',
            location_exif: locationExif,
            note,
            image_url: objectKey,
            timestamp: timestampRaw || undefined,
            local_offset_minutes: localOffset.value,
        })

        return c.json({ data: created, meta: { home: { lat: HOME_LAT, lng: HOME_LNG } } }, 201)
    } catch (err) {
        try { await c.env.FOOD_ENTRIES.delete(objectKey) } catch { /* ignore cleanup failures */ }
        return c.json({ error: (err as Error).message || 'Upload failed' }, 400)
    }
})

food.get('/entries/:id/image', async (c) => {
    const user = c.get('user')
    const id = Number.parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid entry id' }, 400)

    if (!c.env.FOOD_ENTRIES) {
        return c.json({ error: 'Food image storage is not configured' }, 500)
    }

    const imageKey = await getFoodImageKey(c.env.DB, id, user.id)
    if (!imageKey) return c.json({ error: 'Image not found' }, 404)

    const object = await c.env.FOOD_ENTRIES.get(imageKey)
    if (!object || !object.body) return c.json({ error: 'Image payload missing' }, 404)

    c.header('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream')
    c.header('Cache-Control', 'private, no-cache, must-revalidate, max-age=31536000')
    c.header('Vary', 'Authorization')
    c.header('X-Robots-Tag', 'noindex, nofollow')
    return c.body(object.body)
})

food.delete('/entries/:id', async (c) => {
    const user = c.get('user')
    const id = Number.parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid entry id' }, 400)

    const deleted = await softDeleteFoodEntry(c.env.DB, id, user.id)
    if (!deleted) return c.json({ error: 'Food entry not found' }, 404)
    return c.json({ ok: true })
})

export default food
