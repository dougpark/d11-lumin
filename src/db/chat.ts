// src/db/chat.ts — D1 helper functions for chat channels/messages

import { toFtsQuery } from '../utils/search.ts'
import type { ChatChannel } from './types.ts'

export type ChatMessageView = {
    id: number
    channel_id: number
    channel_slug: string
    user_id: number
    parent_id: number | null
    content: string
    upvotes: number
    downvotes: number
    upvoters: string[]
    downvoters: string[]
    reported: number
    is_hidden: number
    created_at: string
    user_full_name: string | null
    user_slug_prefix: string
    user_is_admin: number
    user_vote: -1 | 0 | 1
    replies: ChatMessageView[]
}

type RawMessageRow = {
    id: number
    channel_id: number
    channel_slug: string
    user_id: number
    parent_id: number | null
    content: string
    upvotes: number
    downvotes: number
    reported: number
    is_hidden: number
    created_at: string
    user_full_name: string | null
    user_slug_prefix: string
    user_is_admin: number
    user_vote: -1 | 0 | 1 | null
    relevance_score?: number
}

export async function listChannels(db: D1Database): Promise<ChatChannel[]> {
    const result = await db
        .prepare('SELECT * FROM channels ORDER BY name ASC')
        .all<ChatChannel>()
    return result.results
}

export async function getChannelBySlug(db: D1Database, slug: string): Promise<ChatChannel | null> {
    const row = await db
        .prepare('SELECT * FROM channels WHERE slug = ? LIMIT 1')
        .bind(slug)
        .first<ChatChannel>()
    return row ?? null
}

export async function createMessage(db: D1Database, input: {
    channel_id: number
    user_id: number
    parent_id?: number | null
    content: string
}): Promise<number> {
    const content = input.content.trim()
    if (content.length === 0) throw new Error('Message content is required')

    if (input.parent_id) {
        const parent = await db
            .prepare('SELECT id, channel_id, parent_id FROM chats WHERE id = ? LIMIT 1')
            .bind(input.parent_id)
            .first<{ id: number; channel_id: number; parent_id: number | null }>()

        if (!parent) throw new Error('Parent message not found')
        if (parent.channel_id !== input.channel_id) throw new Error('Parent is in a different channel')
        if (parent.parent_id !== null) throw new Error('Replies can only be one level deep')
    }

    const result = await db
        .prepare(
            `INSERT INTO chats (channel_id, user_id, parent_id, content)
             VALUES (?, ?, ?, ?)`
        )
        .bind(input.channel_id, input.user_id, input.parent_id ?? null, content)
        .run()

    return Number(result.meta.last_row_id)
}

export async function getMessageById(db: D1Database, id: number): Promise<RawMessageRow | null> {
    const row = await db
        .prepare(
            `SELECT c.id, c.channel_id, ch.slug AS channel_slug, c.user_id, c.parent_id, c.content,
                    c.upvotes, c.downvotes, c.reported, c.is_hidden, c.created_at,
                    u.full_name AS user_full_name, u.slug_prefix AS user_slug_prefix, u.is_admin AS user_is_admin,
                    0 AS user_vote
             FROM chats c
             JOIN channels ch ON ch.id = c.channel_id
             JOIN users u ON u.id = c.user_id
             WHERE c.id = ?
             LIMIT 1`
        )
        .bind(id)
        .first<RawMessageRow>()

    return row ?? null
}

// Helper to fetch voter names for messages
async function getVotersForMessages(
    db: D1Database,
    messageIds: number[],
): Promise<Map<number, { upvoters: string[]; downvoters: string[] }>> {
    if (messageIds.length === 0) return new Map()

    const placeholders = messageIds.map(() => '?').join(',')
    const result = await db
        .prepare(
            `SELECT cv.chat_id, cv.vote, u.full_name, u.slug_prefix
             FROM chat_votes cv
             JOIN users u ON u.id = cv.user_id
             WHERE cv.chat_id IN (${placeholders})
             ORDER BY cv.created_at ASC`
        )
        .bind(...messageIds)
        .all<{ chat_id: number; vote: -1 | 1; full_name: string | null; slug_prefix: string }>()

    const voters = new Map<number, { upvoters: string[]; downvoters: string[] }>()

    for (const messageId of messageIds) {
        voters.set(messageId, { upvoters: [], downvoters: [] })
    }

    for (const row of result.results) {
        const entry = voters.get(row.chat_id)
        if (entry) {
            const voterName = row.full_name || row.slug_prefix
            if (row.vote === 1) {
                entry.upvoters.push(voterName)
            } else if (row.vote === -1) {
                entry.downvoters.push(voterName)
            }
        }
    }

    return voters
}

export async function listMessages(
    db: D1Database,
    opts: {
        channel_slug: string
        user_id: number
        sort?: 'date' | 'popularity' | 'relevance'
        q?: string
        limit?: number
        offset?: number
        include_hidden?: boolean
    },
): Promise<{ messages: ChatMessageView[]; total: number }> {
    const sort = opts.sort ?? 'date'
    const q = opts.q?.trim() ?? ''
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100)
    const offset = Math.max(opts.offset ?? 0, 0)

    const filters: string[] = ['ch.slug = ?', 'c.parent_id IS NULL']
    const bindings: (string | number)[] = [opts.channel_slug]

    if (!opts.include_hidden) {
        filters.push('c.is_hidden = 0')
    }

    let from = 'FROM chats c JOIN channels ch ON ch.id = c.channel_id JOIN users u ON u.id = c.user_id'
    let selectRank = ''
    if (q.length > 0) {
        from += ' JOIN chats_fts ON chats_fts.rowid = c.id'
        filters.push('chats_fts MATCH ?')
        bindings.push(toFtsQuery(q) ?? q)
    }

    if (sort === 'relevance' && q.length > 0) {
        selectRank = ', bm25(chats_fts) AS relevance_score'
    }

    const where = filters.join(' AND ')

    let orderBy = 'c.created_at ASC'
    if (sort === 'popularity') {
        orderBy = '(c.upvotes - c.downvotes) DESC, c.created_at DESC'
    }
    if (sort === 'relevance') {
        orderBy = q.length > 0
            ? 'relevance_score ASC, (c.upvotes - c.downvotes) DESC, c.created_at DESC'
            : '(c.upvotes - c.downvotes) DESC, c.created_at DESC'
    }

    const listSql = `
        SELECT c.id, c.channel_id, ch.slug AS channel_slug, c.user_id, c.parent_id, c.content,
               c.upvotes, c.downvotes, c.reported, c.is_hidden, c.created_at,
               u.full_name AS user_full_name, u.slug_prefix AS user_slug_prefix, u.is_admin AS user_is_admin,
               COALESCE(cv.vote, 0) AS user_vote
               ${selectRank}
        ${from}
        LEFT JOIN chat_votes cv ON cv.chat_id = c.id AND cv.user_id = ?
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`

    const countSql = `
        SELECT COUNT(*) AS cnt
        ${from}
        WHERE ${where}`

    const [listResult, countRow] = await Promise.all([
        db.prepare(listSql).bind(opts.user_id, ...bindings, limit, offset).all<RawMessageRow>(),
        db.prepare(countSql).bind(...bindings).first<{ cnt: number }>(),
    ])

    const topRows = listResult.results.map((r) => ({
        ...r,
        user_vote: r.user_vote ?? 0,
        upvoters: [] as string[],
        downvoters: [] as string[],
        replies: [] as ChatMessageView[],
    }))

    if (topRows.length === 0) {
        return { messages: [], total: countRow?.cnt ?? 0 }
    }

    const parentIds = topRows.map((r) => r.id)
    const placeholders = parentIds.map(() => '?').join(',')

    const repliesResult = await db
        .prepare(
            `SELECT c.id, c.channel_id, ch.slug AS channel_slug, c.user_id, c.parent_id, c.content,
                    c.upvotes, c.downvotes, c.reported, c.is_hidden, c.created_at,
                    u.full_name AS user_full_name, u.slug_prefix AS user_slug_prefix, u.is_admin AS user_is_admin,
                    COALESCE(cv.vote, 0) AS user_vote
             FROM chats c
             JOIN channels ch ON ch.id = c.channel_id
             JOIN users u ON u.id = c.user_id
             LEFT JOIN chat_votes cv ON cv.chat_id = c.id AND cv.user_id = ?
             WHERE c.parent_id IN (${placeholders})
               ${opts.include_hidden ? '' : 'AND c.is_hidden = 0'}
             ORDER BY c.created_at ASC`
        )
        .bind(opts.user_id, ...parentIds)
        .all<RawMessageRow>()

    const byParent = new Map<number, ChatMessageView[]>()
    for (const row of repliesResult.results) {
        if (!row.parent_id) continue
        const arr = byParent.get(row.parent_id) ?? []
        arr.push({ ...row, user_vote: row.user_vote ?? 0, upvoters: [], downvoters: [], replies: [] })
        byParent.set(row.parent_id, arr)
    }

    // Fetch all message IDs (top-level and replies) to get voter names
    const allMessageIds = [
        ...topRows.map((r) => r.id),
        ...repliesResult.results.map((r) => r.id),
    ]
    const votersMap = await getVotersForMessages(db, allMessageIds)

    const messages = topRows.map((row) => {
        const voters = votersMap.get(row.id) ?? { upvoters: [], downvoters: [] }
        const replies = (byParent.get(row.id) ?? []).map((reply) => {
            const replyVoters = votersMap.get(reply.id) ?? { upvoters: [], downvoters: [] }
            return { ...reply, ...replyVoters }
        })
        return {
            ...row,
            ...voters,
            replies,
        }
    })

    return {
        messages,
        total: countRow?.cnt ?? 0,
    }
}

export async function voteMessage(db: D1Database, input: {
    chat_id: number
    user_id: number
    vote: -1 | 1
}): Promise<{ upvotes: number; downvotes: number; user_vote: -1 | 0 | 1 } | null> {
    const chat = await db
        .prepare('SELECT id FROM chats WHERE id = ? LIMIT 1')
        .bind(input.chat_id)
        .first<{ id: number }>()
    if (!chat) return null

    const existing = await db
        .prepare('SELECT id, vote FROM chat_votes WHERE chat_id = ? AND user_id = ? LIMIT 1')
        .bind(input.chat_id, input.user_id)
        .first<{ id: number; vote: -1 | 1 }>()

    if (!existing) {
        await db.batch([
            db.prepare('INSERT INTO chat_votes (chat_id, user_id, vote) VALUES (?, ?, ?)')
                .bind(input.chat_id, input.user_id, input.vote),
            input.vote === 1
                ? db.prepare('UPDATE chats SET upvotes = upvotes + 1 WHERE id = ?').bind(input.chat_id)
                : db.prepare('UPDATE chats SET downvotes = downvotes + 1 WHERE id = ?').bind(input.chat_id),
        ])
    } else if (existing.vote !== input.vote) {
        await db.batch([
            db.prepare('UPDATE chat_votes SET vote = ? WHERE id = ?').bind(input.vote, existing.id),
            input.vote === 1
                ? db.prepare('UPDATE chats SET upvotes = upvotes + 1, downvotes = MAX(downvotes - 1, 0) WHERE id = ?').bind(input.chat_id)
                : db.prepare('UPDATE chats SET downvotes = downvotes + 1, upvotes = MAX(upvotes - 1, 0) WHERE id = ?').bind(input.chat_id),
        ])
    }

    const summary = await db
        .prepare(
            `SELECT c.upvotes, c.downvotes, COALESCE(cv.vote, 0) AS user_vote
             FROM chats c
             LEFT JOIN chat_votes cv ON cv.chat_id = c.id AND cv.user_id = ?
             WHERE c.id = ?
             LIMIT 1`
        )
        .bind(input.user_id, input.chat_id)
        .first<{ upvotes: number; downvotes: number; user_vote: -1 | 0 | 1 }>()

    return summary ?? null
}

export async function reportMessage(db: D1Database, chat_id: number): Promise<boolean> {
    const result = await db
        .prepare('UPDATE chats SET reported = 1 WHERE id = ?')
        .bind(chat_id)
        .run()
    return (result.meta.changes ?? 0) > 0
}

export async function listReportedMessages(db: D1Database): Promise<ChatMessageView[]> {
    const result = await db
        .prepare(
            `SELECT c.id, c.channel_id, ch.slug AS channel_slug, c.user_id, c.parent_id, c.content,
                    c.upvotes, c.downvotes, c.reported, c.is_hidden, c.created_at,
                    u.full_name AS user_full_name, u.slug_prefix AS user_slug_prefix, u.is_admin AS user_is_admin,
                    0 AS user_vote
             FROM chats c
             JOIN channels ch ON ch.id = c.channel_id
             JOIN users u ON u.id = c.user_id
             WHERE c.reported = 1
             ORDER BY c.created_at DESC`
        )
        .all<RawMessageRow>()

    return result.results.map((r) => ({ ...r, user_vote: 0, replies: [] }))
}

export async function setMessageHidden(db: D1Database, input: { chat_id: number; is_hidden: boolean }): Promise<boolean> {
    const result = await db
        .prepare('UPDATE chats SET is_hidden = ? WHERE id = ?')
        .bind(input.is_hidden ? 1 : 0, input.chat_id)
        .run()
    return (result.meta.changes ?? 0) > 0
}
