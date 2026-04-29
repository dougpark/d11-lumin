# Lumin — Agent Guidelines

Personal bookmark manager with AI enrichment built on **Cloudflare Workers + Hono + D1**.  
See [README.md](README.md) for full project docs, API reference, and setup.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (edge, no Node.js) |
| Framework | Hono v4 |
| Language | TypeScript 5.7, `strict: true`, ESNext |
| Database | Cloudflare D1 (SQLite) — bound as `DB` |
| AI | Cloudflare Workers AI — bound as `AI` |
| Toolchain | Wrangler v4 + Bun |
| CSS | Tailwind CDN — **no build step**, no bundler |

## Commands

```bash
bun run dev                # local dev server at :8787
bun run deploy             # → bun wrangler deploy
bun run db:migrate:local   # apply schema.sql to local D1
bun run db:migrate:remote  # apply schema.sql to production D1
bun run cf-typegen         # regenerate wrangler bindings types
```

> There is no test suite. Validate changes manually via `bun run dev`.

## Architecture

```
src/index.ts          ← Worker entry; mounts sub-routers, inline AI + short-link handlers
src/routes/           ← auth.ts · bookmarks.ts · v1.ts (public API)
src/middleware/       ← authMiddleware (session token) · apiTokenMiddleware (API token + fallback)
src/db/               ← Raw D1 query helpers per entity — no ORM
src/utils/            ← auth (hashing) · preview (OG fetch) · rss · search (FTS query builder)
src/client/           ← Self-contained HTML pages; imported as raw text strings by Wrangler
```

Sub-routers are Hono instances, mounted in `index.ts` via `app.route(path, subRouter)`.

## Conventions

**DB queries** — Raw SQL via D1 prepared statements only. No ORM.
```ts
db.prepare('SELECT * FROM bookmarks WHERE user_id = ?').bind(userId).all<Bookmark>()
db.batch([stmt1, stmt2])  // parallel queries
```

**Auth (two-tier)**
- `authMiddleware` → session Bearer token → `users.token_hash` → sets `c.var.user`
- `apiTokenMiddleware` → named API token first (`api_tokens.token_hash`), then falls back to session token. Sets both `c.var.user` and `c.var.apiToken`.
- `/api/v1/tokens` uses `authMiddleware` only — API tokens cannot mint tokens.

**Async side effects** — Use `c.executionCtx.waitUntil(promise)` for fire-and-forget work (analytics, `last_used_at` updates). Workers terminate after response; unawaited work is killed.

**HTML client files** — Each file in `src/client/` is a self-contained SPA. Tailwind from CDN, vanilla JS only, no Alpine/React. The `@ts-expect-error` comments on HTML imports are intentional (Wrangler `Text` module rule — do not remove).

**Custom Tailwind palette** — `g.blue = #4285F4`, `g.black = #1F1F1F`, `g.gray = #474747`, `g.border = #E3E3E3`. Defined inline in every HTML file's `tailwind.config` block.

**TypeScript imports** — use explicit `.ts` extensions (required by `allowImportingTsExtensions`).

## Gotchas

- **`tag_list` / `ai_tags` / `scopes` are JSON strings**, not arrays — always `JSON.parse()` before use, `JSON.stringify()` before writing.
- **Booleans are `0|1` integers** (`is_public`, `is_archived`, `is_admin`, `ai_allow_private`) — compare with `=== 1`, not `=== true`.
- **Schema changes**: edit `schema.sql` and run `db:migrate:remote`. No migrations system. Adding columns requires `ALTER TABLE` (schema uses `CREATE TABLE IF NOT EXISTS`).
- **FTS5 triggers** — if adding searchable columns to `bookmarks`, update the three FTS triggers (`bookmarks_fts_ai/ad/au`) and the virtual table definition.
- **Sort injection protection** — `listBookmarks` allowlists sort columns via a `const` tuple. Maintain this pattern when adding sort options.
- **Cron handler** — `*/30 * * * *` is configured in `wrangler.toml`. The `scheduled` export must live in `index.ts`.
- **No staging** — `bun run deploy` goes straight to production (`d11.me`).
