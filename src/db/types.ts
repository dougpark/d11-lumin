// src/db/types.ts — shared row types mirroring the D1 schema

export type User = {
    id: number
    token_hash: string
    slug_prefix: string
    full_name: string | null
    email: string | null
    phone: string | null
    created_at: string
    updated_at: string
    ai_allow_private: number  // 0 = public bookmarks only, 1 = all bookmarks
    is_admin: number          // 0 = regular user, 1 = admin
}

export type Bookmark = {
    id: number
    user_id: number
    url: string
    slug: string
    title: string | null
    short_description: string | null
    full_text: string | null
    favicon_url: string | null
    is_public: number       // 0 | 1  (SQLite has no native boolean)
    is_archived: number     // 0 | 1
    tag_list: string        // JSON array string e.g. '["dev","tools"]'
    hit_count: number
    last_accessed: string | null
    expires_at: string | null
    created_at: string
    updated_at: string
    ai_tags: string | null          // JSON array string, additive — never overwrites tag_list
    ai_summary: string | null       // AI-generated summary, separate from short_description
    ai_processed_at: string | null  // NULL = not yet processed by AI
    full_text_processed_at: string | null   // when full-text fetch last ran
    full_text_status: string | null        // NULL | 'completed' | 'fetch_failed'
    ai_synthesis: string | null            // AI synthesis digest (markdown)
    ai_synthesis_processed_at: string | null
}

export type ClickEvent = {
    id: number
    bookmark_id: number
    clicked_at: string
    referrer: string | null
    user_agent: string | null
}

export type ApiToken = {
    id: number
    user_id: number
    name: string
    token_hash: string
    scopes: string        // JSON array string, e.g. '["posts:read","tags:read"]'
    last_used_at: string | null
    expires_at: string | null
    created_at: string
}

export type ChatChannel = {
    id: number
    name: string
    slug: string
    type?: string
    created_at: string
}

export type NoteChannel = {
    id: number
    user_id: number
    name: string
    created_at: string
    last_modified_at: string
}

export type Note = {
    note_id: number
    user_id: number
    channel_id: number
    pinned: number
    type: string
    content: string
    upvotes: number
    downvotes: number
    tag_list: string
    ai_tags: string
    ai_summary: string
    ai_processed_at: string | null
    is_hidden: number
    created_at: string
    last_modified_at: string
    is_public: number
    is_archived: number
    share_url: string
    share_expires_at: string | null
    attachment_count: number
}

export type Attachment = {
    attachment_id: number
    attachment_slug: string
    owner_user_id: number
    filename: string
    content_type: string
    size: number
    url: string
    file_last_modified: string | null
    file_category: string | null
    file_etag: string | null
    deleted_at: string | null
    cache_version: number
    tag_list: string
    summary: string
    ai_tags: string
    ai_summary: string
    ai_processed_at: string | null
    created_at: string
}

export type DriveItem = {
    drive_item_id: number
    user_id: number
    parent_id: number | null
    kind: 'folder' | 'file'
    display_name: string
    is_public: number
    deleted_at: string | null
    created_at: string
    updated_at: string
}

export type ChatMessage = {
    id: number
    channel_id: number
    user_id: number
    parent_id: number | null
    content: string
    upvotes: number
    downvotes: number
    reported: number
    is_hidden: number
    created_at: string
}

export type ChatVote = {
    id: number
    chat_id: number
    user_id: number
    vote: -1 | 1
    created_at: string
}

// ─── Input shapes (omit DB-managed fields) ────────────────────────────────────

export type CreateBookmarkInput = {
    user_id: number
    url: string
    slug: string
    title?: string
    short_description?: string
    favicon_url?: string
    is_public?: boolean
    tag_list?: string[]
    expires_at?: string
    ai_summary?: string
    ai_tags?: string[]
}

export type UpdateBookmarkInput = Partial<{
    url: string
    slug: string
    title: string
    short_description: string
    favicon_url: string
    is_public: boolean
    is_archived: boolean
    tag_list: string[]
    expires_at: string | null
    ai_summary: string | null
    ai_tags: string[]
}>

export type ListBookmarksOptions = {
    user_id: number
    sort?: 'created_at' | 'title' | 'hit_count' | 'last_accessed'
    order?: 'ASC' | 'DESC'
    tag?: string          // single-tag shorthand (still accepted, treated as tags: [tag])
    tags?: string[]       // multi-tag AND filter — each tag must appear in tag_list or ai_tags
    search?: string       // FTS5 full-text search across title, description, tags, url
    since?: string        // ISO 8601 lower bound on created_at (inclusive)
    before?: string       // ISO 8601 upper bound on created_at (inclusive, end-of-day)
    include_archived?: boolean
    unread?: boolean      // only bookmarks never clicked (hit_count = 0)
    page?: number         // 1-based
    per_page?: number     // default 25
}
