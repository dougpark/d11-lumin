# Notifications Implementation
- use in any Lumin route handler to send notifications to the current user


import { notifyUser } from '../utils/notifications.ts'

// inside a handler that has c.env.DB and c.get('user'):
await notifyUser(c.env.DB, c.get('user').id, {
    title: 'Export ready',
    message: 'Your bookmark export is available for download.',
})