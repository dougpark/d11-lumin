# Time Entry Plan (Health)

## Objective
Replace fragile timestamp entry with a fast, reliable time-entry system that works cleanly on iOS Safari and desktop.

## UX Direction

### 1. Adaptive numeric time input
- Use a compact time input field for `HH:MM` and a nearby AM/PM toggle.
- Mobile should open numeric keypad immediately for manual time edits.
- Manual entry must accept quick typing patterns:
	- `900` -> `09:00`
	- `1230` -> `12:30`
	- invalid values rejected inline (for example `29:99`).

### 2. Quick-select pills (mobile and desktop)
- Show the same pill row on desktop and mobile for consistency.
- Initial pill set:
	- `Now`
	- `7:00 AM`
	- `9:00 AM`
	- `12:00 PM`
	- `6:00 PM`
- Tapping a pill should update the time controls immediately and trigger autosave.
- If user manually edits time after selecting a pill, switch pill state to `Custom`.

## Data Contract
- Keep backend payload unchanged: send a single ISO timestamp field.
- UI owns conversion from local date + local time + am/pm into ISO UTC.
- No database or API schema changes required.

## Implementation Tasks

1. Replace timestamp control structure in `src/client/health.html`:
- Remove current mixed flatpickr/mobile split behavior.
- Create one shared timestamp block with:
	- date input
	- masked time input
	- am/pm segmented toggle
	- quick-select pills row

2. Add time utility helpers in page script:
- `parseTimeInput(raw)` -> `{ hour24, minute } | null`
- `formatTimeForInput(hour24, minute)` -> `HH:MM`
- `applyPillTime(pillKey, baseDate)` -> updates date/time controls
- `composeIsoFromDateTime(date, hour24, minute)` -> ISO string

3. Implement pill state management:
- Store selected pill key in client state.
- Recompute selected pill when user edits date/time manually.
- Support `Custom` visual state when no predefined pill matches.

4. Wire autosave behavior:
- Pill tap triggers immediate save.
- Date/time/AM-PM changes trigger immediate save.
- Note field remains debounced as-is (1500ms).

5. Add desktop styling parity:
- Pills should render in the same visual language on desktop and mobile.
- On desktop, pills should not stretch full width; use compact inline chips.
- On mobile, pills can wrap to the next line and remain thumb-friendly.

6. Remove dependency on problematic native datetime fallback path:
- Do not rely on iOS `datetime-local` rendering.
- Keep controls as plain date + custom time entry for predictable sizing.

7. QA matrix:
- iOS Safari: no overflow, easy manual edit, pill taps save correctly.
- Android Chrome: numeric keypad and pill behavior.
- Desktop Safari/Chrome: pills visible and usable; keyboard entry works.
- Verify saved timestamp round-trips correctly in edit mode.

## Acceptance Criteria
- User can set timestamp in under 2 taps for common times.
- Pills are visible and usable on desktop and mobile.
- Manual time entry is fast and does not overflow card layout on iOS.
- Timestamp saves as ISO UTC and reloads correctly when editing entries.