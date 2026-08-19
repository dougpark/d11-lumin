// src/utils/markdown.ts — minimal server-side Markdown -> HTML renderer for RSS output.
// Mirrors the client-side renderMarkdown() in src/client/blog.html; keep both in sync if changed.

function escHtml(s: string): string {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export function renderMarkdownToHtml(md: string): string {
    const escaped = escHtml(md)
    const html = escaped
        .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
        .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
        .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')

    return html
        .split(/\n{2,}/)
        .map((block) => (/^<(h1|h2|h3|pre|img)/.test(block.trim()) ? block : `<p>${block.trim()}</p>`))
        .join('\n')
}
