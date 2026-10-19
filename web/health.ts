import Chart from 'chart.js/auto'
import type { ChartConfiguration } from 'chart.js'
import { qs, escHtml } from './lib/dom.ts'
import { api, apiError } from './lib/api.ts'
import { requireUser, initSuiteMenu, applyUserToHeader } from './lib/session.ts'
import { createTimestampField, formatDateInput, type AmPm } from './lib/timestamp.ts'
import { createSaveIndicator, mergeEntries, formatEntryTimestamp } from './lib/entries.ts'

type HealthEntry = {
    id: number
    timestamp: string
    weight: number | null
    glucose_level: number | null
    blood_pressure: string | null
    heart_rate: number | null
    note: string | null
}

type EntryPayload = {
    weight: number | null
    glucose_level: number | null
    systolic: number | null
    diastolic: number | null
    heart_rate: number | null
    note: string | null
    timestamp?: string
}

type SeriesPoint = { timestamp: string; value: number }
type BpPoint = { timestamp: string; systolic: number; diastolic: number }

type Analysis = {
    summary?: Record<string, number | null>
    series?: {
        weight?: SeriesPoint[]
        glucose_level?: SeriesPoint[]
        heart_rate?: SeriesPoint[]
        blood_pressure?: BpPoint[]
    }
}

type HealthProfile = Partial<Record<'blood_type' | 'allergies' | 'medications' | 'emergency_contact' | 'primary_care_physician', string | null>>

const state = {
    activeEntryId: null as number | null,
    formContextVersion: 0,
    entries: [] as HealthEntry[],
    page: 1,
    totalPages: 1,
    loadingEntries: false,
    saving: false,
    pendingSave: false,
    noteTimer: null as ReturnType<typeof setTimeout> | null,
    charts: {} as Record<string, Chart>,
    selectedSince: '',
    selectedBefore: '',
    selectedTimePill: 'now',
    selectedAnalysisRangeMonths: null as number | null,
}

const input = (sel: string) => qs<HTMLInputElement>(sel)
const setSaveIndicator = createSaveIndicator()
const ts = createTimestampField()

function parseNum(value: string, integer: boolean): number | null {
    if (value === '') return null
    const parsed = integer ? Number.parseInt(value, 10) : Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
}

function setActiveAnalysisRangePill(months: number | null) {
    state.selectedAnalysisRangeMonths = months
    document.querySelectorAll<HTMLButtonElement>('button[data-analysis-range]').forEach((button) => {
        const pillMonths = Number.parseInt(button.dataset.analysisRange || '', 10)
        button.classList.toggle('active', months !== null && pillMonths === months)
    })
}

function applyAnalysisRangePreset(months: number) {
    const beforeDate = new Date()
    const sinceDate = new Date(beforeDate)
    sinceDate.setMonth(sinceDate.getMonth() - months)

    const since = formatDateInput(sinceDate)
    const before = formatDateInput(beforeDate)

    input('#analysis-since').value = since
    input('#analysis-before').value = before
    state.selectedSince = since
    state.selectedBefore = before
    setActiveAnalysisRangePill(months)
    refreshAnalysis()
}

function setActiveTimePill(key: string) {
    state.selectedTimePill = key
    document.querySelectorAll<HTMLButtonElement>('button[data-time-pill]').forEach((button) => {
        button.classList.toggle('active', button.dataset.timePill === key)
    })
}

function updatePillFromCurrentTime() {
    const parsed = ts.parseTime()
    if (!parsed) {
        setActiveTimePill('custom')
        return
    }

    const { hour12: hour, minute } = parsed
    const ampm = ts.ampm
    if (hour === 7 && minute === 0 && ampm === 'AM') return setActiveTimePill('7am')
    if (hour === 9 && minute === 0 && ampm === 'AM') return setActiveTimePill('9am')
    if (hour === 12 && minute === 0 && ampm === 'PM') return setActiveTimePill('12pm')
    if (hour === 6 && minute === 0 && ampm === 'PM') return setActiveTimePill('6pm')
    setActiveTimePill('custom')
}

const TIME_PRESETS: Record<string, { hour12: number; minute: number; ampm: AmPm }> = {
    '7am': { hour12: 7, minute: 0, ampm: 'AM' },
    '9am': { hour12: 9, minute: 0, ampm: 'AM' },
    '12pm': { hour12: 12, minute: 0, ampm: 'PM' },
    '6pm': { hour12: 6, minute: 0, ampm: 'PM' },
}

function applyTimePill(pillKey: string) {
    ts.ensureDate()

    if (pillKey === 'now') {
        ts.setFromDate(new Date())
        setActiveTimePill('now')
        return
    }

    const preset = TIME_PRESETS[pillKey]
    if (!preset) return

    ts.setTime(preset.hour12, preset.minute, preset.ampm)
    setActiveTimePill(pillKey)
}

function hasAnyMeaningfulValue(payload: EntryPayload) {
    return payload.weight !== null
        || payload.glucose_level !== null
        || payload.heart_rate !== null
        || payload.systolic !== null
        || payload.diastolic !== null
        || Boolean(payload.note)
}

function getFormPayload(): EntryPayload {
    const noteRaw = qs<HTMLTextAreaElement>('#note-input').value.trim()
    const tsIso = ts.toIso()

    const payload: EntryPayload = {
        weight: parseNum(input('#weight-input').value, false),
        glucose_level: parseNum(input('#glucose-input').value, false),
        systolic: parseNum(input('#systolic-input').value, true),
        diastolic: parseNum(input('#diastolic-input').value, true),
        heart_rate: parseNum(input('#heart-rate-input').value, true),
        note: noteRaw || null,
    }

    if (tsIso) payload.timestamp = tsIso

    return payload
}

function applyEntryToForm(entry: HealthEntry | null) {
    state.formContextVersion += 1
    state.activeEntryId = entry ? entry.id : null
    input('#weight-input').value = entry && entry.weight !== null ? String(entry.weight) : ''
    input('#glucose-input').value = entry && entry.glucose_level !== null ? String(entry.glucose_level) : ''
    const bp = typeof entry?.blood_pressure === 'string' ? entry.blood_pressure.split('/') : []
    input('#systolic-input').value = bp[0] || ''
    input('#diastolic-input').value = bp[1] || ''
    input('#heart-rate-input').value = entry && entry.heart_rate !== null ? String(entry.heart_rate) : ''
    qs<HTMLTextAreaElement>('#note-input').value = entry?.note || ''

    if (entry?.timestamp) {
        const d = new Date(entry.timestamp)
        if (!Number.isNaN(d.getTime())) ts.setFromDate(d)
        updatePillFromCurrentTime()
        return
    }

    applyTimePill('now')
}

async function saveCurrentEntry(): Promise<void> {
    const payload = getFormPayload()
    if (!state.activeEntryId && !hasAnyMeaningfulValue(payload)) {
        setSaveIndicator('idle', 'Idle')
        return
    }

    if (state.saving) {
        state.pendingSave = true
        return
    }

    state.saving = true
    setSaveIndicator('saving', 'Saving...')
    const saveContextVersion = state.formContextVersion

    try {
        const response = state.activeEntryId
            ? await api('PATCH', `/api/health/entries/${state.activeEntryId}`, payload)
            : await api('POST', '/api/health/entries', payload)

        if (!response.ok) throw new Error(await apiError(response))

        const body = await response.json() as { data?: HealthEntry }
        const saved = body.data
        if (!saved) throw new Error('Missing saved entry data')

        upsertEntry(saved)
        if (saveContextVersion === state.formContextVersion) {
            state.activeEntryId = saved.id
        }
        setSaveIndicator('saved', 'Saved')
    } catch (err) {
        setSaveIndicator('error', err instanceof Error ? err.message : 'Save failed')
    } finally {
        state.saving = false
        if (state.pendingSave) {
            state.pendingSave = false
            saveCurrentEntry()
        }
    }
}

function scheduleSave(debounceMs: number) {
    if (state.noteTimer) {
        clearTimeout(state.noteTimer)
        state.noteTimer = null
    }
    if (debounceMs > 0) {
        state.noteTimer = setTimeout(() => {
            state.noteTimer = null
            saveCurrentEntry()
        }, debounceMs)
        return
    }
    saveCurrentEntry()
}

function upsertEntry(entry: HealthEntry) {
    state.entries = mergeEntries([...state.entries, entry])
    renderEntries()
    refreshAnalysis()
}

function renderEntries() {
    qs('#entries-total').textContent = `${state.entries.length} loaded`
    qs('#entries-empty').classList.toggle('hidden', state.entries.length > 0)
    qs('#btn-load-more').classList.toggle('hidden', state.page >= state.totalPages)

    qs('#entries-list').innerHTML = state.entries.map(entry => {
        const isActive = state.activeEntryId === entry.id
        return `
            <article class="border ${isActive ? 'border-g-blue bg-blue-50/40' : 'border-g-border bg-white'} rounded-[12px] p-3">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <p class="text-xs text-g-gray">${formatEntryTimestamp(entry.timestamp)}</p>
                        <div class="mt-1 flex flex-wrap gap-2 text-xs">
                            ${entry.weight !== null ? `<span class="px-2 py-0.5 rounded-full bg-[#F4F7FF] text-g-black">W: ${escHtml(entry.weight)}</span>` : ''}
                            ${entry.glucose_level !== null ? `<span class="px-2 py-0.5 rounded-full bg-[#F4F7FF] text-g-black">G: ${escHtml(entry.glucose_level)}</span>` : ''}
                            ${entry.blood_pressure ? `<span class="px-2 py-0.5 rounded-full bg-[#F4F7FF] text-g-black">BP: ${escHtml(entry.blood_pressure)}</span>` : ''}
                            ${entry.heart_rate !== null ? `<span class="px-2 py-0.5 rounded-full bg-[#F4F7FF] text-g-black">HR: ${escHtml(entry.heart_rate)}</span>` : ''}
                        </div>
                        ${entry.note ? `<p class="text-sm text-g-black mt-2 whitespace-pre-wrap">${escHtml(entry.note)}</p>` : ''}
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button data-edit-id="${entry.id}" class="text-xs text-g-blue hover:underline">Edit</button>
                        <button data-delete-id="${entry.id}" class="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                </div>
            </article>
        `
    }).join('')
}

async function loadEntries(reset: boolean) {
    if (state.loadingEntries) return
    state.loadingEntries = true

    if (reset) {
        state.page = 1
        state.entries = []
        renderEntries()
    }

    try {
        const res = await api('GET', `/api/health/entries?page=${state.page}&per_page=20`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json() as { data?: HealthEntry[]; meta?: { total_pages?: number } }
        const incoming = Array.isArray(body.data) ? body.data : []
        state.totalPages = body.meta?.total_pages || 1
        state.entries = mergeEntries(reset ? incoming : state.entries.concat(incoming))
        renderEntries()
    } catch (err) {
        setSaveIndicator('error', err instanceof Error ? err.message : 'Could not load entries')
    } finally {
        state.loadingEntries = false
    }
}

function formatLabel(iso: string) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function upsertChart(key: string, canvasId: string, config: ChartConfiguration<'line'>) {
    const existing = state.charts[key]
    if (existing) {
        existing.data = config.data
        existing.options = config.options ?? {}
        existing.update()
        return
    }
    state.charts[key] = new Chart(qs<HTMLCanvasElement>('#' + canvasId), config)
}

const AXES = {
    x: { ticks: { maxTicksLimit: 5, color: '#6B7280' }, grid: { color: '#F0F2F5' } },
    y: { ticks: { color: '#6B7280' }, grid: { color: '#F0F2F5' }, beginAtZero: false },
}

function buildLineConfig(points: SeriesPoint[], color: string, label: string): ChartConfiguration<'line'> {
    return {
        type: 'line',
        data: {
            labels: points.map(p => formatLabel(p.timestamp)),
            datasets: [{
                label,
                data: points.map(p => p.value),
                borderColor: color,
                backgroundColor: color + '22',
                pointRadius: 2,
                pointHoverRadius: 4,
                tension: 0.25,
                fill: true,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: AXES,
        },
    }
}

function buildBpConfig(points: BpPoint[]): ChartConfiguration<'line'> {
    return {
        type: 'line',
        data: {
            labels: points.map(p => formatLabel(p.timestamp)),
            datasets: [
                {
                    label: 'Systolic',
                    data: points.map(p => p.systolic),
                    borderColor: '#FBBC04',
                    backgroundColor: '#FBBC0422',
                    pointRadius: 2,
                    tension: 0.25,
                    fill: false,
                },
                {
                    label: 'Diastolic',
                    data: points.map(p => p.diastolic),
                    borderColor: '#4285F4',
                    backgroundColor: '#4285F422',
                    pointRadius: 2,
                    tension: 0.25,
                    fill: false,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10 } } },
            scales: AXES,
        },
    }
}

function renderAnalysisSummary(summary: Record<string, number | null>) {
    const items = [
        { label: 'Entries', value: summary.total_entries ?? 0 },
        { label: 'Avg Weight', value: summary.avg_weight ?? '-' },
        { label: 'Avg Glucose', value: summary.avg_glucose_level ?? '-' },
        { label: 'Avg Heart', value: summary.avg_heart_rate ?? '-' },
        { label: 'Avg BP Sys', value: summary.avg_bp_systolic ?? '-' },
        { label: 'Avg BP Dia', value: summary.avg_bp_diastolic ?? '-' },
    ]
    qs('#analysis-summary').innerHTML = items.map(item => `
        <div class="rounded-[12px] border border-g-border bg-[#FAFBFF] px-3 py-3">
            <p class="text-[11px] text-g-gray">${escHtml(item.label)}</p>
            <p class="text-sm font-semibold text-g-black mt-0.5">${escHtml(item.value)}</p>
        </div>
    `).join('')
}

function toRangeQuery() {
    const params = new URLSearchParams()
    if (state.selectedSince) {
        params.set('since', new Date(`${state.selectedSince}T00:00:00`).toISOString())
    }
    if (state.selectedBefore) {
        params.set('before', new Date(`${state.selectedBefore}T23:59:59`).toISOString())
    }
    const q = params.toString()
    return q ? `?${q}` : ''
}

async function refreshAnalysis() {
    try {
        const res = await api('GET', `/api/health/analysis${toRangeQuery()}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as Analysis

        renderAnalysisSummary(data.summary || {})
        upsertChart('weight', 'chart-weight', buildLineConfig(data.series?.weight || [], '#4285F4', 'Weight'))
        upsertChart('glucose', 'chart-glucose', buildLineConfig(data.series?.glucose_level || [], '#EA4335', 'Glucose'))
        upsertChart('heart', 'chart-heart', buildLineConfig(data.series?.heart_rate || [], '#34A853', 'Heart Rate'))
        upsertChart('bp', 'chart-bp', buildBpConfig(data.series?.blood_pressure || []))
    } catch {
        // Keep current charts if refresh fails.
    }
}

async function deleteEntry(id: number) {
    if (!window.confirm('Delete this health entry?')) return
    const res = await api('DELETE', `/api/health/entries/${id}`)
    if (!res.ok) {
        window.alert(await apiError(res).catch(() => 'Could not delete entry'))
        return
    }

    state.entries = state.entries.filter(entry => entry.id !== id)
    if (state.activeEntryId === id) {
        applyEntryToForm(null)
        setSaveIndicator('idle', 'Idle')
    }
    renderEntries()
    refreshAnalysis()
}

async function exportCsv() {
    const res = await api('GET', `/api/health/export.csv${toRangeQuery()}`)
    if (!res.ok) {
        window.alert(await apiError(res).catch(() => 'Could not export CSV'))
        return
    }

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `lumin-health-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
}

function bindEvents() {
    qs('#btn-new-entry').addEventListener('click', (event) => {
        event.preventDefault()
        applyEntryToForm(null)
        setSaveIndicator('idle', 'Idle')
    })

    const fieldSelectors = ['#weight-input', '#glucose-input', '#systolic-input', '#diastolic-input', '#heart-rate-input', '#timestamp-date-input', '#timestamp-time-input']
    for (const sel of fieldSelectors) {
        const el = input(sel)
        el.addEventListener('change', () => scheduleSave(0))
        el.addEventListener('blur', () => {
            if (sel === '#timestamp-time-input' && !ts.normalize()) {
                setSaveIndicator('error', 'Time must be HH:MM')
                return
            }
            if (sel === '#timestamp-time-input' || sel === '#timestamp-date-input') updatePillFromCurrentTime()
            scheduleSave(0)
        })
    }

    ts.amBtn.addEventListener('click', () => {
        ts.setAmPm('AM')
        updatePillFromCurrentTime()
        scheduleSave(0)
    })

    ts.pmBtn.addEventListener('click', () => {
        ts.setAmPm('PM')
        updatePillFromCurrentTime()
        scheduleSave(0)
    })

    qs('#time-pill-row').addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-time-pill]')
        const pill = button?.dataset.timePill
        if (!pill) return
        applyTimePill(pill)
        scheduleSave(0)
    })

    qs('#note-input').addEventListener('input', () => {
        setSaveIndicator('saving', 'Typing...')
        scheduleSave(1500)
    })

    qs('#entries-list').addEventListener('click', (event) => {
        const target = event.target as HTMLElement

        const editId = target.getAttribute('data-edit-id')
        if (editId) {
            const entry = state.entries.find(item => item.id === Number.parseInt(editId, 10))
            if (entry) {
                applyEntryToForm(entry)
                renderEntries()
                setSaveIndicator('idle', 'Editing selected entry')
            }
            return
        }

        const deleteId = target.getAttribute('data-delete-id')
        if (deleteId) deleteEntry(Number.parseInt(deleteId, 10))
    })

    qs('#btn-load-more').addEventListener('click', async () => {
        if (state.page >= state.totalPages) return
        state.page += 1
        await loadEntries(false)
    })

    qs('#btn-apply-range').addEventListener('click', () => {
        state.selectedSince = input('#analysis-since').value
        state.selectedBefore = input('#analysis-before').value
        setActiveAnalysisRangePill(null)
        refreshAnalysis()
    })

    qs('#btn-reset-range').addEventListener('click', () => {
        state.selectedSince = ''
        state.selectedBefore = ''
        input('#analysis-since').value = ''
        input('#analysis-before').value = ''
        setActiveAnalysisRangePill(null)
        refreshAnalysis()
    })

    qs('#analysis-range-pills').addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-analysis-range]')
        const months = Number.parseInt(button?.dataset.analysisRange || '', 10)
        if (!Number.isInteger(months) || months < 1) return
        applyAnalysisRangePreset(months)
    })

    qs('#btn-export-csv').addEventListener('click', () => exportCsv())

    qs('#btn-health-report').addEventListener('click', () => {
        window.open('/health/report' + toRangeQuery(), '_blank', 'noopener')
    })
}

function renderHealthProfileSummary(profile: HealthProfile | null | undefined) {
    const container = qs('#health-profile-summary')
    const p = profile || {}
    const rows = ([
        ['Blood Type', p.blood_type],
        ['Allergies', p.allergies],
        ['Medications', p.medications],
        ['Emergency Contact', p.emergency_contact],
        ['Primary Care Physician', p.primary_care_physician],
    ] as const).filter(([, value]) => value)

    if (!rows.length) {
        container.innerHTML = `<p class="text-xs text-g-gray">No health details yet. Add them in Settings.</p>`
        return
    }

    container.innerHTML = rows.map(([label, value]) => `
        <div>
            <dt class="text-xs text-g-gray">${escHtml(label)}</dt>
            <dd class="text-sm text-g-black whitespace-pre-line break-words">${escHtml(value)}</dd>
        </div>
    `).join('')
}

async function loadHealthProfile() {
    try {
        const res = await api('GET', '/api/health/profile')
        if (!res.ok) return
        const data = await res.json() as { data?: HealthProfile }
        renderHealthProfileSummary(data.data)
    } catch {
        // Profile is a supplementary panel — ignore load failures silently.
    }
}

async function boot() {
    try {
        const user = await requireUser()
        if (!user) return
        applyUserToHeader(user)

        ts.setAmPm('AM')
        setActiveTimePill('now')

        bindEvents()
        await loadEntries(true)
        await refreshAnalysis()
        await loadHealthProfile()

        applyEntryToForm(null)

        qs('#loading').classList.add('hidden')
        qs('#content').classList.remove('hidden')
        setSaveIndicator('idle', 'Idle')
    } catch (err) {
        qs('#loading').classList.add('hidden')
        qs('#error-state').classList.remove('hidden')
        qs('#error-msg').textContent = err instanceof Error ? err.message : 'Unknown error'
    }
}

initSuiteMenu('health')
boot()
