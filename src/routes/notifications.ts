// src/routes/notifications.ts — notification delivery endpoints

import { Hono } from 'hono'
import type { Env, Variables } from '../index.ts'
import { authMiddleware } from '../middleware/authMiddleware.ts'
import { notifyUser } from '../utils/notifications.ts'

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>()

notifications.use('*', authMiddleware)

// POST /api/notifications/test
// Sends a test notification to all devices registered under the user's brrr API key.
notifications.post('/test', async (c) => {
    const user = c.get('user')

    const result = await notifyUser(c.env.DB, user.id, {
        title: 'Lumin',
        message: 'Test notification from Lumin. Everything is working! 🔖',
        thread_id: 'lumin-test',
    })

    if (result.skipped) {
        return c.json({ error: 'No brrr API key configured. Save one in Notifications settings.' }, 400)
    }
    if (!result.ok) {
        return c.json({ error: `brrr returned ${result.status}: ${result.body}` }, 502)
    }

    return c.json({ ok: true, message: 'Test notification sent.' })
})

export default notifications
