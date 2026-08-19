// src/utils/markdown.ts — server-side Markdown -> HTML renderer for RSS output.
// Uses the same `marked` library as the client-side renderMarkdown() in src/client/blog.html,
// so blockquotes, lists, tables, etc. render identically in both places.

import { marked } from 'marked'

export function renderMarkdownToHtml(md: string): string {
    try {
        return marked.parse(md, { breaks: true, gfm: true, async: false }) as string
    } catch {
        return String(md ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
    }
}
