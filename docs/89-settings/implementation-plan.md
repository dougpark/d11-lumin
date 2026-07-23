# Settings Implementation Plan

Source spec: [docs/89-settings/settings.md](settings.md)

## Summary

Implement a scoped `user_settings` model and refactor the existing settings page into a two-pane shell with dynamic section loading. Keep the current Profile and API Tokens behaviors on their existing tables, add CRUD for app-scoped settings, and introduce the first System setting for the brrr notifications API key.

## Assumptions

- Profile remains backed by `users`, not `user_settings`.
- API Tokens remain backed by `api_tokens`, not `user_settings`.
- The settings shell should use the existing `public/vendor/suite-menu.js` data as the app registry for Preferences, without editing the vendor file.
- The `settings` JSON column stores namespaced objects, not a flat key map.
- Existing users need backfilled `profile` and `system` rows so the new screen loads consistently.

## Technical Context

- Runtime is Cloudflare Workers with Hono and D1, so the implementation should stay Worker-safe and use raw SQL prepared statements.
- The current `src/client/settings.html` is a single stacked page with placeholder sections; it needs to become a shell with a left navigation rail and a right content pane.
- Settings sections should load and save independently so the page can grow without one large monolithic form.
- Mobile behavior should collapse the navigation rail into a toggleable drawer while keeping content full width.

## Constitution Check

- Use raw D1 SQL helpers, not an ORM.
- Keep changes minimal and aligned with existing file organization.
- Preserve existing auth patterns: Bearer token for the page, `authMiddleware` for user-scoped API operations.
- Keep UI work inside the existing Tailwind CDN pattern used by client pages.

## Applied Guidelines

- D1 schema changes belong in `migrations/`, with `schema.sql` updated to match.
- Shared row types belong in `src/db/types.ts` and new table helpers belong in `src/db/`.
- Client pages should remain self-contained and not depend on a new build step.
- New behavior should favor explicit state loading and small section-specific renderers over a single large settings form.

## Implementation Steps

### Phase 1: Data Model and Persistence

1. Create a new migration to add `user_settings` with `user_id`, `app_id`, `settings`, and `updated_at`, using `(user_id, app_id)` as the primary key.
2. Backfill existing users with starter rows for `profile` and `system` so those sections have deterministic records on first load.
3. Update `schema.sql` so the canonical schema matches the migration.
4. Add a `UserSettings` type to `src/db/types.ts` and a dedicated helper module in `src/db/user_settings.ts` for get, upsert, and delete operations.

### Phase 2: API Surface

1. Add a new settings route module that exposes CRUD endpoints scoped by `app_id`.
2. Support the basic operations needed by the UI: read one app's settings, create if missing, update JSON content, and delete/reset.
3. Validate `app_id` against the allowed set and reject invalid JSON payloads early.
4. Mount the new route in `src/index.ts` alongside the existing auth and v1 routers.

### Phase 3: Settings Shell Framework

1. Refactor `src/client/settings.html` into a two-pane layout with a persistent left navigation and a right-side content region.
2. Add the three major nav groups from the spec: Profile, System, and Preferences.
3. Build a client-side section registry so each section declares its title, loading logic, renderer, and save handler.
4. Make the active section reflect the URL state so users can refresh or share the current section.

### Phase 4: Existing Sections

1. Keep Profile in the new shell and continue sourcing it from `users` through the existing auth/profile path.
2. Keep API Tokens under System and continue sourcing it from `api_tokens` through the existing token API.
3. Preserve the existing token create, rotate, revoke, and copy-login flows while moving them into the right pane.

### Phase 5: New Settings Sections

1. Add the first System-level settings editor for the brrr notifications API key.
2. Store that value in `user_settings` under `app_id = 'system'` using a namespaced JSON shape such as `notifications.brrr_api_key`.
3. Generate Preferences entries from the suite menu apps and render per-app placeholders or editors as the settings surface grows.
4. Keep section defaults in code so empty JSON blobs do not need to be prepopulated with every possible key.

### Phase 6: Mobile UX and Validation

1. Make the navigation collapse into a toggleable drawer on small screens.
2. Ensure the content pane uses full width on mobile and keeps the current section visible without horizontal overflow.
3. Add loading, empty, save-success, and save-error states per section.
4. Manually verify Profile, API Tokens, and the new System notifications flow in `bun run dev`.

## Task Breakdown

- [ ] T001 [Plan:1.1] Add `migrations/2026-07-23-user-settings.sql` to create the `user_settings` table and backfill `profile` and `system` rows for existing users.
- [ ] T002 [Plan:1.2] Update `schema.sql` and `src/db/types.ts` with the `UserSettings` row type and JSON naming conventions.
- [ ] T003 [Plan:1.3] Add `src/db/user_settings.ts` helper functions for reading, upserting, and deleting scoped settings rows.
- [ ] T004 [Plan:2.1] Add CRUD handlers for `/api/v1/settings/:app_id` in a new route module and mount it from `src/index.ts`.
- [ ] T005 [Plan:2.2] Add request validation for allowed `app_id` values, JSON payload shape, and reset behavior.
- [ ] T006 [Plan:3.1] Refactor `src/client/settings.html` into a left-nav/right-pane shell with section registry and URL-driven section selection.
- [ ] T007 [Plan:3.2] Add the mobile drawer behavior and shared loading/error state handling to `src/client/settings.html`.
- [ ] T008 [Plan:4.1] Move the existing Profile display logic into the new shell without changing its `users` table source.
- [ ] T009 [Plan:4.2] Move the existing API Tokens create/list/rotate/revoke UI into the new System section without changing its `api_tokens` source.
- [ ] T010 [Plan:5.1] Add the brrr notifications API key editor backed by `user_settings` with `app_id = 'system'`.
- [ ] T011 [Plan:5.2] Generate Preferences sections from `window.LuminSuiteMenu.getItems()` and wire them to the section registry.
- [ ] T012 [Plan:6.1] Validate the full settings flow locally and update the docs if any API or UI edge cases are discovered.

## Project Structure

- `migrations/2026-07-23-user-settings.sql` - new D1 migration.
- `schema.sql` - canonical schema update.
- `src/db/types.ts` - shared row type update.
- `src/db/user_settings.ts` - new D1 helper module.
- `src/routes/settings.ts` - new settings CRUD route module.
- `src/index.ts` - route registration.
- `src/client/settings.html` - settings shell, nav, section registry, and mobile UX.

## Requirement Mapping

| REQ ID | Description | Plan Items | Implementation Evidence |
|--------|-------------|------------|------------------------|
| REQ-001 | Create a scoped `user_settings` table keyed by `user_id` and `app_id` with JSON settings storage | 1.1, 1.2, 1.3 | `migrations/2026-07-23-user-settings.sql`, `schema.sql`, `src/db/user_settings.ts` |
| REQ-002 | Seed initial `profile` and `system` rows for existing users | 1.1 | `migrations/2026-07-23-user-settings.sql` |
| REQ-003 | Replace the single stacked settings page with a two-pane shell and mobile-friendly collapsible navigation | 3.1, 3.2 | `src/client/settings.html` |
| REQ-004 | Keep Profile backed by `users` and show it under the Profile nav group | 4.1 | `src/client/settings.html`, `src/routes/auth.ts`, `src/db/users.ts` |
| REQ-005 | Keep API Tokens backed by `api_tokens` and show it under the System nav group | 4.2 | `src/client/settings.html`, `src/routes/v1.ts`, `src/db/api_tokens.ts` |
| REQ-006 | Add Preferences sections based on suite menu entries | 3.1, 5.2 | `src/client/settings.html`, `public/vendor/suite-menu.js` |
| REQ-007 | Provide CRUD endpoints for user settings scoped by `app_id` | 2.1, 2.2 | `src/routes/settings.ts`, `src/index.ts`, `src/db/user_settings.ts` |
| REQ-008 | Store the brrr notifications API key under `app_id = 'system'` in namespaced JSON | 5.1 | `src/client/settings.html`, `src/routes/settings.ts`, `src/db/user_settings.ts` |
| REQ-009 | Keep defaults in code and avoid populating the database with every missing JSON key | 1.2, 2.2, 5.1 | `src/db/user_settings.ts`, `src/client/settings.html` |
