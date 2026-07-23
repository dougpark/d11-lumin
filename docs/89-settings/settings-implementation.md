# Settings Implementation
- use in any Lumin route handler to read user-scoped settings

import { getSetting } from '../db/user_settings.ts'

// flat key
const theme = await getSetting(db, userId, 'dashboard', 'theme')

// nested dot-notation key
const apiKey = await getSetting(db, userId, 'system', 'notifications.brrr_api_key')

## db param is a D1Database instance

It's a `D1Database` — the Cloudflare D1 binding. In any Hono route handler you get it from `c.env.DB`:

```ts
getSetting(c.env.DB, userId, appId, key)
```