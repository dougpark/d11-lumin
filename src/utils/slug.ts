// src/utils/slug.ts — blog slug + excerpt generation helpers

// Lowercases, strips accents/punctuation, hyphenates. Caller handles uniqueness (append -2, -3, ...).
export function slugify(input: string): string {
    const base = input
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .replace(/-+$/g, '')

    return base || 'post'
}

// Strips common Markdown syntax and collapses whitespace, then slices to an excerpt length.
export function generateExcerpt(markdown: string, maxLength = 160): string {
    const plain = markdown
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')       // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links -> link text
        .replace(/^#{1,6}\s+/gm, '')                 // headings
        .replace(/[*_~`>#-]/g, '')                   // emphasis/quote/list markers
        .replace(/\s+/g, ' ')
        .trim()

    if (plain.length <= maxLength) return plain
    return `${plain.slice(0, maxLength).trimEnd()}…`
}
