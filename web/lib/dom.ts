export function qs<T extends Element = HTMLElement>(sel: string): T {
    const el = document.querySelector<T>(sel)
    if (!el) throw new Error(`Missing element: ${sel}`)
    return el
}

export function escHtml(value: unknown): string {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
