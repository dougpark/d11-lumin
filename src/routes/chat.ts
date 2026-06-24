// src/routes/chat.ts — authenticated chat API

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env, Variables } from '../index.ts'
import {
    createMessage,
    getChannelBySlug,
    getMessageById,
    listChannels,
    listMessages,
    listReportedMessages,
    reportMessage,
    setMessageHidden,
    voteMessage,
} from '../db/chat.ts'

const chat = new Hono<{ Bindings: Env; Variables: Variables }>()

function requireAdmin(c: Context<{ Bindings: Env; Variables: Variables }>) {
    const user = c.get('user')
    if (user.is_admin !== 1) {
        return c.json({ error: 'Forbidden' }, 403)
    }
    return null
}

chat.get('/channels', async (c) => {
    const channels = await listChannels(c.env.DB)
    return c.json({ data: channels })
})

chat.get('/messages', async (c) => {
    const user = c.get('user')
    const channelSlug = c.req.query('channel')?.trim() || 'general'
    const sortQuery = c.req.query('sort')?.trim()
    const sort = sortQuery === 'popularity' || sortQuery === 'relevance' ? sortQuery : 'date'
    const q = c.req.query('q')?.trim() ?? ''
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 100)
    const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0)

    const channel = await getChannelBySlug(c.env.DB, channelSlug)
    if (!channel) return c.json({ error: 'Channel not found' }, 404)

    const result = await listMessages(c.env.DB, {
        channel_slug: channelSlug,
        user_id: user.id,
        sort,
        q,
        limit,
        offset,
    })

    return c.json({
        data: result.messages,
        meta: {
            channel: channel.slug,
            total: result.total,
            limit,
            offset,
            sort,
            q,
        },
    })
})

chat.post('/messages', async (c) => {
    const user = c.get('user')

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)

    const payload = body as Record<string, unknown>
    const channel_slug = typeof payload.channel_slug === 'string' ? payload.channel_slug.trim() : ''
    const content = typeof payload.content === 'string' ? payload.content.trim() : ''
    const parent_id = typeof payload.parent_id === 'number' ? payload.parent_id : null

    if (!channel_slug) return c.json({ error: 'channel_slug is required' }, 400)
    if (content.length === 0) return c.json({ error: 'content is required' }, 400)
    if (content.length > 4000) return c.json({ error: 'content too long (max 4000 chars)' }, 400)

    const channel = await getChannelBySlug(c.env.DB, channel_slug)
    if (!channel) return c.json({ error: 'Channel not found' }, 404)

    try {
        const id = await createMessage(c.env.DB, {
            channel_id: channel.id,
            user_id: user.id,
            parent_id,
            content,
        })

        const created = await getMessageById(c.env.DB, id)
        if (!created) return c.json({ error: 'Failed to load created message' }, 500)

        return c.json({ data: { ...created, user_vote: 0, replies: [] } }, 201)
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400)
    }
})

chat.post('/messages/:id/vote', async (c) => {
    const user = c.get('user')
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid message id' }, 400)

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)

    const voteRaw = (body as Record<string, unknown>).vote
    if (voteRaw !== 1 && voteRaw !== -1) return c.json({ error: 'vote must be 1 or -1' }, 400)

    const updated = await voteMessage(c.env.DB, { chat_id: id, user_id: user.id, vote: voteRaw })
    if (!updated) return c.json({ error: 'Message not found' }, 404)

    return c.json({ data: updated })
})

chat.post('/messages/:id/report', async (c) => {
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid message id' }, 400)

    const ok = await reportMessage(c.env.DB, id)
    if (!ok) return c.json({ error: 'Message not found' }, 404)

    return c.json({ ok: true, id })
})

chat.get('/reports', async (c) => {
    const deny = requireAdmin(c)
    if (deny) return deny

    const rows = await listReportedMessages(c.env.DB)
    return c.json({ data: rows })
})

chat.patch('/messages/:id/moderate', async (c) => {
    const deny = requireAdmin(c)
    if (deny) return deny

    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!Number.isInteger(id) || id < 1) return c.json({ error: 'Invalid message id' }, 400)

    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
    if (typeof body !== 'object' || body === null) return c.json({ error: 'Invalid body' }, 400)

    const is_hidden = (body as Record<string, unknown>).is_hidden
    if (is_hidden !== true && is_hidden !== false) return c.json({ error: 'is_hidden must be true or false' }, 400)

    const ok = await setMessageHidden(c.env.DB, { chat_id: id, is_hidden })
    if (!ok) return c.json({ error: 'Message not found' }, 404)

    return c.json({ ok: true, id, is_hidden })
})

export default chat
