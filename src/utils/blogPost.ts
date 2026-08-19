// src/utils/blogPost.ts — formatting helpers for the "copy bookmark to blog post" feature

// Hostname without the "www." prefix, e.g. "blog.apple.com" — used for the attribution link text.
export function getBaseUrl(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '')
    } catch {
        return url
    }
}

// Renders the bookmark description as a blockquote followed by an attribution link to the source.
export function buildBookmarkBlogContent(input: { description: string | null; url: string }): string {
    const description = (input.description ?? '').trim()
    const quote = description
        ? description.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')
        : ''
    const attribution = `Read the full article at [${getBaseUrl(input.url)}](${input.url})`

    return quote ? `${quote}\n\n${attribution}` : attribution
}
