import { qs } from './dom.ts'

export type SaveMode = 'idle' | 'saving' | 'saved' | 'error'

const MODE_CLASS: Record<SaveMode, string> = {
    idle: 'text-g-gray',
    saving: 'text-g-blue',
    saved: 'text-green-700',
    error: 'text-red-500',
}

export function createSaveIndicator(selector = '#save-indicator') {
    const el = qs(selector)
    return (mode: SaveMode, text: string) => {
        el.textContent = text
        el.classList.remove(...Object.values(MODE_CLASS))
        el.classList.add(MODE_CLASS[mode])
    }
}

type Timestamped = { id: number; timestamp: string }

/** De-dupes by id (later items win) and sorts newest first. */
export function mergeEntries<T extends Timestamped>(entries: T[]): T[] {
    const byId = new Map<number, T>()
    for (const entry of entries) {
        if (entry && typeof entry.id === 'number') byId.set(entry.id, entry)
    }
    return Array.from(byId.values())
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)) || (b.id - a.id))
}

export function formatEntryTimestamp(iso: string): string {
    return new Date(iso).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
