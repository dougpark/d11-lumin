# Health Feature v1 Implementation Plan

## Goal
Build a logged-in, user-specific health tracker that works well on mobile for fast entry and on desktop for analysis. The page should support quick capture, autosave, edit/delete, backdated timestamps, and a desktop-friendly trends panel.

## Recommended Libraries
- Use [Flatpickr](https://flatpickr.js.org/) for the timestamp override control. It is lightweight, vanilla JS friendly, and easy to theme to match the existing Tailwind-driven UI.
- Use [Chart.js](https://www.chartjs.org/) for the analysis charts. It is lower overhead than D3 for this use case and is simpler to embed in a worker-served HTML page.
- Keep the actual page runtime Worker-compatible by loading these only in the browser client, not in the server runtime.

## v1 Scope
- Mobile-first quick entry form for weight, glucose, blood pressure, heart rate, note, and timestamp override.
- Autosave for edits with clear saving/saved state.
- Previous entries list with edit, delete, and load-more support.
- Desktop analysis panel with trends, summary stats, date-range filtering, and CSV export.
- User-scoped data only, backed by D1 and protected by the existing auth session flow.

## Implementation Phases

### 1. Data model and migration
- Add a new `health_entries` table.
- Include `id`, `user_id`, `weight`, `glucose_level`, `blood_pressure`, `heart_rate`, `note`, `timestamp`, `created_at`, `updated_at`, and `deleted_at`.
- Add indexes for `user_id + timestamp DESC`, `user_id + deleted_at`, and any date-range query pattern used by the analysis panel.
- Use soft delete only; do not hard-delete rows in v1.
- Decide migration strategy up front: either add a new SQL migration file under `migrations/` and update `schema.sql`, or standardize on the existing schema-driven path before coding the feature.

### 2. Database access layer
- Add a `src/db/health.ts` module with typed helpers mirroring the existing raw-SQL style.
- Implement helpers for:
  - create entry
  - update entry
  - list entries with pagination
  - fetch a single entry by id and user_id
  - soft delete entry
  - aggregate data for analysis panel
  - export rows for CSV
- Keep queries parameterized and user-scoped.

### 3. API routes
- Add authenticated routes under `/api/health`.
- Suggested endpoints:
  - `GET /api/health/entries` for the list view
  - `POST /api/health/entries` for new entries
  - `PATCH /api/health/entries/:id` for autosave and edit flows
  - `DELETE /api/health/entries/:id` for soft delete
  - `GET /api/health/analysis` for chart data and summary statistics
  - `GET /api/health/export.csv` for CSV download
- Reuse the current session-token auth middleware so only the owner can access their rows.
- Keep the response shapes simple and explicit so the client can update optimistically.

### 4. Client page
- Add a new self-contained HTML page in `src/client/`.
- Register it in `src/index.ts` like the other pages and expose a route such as `/health`.
- Use the same Lumin UI conventions already in the repo: mobile shell first, white cards, calm borders, and a desktop expansion for analysis.
- Layout suggestion:
  - top bar with page title and action menu
  - quick entry card
  - recent entries list
  - desktop-only side panel or tab for analysis

### 5. Quick entry behavior
- Split blood pressure into systolic and diastolic inputs in the UI, then store them as the required concatenated string.
- Auto-create or auto-update the active draft entry so the user does not need a manual save step.
- Debounce note updates by 1500 ms.
- Save numeric fields on change/blur to avoid excessive writes.
- Show subtle states for `saving`, `saved`, and `error`.
- Allow the timestamp to be auto-filled but overridable with a date/time picker.

### 6. Entry list behavior
- Show the newest 20 entries first.
- Add a `Load More` action to fetch older records.
- Allow inline edit and delete actions for each entry.
- Keep the list compact on mobile and expose the fuller edit affordance on desktop.

### 7. Analysis panel
- Build summary cards for averages, recent change, and range-based counts.
- Plot individual entries chronologically rather than collapsing same-day points.
- Use the exact timestamp as the x-axis value so multiple entries on the same day remain distinct.
- Add a date-range filter that re-queries the analysis endpoint.
- Provide a CSV export button that downloads the filtered dataset.

### 8. Validation and polish
- Verify the feature on mobile widths first, then test desktop analysis layout.
- Check backdated timestamp creation, load-more pagination, and delete behavior.
- Confirm that soft-deleted rows disappear from the list and analysis.
- Make sure empty states and no-data chart states are handled cleanly.
- Add any missing runtime bindings or type updates before final QA.

## What v1 Still Needs Beyond the Doc
- A clear decision on timestamp storage semantics, especially whether all timestamps are stored as UTC ISO strings and displayed in the user’s local timezone.
- Input validation rules for weight, glucose, blood pressure, and heart rate.
- The exact edit experience for a partially filled new entry: draft row, explicit save, or always-on autosave.
- Pagination contract for older entries and the analysis date range defaults.
- A CSV column definition and field ordering.
- Mobile and desktop visual states for loading, saving, and no data.
- A migration plan that fits the repo’s current schema strategy.
- Manual QA checklist for iOS and desktop browser behavior.

## Suggested v1 Acceptance Criteria
- A logged-in user can create a health entry from mobile in under a few taps.
- The page autosaves notes and field edits without losing data.
- The recent list shows the latest 20 records and can load older ones.
- The analysis panel renders charts for the selected date range.
- CSV export downloads the same dataset shown in analysis.
- Users can edit or soft-delete only their own entries.

## Task-by-Task Build Plan

1. Apply the new database migration
- Run local migration for the new health table and indexes.
- Verify schema with D1 pragma output before writing API code.
- Deliverable: local DB includes `health_entries` and indexes.

2. Add shared HealthEntry types
- Extend `src/db/types.ts` with a typed row model for health entries.
- Add input/update types for create and patch operations.
- Deliverable: typed contracts for DB and route layers.

3. Implement health DB helpers
- Create `src/db/health.ts` using the same raw SQL helper style as bookmarks/notes.
- Implement create, patch, list (paginated), soft delete, analysis aggregate, and export query helpers.
- Ensure all helpers filter by `user_id` and `deleted_at IS NULL` by default.
- Deliverable: complete DB access module for health.

4. Create health API routes
- Add `src/routes/health.ts` and protect with existing auth middleware.
- Implement:
  - `GET /api/health/entries`
  - `POST /api/health/entries`
  - `PATCH /api/health/entries/:id`
  - `DELETE /api/health/entries/:id`
  - `GET /api/health/analysis`
  - `GET /api/health/export.csv`
- Deliverable: user-scoped JSON + CSV API surface.

5. Wire routes and page in worker entry
- Import and mount health routes in `src/index.ts`.
- Add a new static page route for `/health` and import the HTML client payload.
- Deliverable: feature is reachable in local dev by URL.

6. Build mobile-first health page shell
- Add `src/client/health.html` with quick-entry card, recent entries area, and analysis access action.
- Reuse existing suite menu/header conventions from analytics/settings pages.
- Deliverable: responsive layout with base interactions wired.

7. Implement autosave interaction model
- Create draft/entry state in page JS.
- Save numeric fields on blur/change and debounce note save by 1500 ms.
- Show `saving`, `saved`, and `error` indicator states.
- Deliverable: edits persist without manual save button.

8. Implement entries list behavior
- Fetch newest 20 entries first.
- Add load-more pagination and optimistic row updates/deletes.
- Support inline edit of existing entries and timestamp override edit.
- Deliverable: manageable history view for mobile and desktop.

9. Add analysis panel and chart rendering
- Integrate Chart.js in browser-only script usage.
- Render chronological point charts that keep multiple same-day entries distinct.
- Add date-range filter controls and query wiring.
- Deliverable: trend charts and rollup cards.

10. Add CSV export flow
- Implement export API with safe CSV escaping.
- Add export button in analysis panel that passes active date range.
- Deliverable: downloadable CSV aligned with current filter state.

11. Add timestamp picker support
- Integrate Flatpickr for optional timestamp override input.
- Default to current time and allow backdating.
- Normalize outbound timestamps to UTC ISO format.
- Deliverable: reliable date/time UX for manual entry correction.

12. Manual QA and release checks
- Verify create/edit/delete/load-more/autosave on mobile and desktop widths.
- Verify date-range charts and CSV output for edge cases.
- Run local migration from a clean database and from an existing database.
- Deliverable: release-ready v1 with a signed-off QA checklist.