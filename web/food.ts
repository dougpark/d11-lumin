import { qs, escHtml } from './lib/dom.ts'
import { api, apiError, getToken } from './lib/api.ts'
import { requireUser, initSuiteMenu, applyUserToHeader } from './lib/session.ts'
import { createTimestampField, to12HourParts, type AmPm } from './lib/timestamp.ts'
import { createSaveIndicator, mergeEntries, formatEntryTimestamp } from './lib/entries.ts'

type Feel = 'happy' | 'sad'
type Energy = 'energized' | 'sluggish'
type Place = 'home' | 'away'

type FoodEntry = {
    id: number
    timestamp: string
    feel: Feel | null
    energy: Energy | null
    location: Place | null
    location_exif: string | null
    time_of_day: string | null
    image_url: string | null
    note: string | null
}

type EntryPayload = {
    feel: Feel | null
    energy: Energy | null
    location: Place
    location_exif: string | null
    note: string | null
    local_offset_minutes: number
    timestamp?: string
}

type ExifResult = { locationLabel: string | null; derivedLocation: Place; capturedAtIso: string | null }

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const HOME_COORDS = { lat: 32.7189961, lng: -97.3563706 }
const HOME_RADIUS_MILES = 20

const state = {
    activeEntryId: null as number | null,
    formContextVersion: 0,
    entries: [] as FoodEntry[],
    page: 1,
    totalPages: 1,
    loadingEntries: false,
    saving: false,
    pendingSave: false,
    noteTimer: null as ReturnType<typeof setTimeout> | null,
    selectedTimePill: 'now',
    hasSeenCameraNote: localStorage.getItem('food_camera_note_seen') === '1',
    feel: null as Feel | null,
    energy: null as Energy | null,
    location: 'home' as Place,
    locationExif: null as string | null,
    imageUploaded: false,
    pullRefresh: {
        startY: 0,
        currentY: 0,
        dragging: false,
        threshold: 72,
        refreshing: false,
        debounceMs: 1500,
        lastTriggeredAt: 0,
    },
}

const setSaveIndicator = createSaveIndicator()
const ts = createTimestampField()
const noteInput = qs<HTMLTextAreaElement>('#note-input')

function setUploadStatus(text: string) {
    const el = document.querySelector('#upload-status')
    if (el) el.textContent = text
}

function getTimeOfDayLabel(iso: string) {
    const date = new Date(iso)
    const minutes = (date.getHours() * 60) + date.getMinutes()
    if (minutes >= 5 * 60 && minutes <= 11 * 60) return 'breakfast'
    if (minutes >= (11 * 60) + 1 && minutes <= 15 * 60) return 'lunch'
    if (minutes >= (15 * 60) + 1 && minutes <= 20 * 60) return 'dinner'
    return 'late-night'
}

function getLocalOffsetMinutes() {
    return new Date().getTimezoneOffset()
}

function refreshTimeOfDayLabel() {
    qs('#time-of-day-label').textContent = getTimeOfDayLabel(ts.toIso() || new Date().toISOString())
}

function setActiveTimePill(key: string) {
    state.selectedTimePill = key
    document.querySelectorAll<HTMLButtonElement>('button[data-time-pill]').forEach((button) => {
        button.classList.toggle('active', button.dataset.timePill === key)
    })
}

function updatePillFromCurrentTime() {
    setActiveTimePill(getTimeOfDayLabel(ts.toIso() || new Date().toISOString()))
    refreshTimeOfDayLabel()
}

const TIME_PRESETS: Record<string, { hour12: number; minute: number; ampm: AmPm }> = {
    breakfast: { hour12: 9, minute: 0, ampm: 'AM' },
    lunch: { hour12: 1, minute: 0, ampm: 'PM' },
    dinner: { hour12: 7, minute: 0, ampm: 'PM' },
    'late-night': { hour12: 10, minute: 0, ampm: 'PM' },
}

function applyTimePill(pillKey: string) {
    ts.ensureDate()

    if (pillKey === 'now') {
        const now = to12HourParts(new Date())
        ts.setTime(now.hour12, now.minute, now.ampm)
        setActiveTimePill('now')
        refreshTimeOfDayLabel()
        return
    }

    const preset = TIME_PRESETS[pillKey]
    if (!preset) return

    ts.setTime(preset.hour12, preset.minute, preset.ampm)
    setActiveTimePill(pillKey)
    refreshTimeOfDayLabel()
}

function setOptionRow(rowSelector: string, datasetKey: 'feel' | 'energy' | 'location', value: string | null) {
    document.querySelectorAll<HTMLButtonElement>(`${rowSelector} button[data-${datasetKey}]`).forEach((button) => {
        button.classList.toggle('active', button.dataset[datasetKey] === value)
    })
}

function isPhotoLockedForCurrentEntry() {
    return Boolean(state.activeEntryId && state.imageUploaded)
}

function updatePhotoControlVisibility() {
    const isLocked = isPhotoLockedForCurrentEntry()
    qs('#photo-controls').classList.toggle('hidden', isLocked)
    qs('#photo-locked-msg').classList.toggle('hidden', !isLocked)
}

function setPreviewFromEntry(entry: FoodEntry | null) {
    const wrap = qs('#preview-wrap')
    const img = qs<HTMLImageElement>('#preview-image')
    if (!entry || !entry.image_url) {
        wrap.classList.add('hidden')
        img.removeAttribute('src')
        state.imageUploaded = false
    } else {
        img.src = `/api/food/entries/${entry.id}/image`
        wrap.classList.remove('hidden')
        state.imageUploaded = true
    }
    updatePhotoControlVisibility()
}

function setLocationExifHint(label: string | null) {
    qs('#location-exif-hint').textContent = label ? `EXIF location: ${label}` : ''
}

function applyEntryToForm(entry: FoodEntry | null) {
    state.formContextVersion += 1
    state.activeEntryId = entry ? entry.id : null
    state.feel = entry?.feel ?? null
    state.energy = entry?.energy ?? null
    state.location = entry?.location ?? 'home'
    state.locationExif = entry?.location_exif ?? null

    noteInput.value = entry?.note || ''

    if (entry?.timestamp) {
        const d = new Date(entry.timestamp)
        if (!Number.isNaN(d.getTime())) ts.setFromDate(d)
        updatePillFromCurrentTime()
    } else {
        applyTimePill('now')
    }

    setOptionRow('#feel-row', 'feel', state.feel)
    setOptionRow('#energy-row', 'energy', state.energy)
    setOptionRow('#location-row', 'location', state.location)
    setLocationExifHint(state.locationExif)
    setPreviewFromEntry(entry)
}

function getFormPayload(): EntryPayload {
    const payload: EntryPayload = {
        feel: state.feel,
        energy: state.energy,
        location: state.location,
        location_exif: state.locationExif,
        note: noteInput.value.trim() || null,
        local_offset_minutes: getLocalOffsetMinutes(),
    }

    const tsIso = ts.toIso()
    if (tsIso) payload.timestamp = tsIso

    return payload
}

function hasMeaningfulValue(payload: EntryPayload) {
    return Boolean(payload.feel || payload.energy || payload.note || state.imageUploaded || payload.location_exif)
}

async function saveCurrentEntry(): Promise<void> {
    const payload = getFormPayload()
    if (!state.activeEntryId && !hasMeaningfulValue(payload)) {
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
            ? await api('PATCH', `/api/food/entries/${state.activeEntryId}`, payload)
            : await api('POST', '/api/food/entries', payload)

        if (!response.ok) throw new Error(await apiError(response))

        const body = await response.json() as { data?: FoodEntry }
        const saved = body.data
        if (!saved) throw new Error('Missing saved entry data')

        upsertEntry(saved)
        if (saveContextVersion === state.formContextVersion) {
            state.activeEntryId = saved.id
            setPreviewFromEntry(saved)
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

function applyCapturedTimestamp(iso: string | null) {
    if (!iso) return false
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return false
    ts.setFromDate(date)
    updatePillFromCurrentTime()
    return true
}

function inferCapturedAtIsoFromFile(file: File) {
    const lastModifiedMs = Number(file.lastModified)
    if (!Number.isFinite(lastModifiedMs) || lastModifiedMs <= 0) return null
    const date = new Date(lastModifiedMs)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function uploadPhoto(file: File) {
    if (isPhotoLockedForCurrentEntry()) {
        setSaveIndicator('error', 'This entry already has a photo')
        return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
        setSaveIndicator('error', 'File exceeds 8MB')
        return
    }

    const displayName = file.name && file.name.trim() ? file.name : 'photo'
    setSaveIndicator('saving', 'Preparing photo...')
    setUploadStatus(`Reading ${displayName}...`)

    try {
        const exif = await readExifDataWithTimeout(file, 12000)
        if (exif.locationLabel) {
            state.locationExif = exif.locationLabel
            setLocationExifHint(exif.locationLabel)
        }
        state.location = exif.derivedLocation
        setOptionRow('#location-row', 'location', state.location)

        const capturedAtIso = exif.capturedAtIso || inferCapturedAtIsoFromFile(file)
        if (applyCapturedTimestamp(capturedAtIso) && !exif.capturedAtIso) {
            setUploadStatus(`Using photo timestamp from ${displayName}...`)
        }

        const form = new FormData()
        form.append('file', file)
        if (state.activeEntryId) form.append('entry_id', String(state.activeEntryId))
        if (state.feel) form.append('feel', state.feel)
        if (state.energy) form.append('energy', state.energy)
        form.append('location', state.location)
        if (state.locationExif) form.append('location_exif', state.locationExif)
        const note = noteInput.value.trim()
        if (note) form.append('note', note)
        const timestamp = ts.toIso()
        if (timestamp) form.append('timestamp', timestamp)
        form.append('local_offset_minutes', String(getLocalOffsetMinutes()))

        setSaveIndicator('saving', 'Uploading photo...')
        setUploadStatus(`Uploading ${displayName}...`)

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 45000)
        let res: Response
        try {
            res = await fetch('/api/food/entries/photo', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + getToken() },
                body: form,
                signal: controller.signal,
            })
        } finally {
            clearTimeout(timeoutId)
        }

        if (!res.ok) throw new Error(await apiError(res))

        const body = await res.json() as { data?: FoodEntry }
        const saved = body.data
        if (!saved) throw new Error('Upload did not return entry')

        state.imageUploaded = true
        upsertEntry(saved)
        applyEntryToForm(saved)
        setSaveIndicator('saved', 'Photo uploaded')
        setUploadStatus(`Uploaded ${displayName}`)
    } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
            setSaveIndicator('error', 'Upload timed out')
            setUploadStatus('Upload timed out. Check connection and try again.')
            return
        }

        setSaveIndicator('error', err instanceof Error ? err.message : 'Upload failed')
        setUploadStatus('Upload failed. Try again.')
    }
}

async function pasteImageFromClipboard() {
    if (isPhotoLockedForCurrentEntry()) {
        setSaveIndicator('error', 'This entry already has a photo')
        return
    }

    if (!window.isSecureContext || !navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
        setSaveIndicator('error', 'Clipboard paste not supported')
        setUploadStatus('Clipboard image paste is not available on this browser. Use Upload From Library.')
        return
    }

    try {
        const items = await navigator.clipboard.read()
        for (const item of items) {
            const imageType = item.types.find((type) => type.startsWith('image/'))
            if (!imageType) continue

            const blob = await item.getType(imageType)
            const extension = imageType.split('/')[1] || 'png'
            const file = new File([blob], `clipboard-${Date.now()}.${extension}`, {
                type: imageType,
                lastModified: Date.now(),
            })
            await uploadPhoto(file)
            return
        }

        setSaveIndicator('error', 'No image found in clipboard')
        setUploadStatus('Clipboard does not contain an image. Copy an image first.')
    } catch {
        setSaveIndicator('error', 'Clipboard access denied')
        setUploadStatus('Clipboard access denied. Use Upload From Library if prompted by your browser.')
    }
}

function upsertEntry(entry: FoodEntry) {
    state.entries = mergeEntries([...state.entries, entry])
    renderEntries()
}

const CHIP = 'px-2 py-0.5 rounded-full bg-[#F4F7FF] text-g-black'

function renderEntryIcons(entry: FoodEntry) {
    const parts: string[] = []
    if (entry.feel) parts.push(`<span class="${CHIP}">${entry.feel === 'happy' ? 'HA' : 'SD'}</span>`)
    if (entry.energy) parts.push(`<span class="${CHIP}">${entry.energy === 'energized' ? 'EZ' : 'SL'}</span>`)
    if (entry.location) parts.push(`<span class="${CHIP}">${entry.location === 'home' ? 'HM' : 'AW'}</span>`)
    if (entry.time_of_day) parts.push(`<span class="${CHIP}">${escHtml(entry.time_of_day)}</span>`)
    return parts.join('')
}

function renderEntries() {
    qs('#entries-total').textContent = `${state.entries.length} loaded`
    qs('#entries-empty').classList.toggle('hidden', state.entries.length > 0)
    qs('#btn-load-more').classList.toggle('hidden', state.page >= state.totalPages)

    qs('#entries-list').innerHTML = state.entries.map((entry) => {
        const isActive = state.activeEntryId === entry.id
        const img = entry.image_url
            ? `<img data-thumb-id="${entry.id}" src="/api/food/entries/${entry.id}/image" alt="Meal" class="thumb cursor-pointer">`
            : `<div class="thumb flex items-center justify-center text-[10px] text-g-gray">No image</div>`

        return `
            <article class="border ${isActive ? 'border-g-blue bg-blue-50/40' : 'border-g-border bg-white'} rounded-[12px] p-3">
                <div class="flex items-start gap-3">
                    <div>${img}</div>
                    <div class="min-w-0 flex-1">
                        <p class="text-xs text-g-gray">${formatEntryTimestamp(entry.timestamp)}</p>
                        <div class="mt-1 flex flex-wrap gap-2 text-xs">${renderEntryIcons(entry)}</div>
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
        const res = await api('GET', `/api/food/entries?page=${state.page}&per_page=20`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json() as { data?: FoodEntry[]; meta?: { total_pages?: number } }
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

async function deleteEntry(id: number) {
    if (!window.confirm('Delete this food entry?')) return
    const res = await api('DELETE', `/api/food/entries/${id}`)
    if (!res.ok) {
        window.alert(await apiError(res).catch(() => 'Could not delete entry'))
        return
    }

    state.entries = state.entries.filter((entry) => entry.id !== id)
    if (state.activeEntryId === id) {
        applyEntryToForm(null)
        setSaveIndicator('idle', 'Idle')
    }
    renderEntries()
}

function openImageModal(entryId: number) {
    qs<HTMLImageElement>('#modal-image').src = `/api/food/entries/${entryId}/image`
    qs('#image-modal').classList.remove('hidden')
}

function closeImageModal() {
    qs('#image-modal').classList.add('hidden')
    qs('#modal-image').removeAttribute('src')
}

function setPullIndicator(text: string, visible: boolean) {
    const indicator = qs('#pull-refresh-indicator')
    indicator.textContent = text
    indicator.classList.toggle('visible', visible)
}

function refreshFeedFromPull() {
    const pr = state.pullRefresh
    const now = Date.now()
    if (pr.refreshing) return
    if (now - pr.lastTriggeredAt < pr.debounceMs) return

    pr.refreshing = true
    pr.lastTriggeredAt = now
    setPullIndicator('Reloading...', true)

    // iOS Safari standalone/PWA can ignore reload(); force a navigation refresh.
    const refreshUrl = new URL(window.location.href)
    refreshUrl.searchParams.set('_pull_refresh', String(now))
    window.location.replace(refreshUrl.toString())
}

function bindPullToRefresh() {
    const pr = state.pullRefresh

    document.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1) return
        if (pr.refreshing) return
        if (Date.now() - pr.lastTriggeredAt < pr.debounceMs) return
        if (window.scrollY > 0) return
        if (!qs('#image-modal').classList.contains('hidden')) return

        const t = event.touches[0]
        pr.startY = t.clientY
        pr.currentY = t.clientY
        pr.dragging = true
    }, { passive: true })

    document.addEventListener('touchmove', (event) => {
        if (!pr.dragging || pr.refreshing) return

        pr.currentY = event.touches[0].clientY
        const delta = pr.currentY - pr.startY

        if (delta <= 8) {
            setPullIndicator('Pull to refresh', false)
            return
        }

        if (window.scrollY > 0) {
            pr.dragging = false
            setPullIndicator('Pull to refresh', false)
            return
        }

        setPullIndicator(delta >= pr.threshold ? 'Release to refresh' : 'Pull to refresh', true)
    }, { passive: true })

    document.addEventListener('touchend', () => {
        if (!pr.dragging) return
        pr.dragging = false

        const delta = pr.currentY - pr.startY
        if (delta >= pr.threshold && window.scrollY === 0) {
            refreshFeedFromPull()
            return
        }

        setPullIndicator('Pull to refresh', false)
    })

    document.addEventListener('touchcancel', () => {
        pr.dragging = false
        if (!pr.refreshing) setPullIndicator('Pull to refresh', false)
    })
}

function bindUploadGestures() {
    const dropzone = qs('#dropzone')

    const onDragOver = (event: DragEvent) => {
        if (isPhotoLockedForCurrentEntry()) return
        event.preventDefault()
        dropzone.classList.add('drag-over')
    }
    dropzone.addEventListener('dragenter', onDragOver)
    dropzone.addEventListener('dragover', onDragOver)
    dropzone.addEventListener('dragleave', (event) => {
        event.preventDefault()
        dropzone.classList.remove('drag-over')
    })
    dropzone.addEventListener('drop', (event) => {
        if (isPhotoLockedForCurrentEntry()) return
        event.preventDefault()
        dropzone.classList.remove('drag-over')
        const file = event.dataTransfer?.files?.[0]
        if (file) uploadPhoto(file)
    })

    document.addEventListener('paste', (event) => {
        if (isPhotoLockedForCurrentEntry()) return
        for (const item of event.clipboardData?.items || []) {
            if (!item.type.startsWith('image/')) continue
            const file = item.getAsFile()
            if (file) {
                uploadPhoto(file)
                break
            }
        }
    })
}

function bindFileInput(selector: string) {
    const fileInput = qs<HTMLInputElement>(selector)
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0]
        if (file) uploadPhoto(file)
        fileInput.value = ''
    })
}

function bindOptionRow<K extends 'feel' | 'energy'>(key: K, toggle: (value: string) => void) {
    qs(`#${key}-row`).addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(`button[data-${key}]`)
        const value = button?.dataset[key]
        if (!value) return
        toggle(value)
        scheduleSave(0)
    })
}

function bindEvents() {
    qs('#btn-new-entry').addEventListener('click', (event) => {
        event.preventDefault()
        applyEntryToForm(null)
        setSaveIndicator('idle', 'Idle')
    })

    qs('#btn-upload-library').addEventListener('click', () => qs('#library-input').click())

    qs('#btn-paste-image').addEventListener('click', (event) => {
        event.preventDefault()
        pasteImageFromClipboard()
    })

    qs('#btn-take-photo').addEventListener('click', () => {
        if (!state.hasSeenCameraNote) qs('#camera-permission-note').classList.remove('hidden')
        qs('#camera-input').click()
    })

    qs('#btn-camera-note-ok').addEventListener('click', () => {
        state.hasSeenCameraNote = true
        localStorage.setItem('food_camera_note_seen', '1')
        qs('#camera-permission-note').classList.add('hidden')
    })

    bindFileInput('#camera-input')
    bindFileInput('#library-input')
    bindUploadGestures()

    for (const el of [ts.dateInput, ts.timeInput]) {
        el.addEventListener('input', () => updatePillFromCurrentTime())
        el.addEventListener('change', () => {
            updatePillFromCurrentTime()
            scheduleSave(0)
        })
        el.addEventListener('blur', () => {
            if (el === ts.timeInput && !ts.normalize()) {
                setSaveIndicator('error', 'Time must be HH:MM')
                return
            }
            updatePillFromCurrentTime()
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

    bindOptionRow('feel', (value) => {
        state.feel = state.feel === value ? null : value as Feel
        setOptionRow('#feel-row', 'feel', state.feel)
    })

    bindOptionRow('energy', (value) => {
        state.energy = state.energy === value ? null : value as Energy
        setOptionRow('#energy-row', 'energy', state.energy)
    })

    qs('#location-row').addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-location]')
        if (!button) return
        state.location = (button.dataset.location || 'home') as Place
        setOptionRow('#location-row', 'location', state.location)
        scheduleSave(0)
    })

    noteInput.addEventListener('input', () => {
        setSaveIndicator('saving', 'Typing...')
        scheduleSave(1500)
    })

    qs('#entries-list').addEventListener('click', (event) => {
        const target = event.target as HTMLElement

        const editId = target.getAttribute('data-edit-id')
        if (editId) {
            const entry = state.entries.find((item) => item.id === Number.parseInt(editId, 10))
            if (entry) {
                applyEntryToForm(entry)
                renderEntries()
                setSaveIndicator('idle', 'Editing selected entry')
            }
            return
        }

        const deleteId = target.getAttribute('data-delete-id')
        if (deleteId) {
            deleteEntry(Number.parseInt(deleteId, 10))
            return
        }

        const thumbId = target.getAttribute('data-thumb-id')
        if (thumbId) openImageModal(Number.parseInt(thumbId, 10))
    })

    qs('#btn-load-more').addEventListener('click', async () => {
        if (state.page >= state.totalPages) return
        state.page += 1
        await loadEntries(false)
    })

    qs('#modal-close').addEventListener('click', closeImageModal)
    qs('#image-modal').addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closeImageModal()
    })
}

// ─── EXIF (JPEG only): capture time + GPS → home/away ─────────────────────────

function exifFallbackResult(): ExifResult {
    return { locationLabel: null, derivedLocation: 'home', capturedAtIso: null }
}

async function readExifDataWithTimeout(file: File, timeoutMs: number): Promise<ExifResult> {
    try {
        return await Promise.race([
            readExifData(file),
            new Promise<ExifResult>((resolve) => setTimeout(() => resolve(exifFallbackResult()), timeoutMs)),
        ])
    } catch {
        return exifFallbackResult()
    }
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
    const toRad = (value: number) => value * Math.PI / 180
    const dLat = toRad(lat2 - lat1)
    const dLng = toRad(lng2 - lng1)
    const a = (Math.sin(dLat / 2) ** 2)
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * (Math.sin(dLng / 2) ** 2)
    return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isValidGps(lat: number | null, lng: number | null): boolean {
    if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false
    if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

function parseExifDateToIso(raw: string | null): string | null {
    if (!raw) return null
    const match = raw.trim().replace(/\u0000/g, '').match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/)
    if (!match) return null
    const [, y, mo, d, h, mi, s] = match.map(Number)
    // EXIF DateTimeOriginal is local wall-clock time.
    const date = new Date(y, mo - 1, d, h, mi, s, 0)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function readAscii(view: DataView, start: number, len: number) {
    let out = ''
    for (let i = 0; i < len; i += 1) out += String.fromCharCode(view.getUint8(start + i))
    return out
}

async function readExifData(file: File): Promise<ExifResult> {
    if (!/image\/jpe?g/i.test(file.type)) return exifFallbackResult()

    // EXIF lives near the start of JPEGs; only scan the header region of large photos.
    const MAX_EXIF_SCAN_BYTES = 512 * 1024
    const scanBlob = file.size > MAX_EXIF_SCAN_BYTES ? file.slice(0, MAX_EXIF_SCAN_BYTES) : file

    try {
        const view = new DataView(await scanBlob.arrayBuffer())
        if (view.getUint16(0) !== 0xFFD8) return exifFallbackResult()

        let offset = 2
        let gpsLat: number | null = null
        let gpsLng: number | null = null
        let dateTimeOriginal: string | null = null
        let guard = 0

        while (offset < view.byteLength && guard < 20000) {
            guard += 1
            const marker = view.getUint16(offset)
            offset += 2
            if (marker === 0xFFDA || marker === 0xFFD9) break
            if (offset + 2 > view.byteLength) break
            const size = view.getUint16(offset)
            offset += 2
            if (size < 2) break
            if (offset + (size - 2) > view.byteLength) break
            if (marker !== 0xFFE1 || readAscii(view, offset, 6) !== 'Exif\u0000\u0000') {
                offset += size - 2
                continue
            }

            const tiff = offset + 6
            const little = view.getUint16(tiff) === 0x4949
            const getU16 = (pos: number) => view.getUint16(pos, little)
            const getU32 = (pos: number) => view.getUint32(pos, little)

            const readRational = (pointer: number) => {
                const den = getU32(tiff + pointer + 4)
                return den ? getU32(tiff + pointer) / den : 0
            }
            const readDms = (pointer: number) => readRational(pointer) + (readRational(pointer + 8) / 60) + (readRational(pointer + 16) / 3600)

            const readString = (pointer: number, count: number) => {
                let out = ''
                for (let i = 0; i < count; i += 1) {
                    const code = view.getUint8(tiff + pointer + i)
                    if (code === 0) break
                    out += String.fromCharCode(code)
                }
                return out
            }

            const ifd0Offset = getU32(tiff + 4)
            const ifdCount = getU16(tiff + ifd0Offset)
            let gpsPointer: number | null = null
            let exifPointer: number | null = null

            for (let i = 0; i < ifdCount; i += 1) {
                const entry = tiff + ifd0Offset + 2 + (i * 12)
                const tag = getU16(entry)
                if (tag === 0x8825) gpsPointer = getU32(entry + 8)
                if (tag === 0x8769) exifPointer = getU32(entry + 8)
            }

            if (gpsPointer) {
                const gpsCount = getU16(tiff + gpsPointer)
                let latRef = 'N'
                let lngRef = 'E'
                let lat: number | null = null
                let lng: number | null = null

                for (let g = 0; g < gpsCount; g += 1) {
                    const entry = tiff + gpsPointer + 2 + (g * 12)
                    const tag = getU16(entry)
                    const count = getU32(entry + 4)
                    const value = getU32(entry + 8)

                    if (tag === 1) latRef = String.fromCharCode(view.getUint8(entry + 8))
                    if (tag === 2) lat = readDms(value)
                    if (tag === 3) lngRef = String.fromCharCode(view.getUint8(entry + 8))
                    if (tag === 4) lng = readDms(value)
                    if (tag === 29 && !dateTimeOriginal) dateTimeOriginal = readString(value, count)
                }

                if (lat !== null && lng !== null) {
                    gpsLat = latRef === 'S' ? -lat : lat
                    gpsLng = lngRef === 'W' ? -lng : lng
                }
            }

            if (exifPointer) {
                const exifCount = getU16(tiff + exifPointer)
                for (let e = 0; e < exifCount; e += 1) {
                    const entry = tiff + exifPointer + 2 + (e * 12)
                    if (getU16(entry) === 0x9003 && !dateTimeOriginal) {
                        dateTimeOriginal = readString(getU32(entry + 8), getU32(entry + 4))
                    }
                }
            }
            break
        }

        const capturedAtIso = parseExifDateToIso(dateTimeOriginal)
        if (!isValidGps(gpsLat, gpsLng)) return { locationLabel: null, derivedLocation: 'home', capturedAtIso }

        const lat = gpsLat as number
        const lng = gpsLng as number
        const distance = haversineMiles(lat, lng, HOME_COORDS.lat, HOME_COORDS.lng)
        return {
            locationLabel: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            derivedLocation: distance <= HOME_RADIUS_MILES ? 'home' : 'away',
            capturedAtIso,
        }
    } catch {
        return exifFallbackResult()
    }
}

async function boot() {
    try {
        const user = await requireUser()
        if (!user) return
        applyUserToHeader(user)

        if (!state.hasSeenCameraNote) qs('#camera-permission-note').classList.remove('hidden')

        ts.setAmPm('AM')
        applyTimePill('now')
        bindEvents()
        bindPullToRefresh()
        await loadEntries(true)
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

initSuiteMenu('food')
boot()
