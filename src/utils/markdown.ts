// src/utils/markdown.ts — server-side Markdown -> HTML renderer for RSS output.
// Uses the same `marked` library as the client-side renderMarkdown() in src/client/blog.html,
// so blockquotes, lists, tables, etc. render identically in both places.

import { marked } from 'marked'

export function renderMarkdownToHtml(md: string): string {
    try {
        const html = marked.parse(md, { breaks: true, gfm: true, async: false }) as string
        // `![alt](url){width=300}` → width attribute (same rule as blog.html)
        return html.replace(/(<img\b[^>]*?)\s*\/?>\{width=(\d{1,4})(px)?\}/g, '$1 width="$2">')
    } catch {
        return String(md ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
    }
}
