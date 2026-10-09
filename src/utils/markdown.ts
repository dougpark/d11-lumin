// Shared public Markdown renderer for post pages, lists, and RSS.

import { marked } from 'marked'

const ALLOWED_TAGS = new Set([
    'p', 'br', 'hr', 'div', 'span', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'code', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'sup', 'sub',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'figure', 'figcaption', 'details', 'summary',
])
const ALLOWED_ATTRIBUTES = new Set(['title', 'alt', 'width', 'height', 'colspan', 'rowspan', 'align', 'start'])

function safeUrl(value: string, image: boolean): boolean {
    // HTMLRewriter exposes raw entities; reject encoded prefixes that browsers could decode into a scheme.
    if (value.split(/[/:?]/, 1)[0].includes('&')) return false
    if (image && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(value)) return true
    const url = new URL(value, 'https://theanalogpixel.com')
    return ['http:', 'https:', ...(image ? [] : ['mailto:', 'tel:'])].includes(url.protocol)
}

export async function renderMarkdownToHtml(md: string, opts: { embeds?: boolean } = {}): Promise<string> {
    const html = marked.parse(md, { breaks: true, gfm: true, async: false })
        .replace(/(<img\b[^>]*?)\s*\/?>\{width=(\d{1,4})(px)?\}/g, '$1 width="$2">')
    return new HTMLRewriter().on('*', {
        element(element) {
            const tag = element.tagName
            if (tag === 'ascii-art') {
                const piece = element.getAttribute('piece') ?? ''
                if (opts.embeds && /^[a-z0-9-]+$/.test(piece)) {
                    // Inert until the post-only client loader creates the approved custom element.
                    element.replace(`<div data-blog-ascii-piece="${piece}" role="status">Loading interactive content...</div>`, { html: true })
                } else {
                    element.replace('<p>View interactive content in the full post.</p>', { html: true })
                }
                return
            }
            if (!ALLOWED_TAGS.has(tag)) {
                element.remove()
                return
            }
            for (const [name, value] of [...element.attributes]) {
                const isLink = tag === 'a' && name === 'href'
                const isImage = tag === 'img' && name === 'src'
                if (isLink || isImage) {
                    try {
                        if (!safeUrl(value, isImage)) element.removeAttribute(name)
                    } catch {
                        element.removeAttribute(name)
                    }
                } else if (tag === 'code' && name === 'class' && /^language-[\w-]+$/.test(value)) {
                    continue
                } else if (!ALLOWED_ATTRIBUTES.has(name)) {
                    element.removeAttribute(name)
                }
            }
        },
    }).transform(new Response(html)).text()
}
