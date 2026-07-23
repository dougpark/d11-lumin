# Settings

## Overview
- settings is the overall architecture for user profile, preferences, and system configuration.

## Database Design

The Evolved "Scoped" JSON Table (Recommended)
Instead of putting the blob directly on the user table, you break it out into a dedicated settings table where the JSON is scoped by the specific application.

- app_id is based on entries in /vendor/suite-menu.js, with an additional "profile" entry for user profile data that is not app-specific, and "system" for global system configuration.

CREATE TABLE user_settings (
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL, -- e.g., 'dashboard', 'health', 'profile', 'system'
    settings JSON NOT NULL DEFAULT '{}', -- JSON blob of settings for this user and app
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, app_id)
) STRICT;

- use /migrations to create the table and add the initial app_id entries for 'profile' and 'system'.

Why this scales better for Multi-App systems:
•	Isolation: App A only queries and updates where app_id = 'profile' or app_id = 'system'. It doesn't need to know or care what App B is storing.
•	Payload Efficiency: Applications only pull the configuration data they actually need to render their specific environment.
•	Concurrency: Reduces the risk of race conditions where two separate apps try to update the user's settings at the same time.
•	Cleaner Deprecation: If you completely retire or replace one of the apps in the system, cleaning up the database is a simple DELETE WHERE app_id = 'old-app', rather than trying to parse and strip keys out of an ecosystem-wide JSON object.
Best Practices if you stick with JSON
Go with the JSON route in user_settings, following a few rules will save you a lot of downstream pain:
	1.	Use a Namespaced Structure: Never store flat keys. Structure your JSON logically so it can grow without collisions.
{
  "ui": { "theme": "dark", "sidebar_collapsed": true },
  "notifications": { "email_digests": false }
}

	2.	Handle Defaults in Code: Don't populate the database with default values for every user. Write your application logic to look for the key, and fallback to a hardcoded code default if the key is undefined or null. This keeps your database footprint tiny.

## UI
- modify the existing settings.html
- add a new left column navigation menu 
- left column has 3 main sections: Profile, System, Preferences.
- add a new right column for the settings content, which will be loaded dynamically based on the selected menu item.
- keep existing settings sections: Profile, API Tokens (added under System section), and show them when selected in the left column menu.
- under Preferences, add new app-specific settings based on the suite-menu.js entries, and show them when selected in the left column menu.

### Mobile Friendly
- make the settings page mobile friendly, with a collapsible left column menu and a full-width right column for the settings content.

## CRUD
- add new API endpoints for CRUD operations on the user_settings table, scoped by app_id.

## Existing Profile Section
- keep the existing Profile section, but move it under the Profile section in the left column menu
- does not use the user_settings table, but instead uses the existing users table.

## Existing API Tokens
- keep the existing API Tokens section, but move it under the System section in the left column menu.
- does not use the user_settings table, but instead uses the existing api_tokens table.

## Notifications
- this is the first new system-level feature that will be added to the System section.
- capture the brrr notifications API key in the user_settings table under app_id = 'system', and store it in the settings JSON blob.
