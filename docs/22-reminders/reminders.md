# reminders
- new ui and logic for reminders

# wrangler cron job
- runs every 5 minutes and checks for reminders that are due to be sent
- example cron job configuration in wrangler.toml:
[triggers]
crons = [
  "*/30 * * * *", # Pattern 1: RSS Ingest (Every 30 mins)
  "*/5 * * * *"   # Pattern 2: Reminders Check (Every 5 mins)
]

# new reminders call in index.ts
- example code:
```ts
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    switch (event.cron) {
      case "*/30 * * * *":
        ctx.waitUntil(ingestAllFeeds(env));
        break;

      case "*/5 * * * *":
        // Query D1, KV, or your API for reminders due in the next 5-minute window
        ctx.waitUntil(checkAndSendPendingReminders(env));
        break;

      default:
        console.log(`Unhandled cron: ${event.cron}`);
    }
  }
};
```

# reminders tables
The reason this feels like a mess is that the schema is currently trying to mix three completely different problems into a single table:
1. Schedule Definition (Rules describing when something should repeat).
2. Execution State (Tracking the next time a notification should trigger and whether it's sent).
3. Escalation / Ack Loop (Handling "repeat until user acknowledges" logic).
Combining these into one table leads to conflicting timestamps, ambiguous queries, and edge cases where a missed or unacknowledged reminder breaks the future repeating schedule.
The Industry Standard Architecture
In production scheduling engines (like Quartz, Temporal, or BullMQ), the standard pattern is Separation of Definition, State, and Escalation:
┌─────────────────────────┐
│       reminders         │  <-- Defines WHAT & original SCHEDULE
└────────────┬────────────┘
             │
             ├───► ┌─────────────────────────┐
             │     │      reminder_jobs      │  <-- State queue for NEXT execution
             │     └─────────────────────────┘
             │
             └───► ┌─────────────────────────┐
                   │   active_escalations    │  <-- Temporary state for UNACKED pings
                   └─────────────────────────┘

1. Clean Schedule Definitions (RRULE)
Instead of custom strings like "every 2 days" or "every 3 weeks"—which require complex custom parsers—the industry standard for recurring events is iCalendar RRULEs (RFC 5545).
Virtually every modern scheduling library (in JavaScript, Python, Go, etc.) can parse, validate, and compute the next occurrence from an RRULE string natively.
• "Daily at 12:00 PM": FREQ=DAILY;BYHOUR=12;BYMINUTE=0
• "Every 2 weeks on Monday": FREQ=WEEKLY;INTERVAL=2;BYDAY=MO
• "Monthly on the 1st": FREQ=MONTHLY;BYMONTHDAY=1
2. Refactored Schema Design
Here is how to clean up your schema into clear, normalized tables for a SQLite / D1 database:
Table 1: reminders (The Core Definition)
Stores what the reminder is, its display options, and its recurring rule.
CREATE TABLE reminders (
    id TEXT PRIMARY KEY,                       -- UUID v4
    user_id TEXT NOT NULL,
    message TEXT NOT NULL CHECK(length(message) <= 255),
    
    -- Recurrence Configuration
    is_recurring BOOLEAN DEFAULT FALSE,
    rrule TEXT,                                -- Standard iCal string, e.g. "FREQ=DAILY;INTERVAL=2"
    start_time DATETIME NOT NULL,              -- First scheduled time / baseline time
    
    -- Escalation & Response Rules
    response_required BOOLEAN DEFAULT FALSE,
    ack_interval_minutes INTEGER DEFAULT 0,    -- 0 = disabled, or 5, 10, 15, 30
    
    -- Display / Metadata
    sound TEXT DEFAULT 'default',
    image TEXT DEFAULT 'default_logo',
    emergency_level TEXT CHECK(emergency_level IN ('low', 'medium', 'high')) DEFAULT 'low',
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

Table 2: scheduled_jobs (The Cron Execution Queue)
Stores the exact next time a notification needs to go out. Your 5-minute cron queries only this table.
CREATE TABLE scheduled_jobs (
    id TEXT PRIMARY KEY,                       -- UUID v4
    reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    
    scheduled_for DATETIME NOT NULL,           -- Next delivery target (UTC)
    status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'cancelled')) DEFAULT 'pending',
    
    job_type TEXT CHECK(job_type IN ('scheduled_occurrence', 'ack_retry')) DEFAULT 'scheduled_occurrence',
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Crucial index for super-fast 5-minute cron queries
CREATE INDEX idx_jobs_pending ON scheduled_jobs(status, scheduled_for);

Table 3: active_escalations (Tracking Unacknowledged Alerts)
If a reminder requires a response and hasn't been acknowledged, track the retry state here without dirtying the main reminder schedule.
CREATE TABLE active_escalations (
    id TEXT PRIMARY KEY,
    reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    
    last_sent_at DATETIME NOT NULL,
    next_retry_at DATETIME NOT NULL,
    retry_count INTEGER DEFAULT 0,
    acknowledged_at DATETIME,
    
    status TEXT CHECK(status IN ('active', 'acknowledged', 'expired')) DEFAULT 'active'
);

3. How the Execution Lifecycle Works
This design turns confusing logic into three simple, isolated workflows:
A. Creating a Reminder
1. Insert the record into reminders.
2. Compute the first execution time.
3. Insert a single row into scheduled_jobs with status = 'pending'.
B. Every 5 Minutes (Your Cron Worker)
Your cron runs a lightweight query against scheduled_jobs:
SELECT * FROM scheduled_jobs 
WHERE status = 'pending' AND scheduled_for <= CURRENT_TIMESTAMP;

For each trigger:
1. Send Push Notification.
2. If Recurring: Compute the next execution timestamp using the rrule library and insert a new row into scheduled_jobs for the next date.
3. If Response Required: Insert a row into active_escalations setting next_retry_at = NOW() + ack_interval_minutes.
4. Update job status to 'completed'.
C. Escalation / Retry Loop
Inside the same 5-minute cron (or a secondary check), query active_escalations:
SELECT * FROM active_escalations 
WHERE status = 'active' AND next_retry_at <= CURRENT_TIMESTAMP;

If found, re-send the push notification and increment next_retry_at. When the user taps "Acknowledge" in your app, mark active_escalations.status = 'acknowledged'.
Summary of Improvements
• No String Parsing Hacks: Using standard rrule strings gives you robust schedule calculations out of the box.
• Blazing Fast Cron Execution: The 5-minute cron only queries scheduled_jobs on indexed status and dates. It doesn't need to parse complex rules on every run.
• Resilient Ack Escalations: Unacknowledged alerts repeat on their own retry loop without delaying or corrupting the master schedule for the next occurrence.

``` 

# reminders UI
- new html page for reminders, accessible from the start page and menu
- cloudflare will trigger every 5 minutes to check for reminders that are due to be sent
- only allow users to select a 5 minute interval for the reminder time (e.g., 12:00, 12:05, 12:10, etc.)
- one user can have multiple reminders, but each reminder must have a unique reminder time
- the UI should have a data entry section for setting up or editing a reminder.
- it should also show a list of existing reminders for the user, with the ability to edit or delete them.
- default sound is none
- default image is the app logo

# acknowledgement UI
- a unique url should be generated for each reminder that requires acknowledgement, which can be sent to the user via push notification.
- when the user receives a reminder notification, they should be able to acknowledge it in the app.
- receive a clickable url that opens up the acknowledgement page in the app, where they can tap a button to acknowledge the reminder 
- with snooze functionality, the user can snooze the reminder for a set amount of time (e.g., 5 minutes, 10 minutes, 15 minutes, etc.) before it is sent again.
- or mark it as acknowledged, which will stop any further notifications for that reminder.

# reminders logic
- iCalendar RRULEs (RFC 5545)
- there may be slight delays in Cloudflare cron job execution, so the logic should account for that and send any reminders that are due within the last 5 minutes.

# reminders notifications
- send reminder text to users default notifications service in settings.html (today only option is Brrr notifications) when due_time is reached and sent is false
