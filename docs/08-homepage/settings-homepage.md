# homepage
- the /homepage route can be set in a browsers default homepage for a new page or a new tab. the user will be able to define using tags what bookmarks they want to see on the homepage.  this is useful for a user that wants to see their bookmarks in a specific order, or wants to see a specific set of bookmarks on their homepage.

## New Settings Section - Homepage
- look at: settings.html
- new setting that allows the user to set a homepage url. If set, the /homepage route will redirect to that url. If not set, it will redirect to /n
- verify a valid url

## New route - /homepage
- look at: index.ts
- redirect to the url in settings.homepage if it is set, otherwise redirect to /n

## New Start Card 
- look at: start.html and public/vendor/suite-menu.js
- on the start.html page add a new card for homepage
- direct to /homepage 

# Plan
Updated todo list

Read [](file:///Users/dougpark/Projects/d11-lumin/do_docs/homepage.md)

Searched for files matching `**/settings.html`, 1 match

Searched for files matching `**/start.html`, 1 match

Searched for files matching `**/suite-menu.js`, 1 match

Read memory [](file:///Users/dougpark/Library/Application%20Support/Code/User/workspaceStorage/68ef4481403f9d106120f1b5bb6770e0/GitHub.copilot-chat/memory-tool/memories/repo/d1-migration-notes.md)

Searched for regex `user_settings|settings/:app_id|app_id` (`**/src/**`), 28 results

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/start.html)

Read [](file:///Users/dougpark/Projects/d11-lumin/public/vendor/suite-menu.js)

Read [](file:///Users/dougpark/Projects/d11-lumin/src/db/user_settings.ts)

Read [](file:///Users/dougpark/Projects/d11-lumin/src/routes/settings.ts)

Searched for regex `app.get\('/n'|app.get\('/start'|app.get\('/e'|redirect\(|c.redirect` (`**/src/index.ts`), 9 results

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/settings.html#500-500), lines 500 to 700

Searched for regex `^import|as string|settingsHtml|startHtml|from '\./client` (`**/src/index.ts`), 80 results

Read [](file:///Users/dougpark/Projects/d11-lumin/src/index.ts#1800-1800), lines 1800 to 1900

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/homepage.html#1-1), lines 1 to 40

Searched for regex `renderSystemNotificationsSection|btn-save-system-notifications|system-notifications-status|SECTIONS|appId: 'system'|case 'system'|sections\s*=|const SECTIONS` (`**/src/client/settings.html`), 15 results

Read [](file:///Users/dougpark/Projects/d11-lumin/src/client/settings.html#700-700), lines 700 to 1075

Read [](file:///Users/dougpark/Projects/d11-lumin/src/middleware/authMiddleware.ts)

Read [](file:///Users/dougpark/Projects/d11-lumin/do_docs/17-lumin-drive/todo.md)

Searched for regex `dropdownItems|suite-menu|LuminSuiteMenu|initMenu|href="/n"|href="/settings"` (`**/src/utils/header.ts`), 17 results

Searched for regex `user_settings` (`**/schema.sql`), 3 results

Good — no schema changes needed. Here's the implementation plan:

## Plan: `/homepage` feature

**No DB migration needed** — reuse existing `user_settings` table with `app_id = 'system'`, storing a new top-level key `homepage_url` (sibling to the existing `notifications` object), same pattern already used for the brrr API key.

### 1. Server route — index.ts
Add `GET /homepage` near the other HTML routes (~[line 1868](src/index.ts#L1868)):
- Read auth from `Authorization` header or `d11_auth` cookie (same pattern as authMiddleware.ts), but don't hard-fail with 401 — this route must work as a browser homepage even when signed out.
- If a valid user is resolved, call `getSetting(db, user.id, 'system', 'homepage_url')`.
- If it's a non-empty string, `c.redirect(url, 302)`.
- Otherwise (no user, no setting, or empty) `c.redirect('/n', 302)`.
- Needs new imports: `extractBearer` (from `utils/auth.ts`, `hashToken` already imported) and `getSetting` (from `db/user_settings.ts`).

### 2. Settings UI — settings.html
- Add a new section object in `buildSectionRegistry()` (near `notificationsSection`, ~[line 928](src/client/settings.html#L928)): id `system-homepage`, group `System`, `appId: 'system'`, `load: () => loadScopedSettings('system')`.
- Add `renderSystemHomepageSection(settings)` (mirrors `renderSystemNotificationsSection` at settings.html): single URL `<input type="url">` for `homepage_url`, save button + status span.
- Wire a `kind === 'system-homepage'` branch in `renderSectionContent` (~[line 764](src/client/settings.html#L764)).
- Save handler: client-side validate with `new URL(value)` (reject if invalid and non-empty), merge into existing `system` settings (`{ ...data, homepage_url: value }`, preserving `notifications`), then `saveScopedSettings('system', payload)`.
- Exclude `'homepage'` (new suite key, see below) from the generic `preferenceSections` filter (~[line 1013](src/client/settings.html#L1013)) alongside `'settings'`/`'health'`, so it doesn't get a duplicate generic-JSON section — this one's appId is `system`, not `homepage`.

### 3. New Start Card — suite-menu.js + start.html
- Add `{ key: 'homepage', href: '/homepage', label: 'Homepage' }` to `ITEMS` in suite-menu.js (single source feeding both the header suite-dropdown on every page and start.html's grid).
- In start.html: add an `ICONS.homepage` entry (icon svg) and add the same item to the hardcoded fallback list in `getSuiteItems()` for parity if the vendor script fails to load.

### Validation notes
- URL validation happens client-side (`new URL()`) before save; the generic settings.ts PUT route stays app-id-agnostic (no per-key validation there, consistent with existing pattern).
- Empty `homepage_url` is allowed (means "not set" → falls back to `/n`).

Want me to go ahead and implement these changes?

Created 4 todos