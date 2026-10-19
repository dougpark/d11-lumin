import { qs } from './dom.ts'

export type AmPm = 'AM' | 'PM'
export type Time12 = { hour12: number; minute: number }

export function pad2(n: number): string {
    return String(n).padStart(2, '0')
}

export function formatDateInput(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function formatTimeForInput(hour12: number, minute: number): string {
    return `${pad2(hour12)}:${pad2(minute)}`
}

export function to12HourParts(date: Date): Time12 & { ampm: AmPm } {
    const hour24 = date.getHours()
    const ampm = hour24 >= 12 ? 'PM' : 'AM'
    return { hour12: hour24 % 12 || 12, minute: date.getMinutes(), ampm }
}

/** Accepts "9", "930", "0930", "9:30" etc. Returns null unless it's a valid 12-hour time. */
export function parseTimeInput(raw: string): Time12 | null {
    const cleaned = (raw || '').trim().replace(/[^0-9:]/g, '')
    if (!cleaned) return null

    let hour = NaN
    let minute = NaN

    if (cleaned.includes(':')) {
        const parts = cleaned.split(':')
        if (parts.length !== 2) return null
        hour = Number.parseInt(parts[0], 10)
        minute = Number.parseInt(parts[1], 10)
    } else if (cleaned.length <= 2) {
        hour = Number.parseInt(cleaned, 10)
        minute = 0
    } else if (cleaned.length === 3) {
        hour = Number.parseInt(cleaned.slice(0, 1), 10)
        minute = Number.parseInt(cleaned.slice(1), 10)
    } else if (cleaned.length === 4) {
        hour = Number.parseInt(cleaned.slice(0, 2), 10)
        minute = Number.parseInt(cleaned.slice(2), 10)
    } else {
        return null
    }

    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null
    return { hour12: hour, minute }
}

const AMPM_ACTIVE = 'px-3 py-2 text-xs font-semibold text-g-blue bg-blue-50'
const AMPM_INACTIVE = 'px-3 py-2 text-xs font-semibold text-g-gray bg-white'

/**
 * Date + 12h time + AM/PM control group. Expects #timestamp-date-input,
 * #timestamp-time-input, #btn-ampm-am and #btn-ampm-pm in the page.
 */
export function createTimestampField() {
    const dateInput = qs<HTMLInputElement>('#timestamp-date-input')
    const timeInput = qs<HTMLInputElement>('#timestamp-time-input')
    const amBtn = qs('#btn-ampm-am')
    const pmBtn = qs('#btn-ampm-pm')
    let ampm: AmPm = 'AM'

    const field = {
        dateInput,
        timeInput,
        amBtn,
        pmBtn,

        get ampm(): AmPm {
            return ampm
        },

        setAmPm(value: AmPm) {
            ampm = value
            amBtn.className = value === 'AM' ? AMPM_ACTIVE : AMPM_INACTIVE
            pmBtn.className = (value === 'PM' ? AMPM_ACTIVE : AMPM_INACTIVE) + ' border-l border-g-border'
        },

        parseTime(): Time12 | null {
            return parseTimeInput(timeInput.value)
        },

        setTime(hour12: number, minute: number, value: AmPm) {
            timeInput.value = formatTimeForInput(hour12, minute)
            field.setAmPm(value)
        },

        setFromDate(date: Date) {
            const parts = to12HourParts(date)
            dateInput.value = formatDateInput(date)
            field.setTime(parts.hour12, parts.minute, parts.ampm)
        },

        ensureDate() {
            if (!dateInput.value) dateInput.value = formatDateInput(new Date())
        },

        /** Rewrites the time input as HH:MM; returns false if it isn't a valid time. */
        normalize(): boolean {
            const parsed = field.parseTime()
            if (!parsed) return false
            timeInput.value = formatTimeForInput(parsed.hour12, parsed.minute)
            return true
        },

        toIso(): string | null {
            const dateRaw = dateInput.value.trim()
            const parsed = field.parseTime()
            if (!dateRaw || !parsed) return null
            const hour24 = (parsed.hour12 % 12) + (ampm === 'PM' ? 12 : 0)
            const d = new Date(`${dateRaw}T${pad2(hour24)}:${pad2(parsed.minute)}:00`)
            return Number.isNaN(d.getTime()) ? null : d.toISOString()
        },
    }

    return field
}

export type TimestampField = ReturnType<typeof createTimestampField>
