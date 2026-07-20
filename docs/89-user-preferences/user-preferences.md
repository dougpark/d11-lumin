# User Preferences

## Database Design

The Evolved "Scoped" JSON Table (Recommended)
Instead of putting the blob directly on the user table, you break it out into a dedicated Preferences Table where the JSON is scoped by the specific application.

- based on entries in /vendor/suite-menu.js 

CREATE TABLE user_preferences (
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL, -- e.g., 'dashboard', 'health', 'settings'
    settings JSON NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, app_id)
) STRICT;

Why this scales better for Multi-App systems:
•	Isolation: App A only queries and updates where app_id = 'lumin-core'. It doesn't need to know or care what App B is storing.
•	Payload Efficiency: Applications only pull the configuration data they actually need to render their specific environment.
•	Concurrency: Reduces the risk of race conditions where two separate apps try to update the user's settings at the same time.
•	Cleaner Deprecation: If you completely retire or replace one of the apps in the system, cleaning up the database is a simple DELETE WHERE app_id = 'old-app', rather than trying to parse and strip keys out of an ecosystem-wide JSON object.
Best Practices if you stick with JSON
If you go with the JSON route (either in the user table or a scoped table), following a few rules will save you a lot of downstream pain:
	1.	Use a Namespaced Structure: Never store flat keys. Structure your JSON logically so it can grow without collisions.
{
  "ui": { "theme": "dark", "sidebar_collapsed": true },
  "notifications": { "email_digests": false }
}

	2.	Handle Defaults in Code: Don't populate the database with default values for every user. Write your application logic to look for the key, and fallback to a hardcoded code default if the key is undefined or null. This keeps your database footprint tiny.

## UI
Placing this in the global header as a context-aware action is an excellent UX pattern. Because it lives at the top-level but adapts to whatever application the user is currently looking at, it acts as a bridge between identity and utility.
Given that placement and behavior, here is the best way to design it.
The Icon Verdict: Go with the Sliders (sliders-horizontal)
Because this header action will dynamically pull in app-specific configurations alongside a few global profile tweaks, the Sliders icon is your best bet.
• Why: If you use a Gear, users will expect to find heavy account management (like updating billing, changing passwords, or managing active sessions). If they click a gear in an analytics dashboard and only see "Toggle Dark Mode" and "Set Default Date Range," it feels mismatched.
• The Message: The sliders icon tells the user: "Click here to adjust how this specific screen behaves for you."
The UI Pattern: The Split Dropdown / Slide-out Panel
Since the panel handles two distinct types of data (Global User Profile vs. App-Specific Preferences), visually separating them within the same UI component will keep it clean.
Here is a conceptual layout for the header dropdown or slide-out drawer:
1. The Global Header (Upper Right)
[ App Logo ] ... [ Search ] ... [ 🎛️ Preferences ] [ User Avatar ]

2. The Popover / Drawer Layout
When the user clicks the icon, open a single container divided by a clear visual rule:
┌────────────────────────────────────────┐
│  Current App Preferences (Lumin Dash)  │  <-- App-specific section
├────────────────────────────────────────┤
│  [ ] Dark Mode                         │
│  [ Standard ▾ ] Density                │
│  [ Last 7 Days ▾ ] Default Range       │
├────────────────────────────────────────┤
│  Account & Profile                     │  <-- Universal section
├────────────────────────────────────────┤
│  Name: Jane Doe                        │
│  Email: jane@lumin.app                 │
│  [ Manage Global Account ↗ ]           │
└────────────────────────────────────────┘

How to Handle This in Your SQLite Architecture
Since you've structured your database table with user_id and app_id, this header component maps beautifully to your storage backend:
1. On App Load: The global header queries the database for two rows: app_id = 'global' (for username, theme preference, etc.) and app_id = current_app_id (e.g., 'lumin-dash').
2. On Save: When the user flips a toggle, the frontend sends a patch request to your API. The backend handles it cleanly without the apps stepping on each other's toes: • Modifying a name updates the global row. • Modifying a dashboard toggle updates the lumin-dash row.
This gives the user a single, unified place to tweak their environment while keeping your multi-app ecosystem modular and decoupled behind the scenes.