Answers About the food-tracker

Should creating a new entry happen immediately when the user taps camera/manual, or only after first successful photo upload or first field edit?
- create a new entry only after first successful photo upload or field edit.

For time-of-day boundaries, is exactly 11:00 AM lunch, exactly 3:00 PM dinner, and exactly 8:00 PM late night?
- breakfast before 11:01 AM
- lunch before 3:01 PM
- dinner before 8:01 PM

Should time-of-day be always auto-derived from timestamp, or can users manually override it?
- yes auto-derived from timestamp, but timestamp can be manually overridden, which will recalculate time-of-day. use UI/UX similar to health.html for timestamp editing.

For location values, do you want home and away only, or home and out exactly as stored values?
- home and away as stored values

How should home be configured: single fixed lat/lng per user, or account-level default for everyone initially?
- hard code for now
- Lat: 32.7189961
- Lng: -97.3563706
- future v2 add fields to user profile page and table

If EXIF GPS exists but confidence is low or timestamp/timezone looks wrong, should we still use it or ignore and fallback?
- ignore and fallback to home

Do you want automatic image compression/resizing before upload, and if yes, what max dimensions/quality?
- full size upload, but show reduced size in quick entry panel for mobile view, and show desktop as reduced size in quick entry panel for desktop view. no compression or resizing before upload.

What is the max photo size you want to allow in V1?
- max file size: 8mb

Should multiple photos per entry be supported now, or exactly one photo per entry in V1?
- exactly one photo per entry in V1

For privacy, should food images ever be publicly accessible, or strictly authenticated access only?
- strictly authenticated access only

Do you want hard delete of R2 object when entry is soft-deleted, or keep file for retention and hide in app?
- soft delete only, keep file for retention and hide in app
- v2 will add a undelete function to restore soft-deleted entries and R2 objects

Should the recent list default to 20 entries with Load More, same as health?
- yes, default to 20 entries with Load More, same as health

Should note autosave be debounced (for example ~1.5s) like health, or immediate on blur only?
- same as health, debounced ~1.5s

Should there be an explicit New Entry button that resets form and creates a blank draft, even if current draft has unsaved error?
- yes, explicit New Entry button that resets form and creates a blank draft, even if current draft has unsaved error

For the mood/energy/location icons, do you have preferred icon set/style to match existing UI?
- follow health.html style, but use different icons for food tracker to avoid confusion

Do you want V1 to include any AI fields population, or keep ai tags and summary columns empty until phase 2?
- keep ai tags and summary columns empty until phase 2

Should food tracker entries be exportable (CSV/JSON) in V1, or no export yet?
- no export yet, phase 2

Do you want a dedicated permission prompt UX explanation for camera usage on first interaction?
- yes, dedicated permission prompt UX explanation for camera usage on first interaction