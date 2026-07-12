# health.md

## Overview
- create a new page called health.html that is mobile first
- to capture health-related information effectively
- user specific for logged in user
- initial design include: weight, glucose level, blood pressure, heart rate and a note
- auto add timestamp for each entry
- no required fields as any info could be entered at anytime
- follow the Lumin UI/UX guidelines
- ensure the page is responsive and works well on mobile devices
- analysis panel should be desktop-friendly for better UX of more complex visualizations
- what is a good js library for handling date and time inputs, especially for the timestamp and date/time picker functionality
- consider using libraries like Flatpickr, Pikaday, or Tempus Dominus for robust date/time picking functionality
- choose a library that best fits the project's requirements and integrates well with the existing UI/UX design
- pick a library for charts and graphs such as Chart.js, D3.js, or ApexCharts to visualize health trends effectively
- that is low overhead and integrates well with the existing UI/UX design, and cloudflare worker compatible

## Primary UI
- start with a quick entry for weight, glucose level, blood pressure, heart rate and a note
- use autosave features so that any changes made to the health entries are automatically saved without requiring the user to manually save them
- on mobile use icons to minimize space and make the interface more user-friendly
- display a list of previous entries below the quick entry form, showing the timestamp and the recorded values
- allow editing and deleting of previous entries
- provide an icon for additional menu items, analysis panel

- Split Blood Pressure input into two numeric fields (Systolic / Diastolic) in the UI, but save as a concatenated string.
- Provide a subtle visual saving/saved indicator for the autosave loop.
- Limit the previous entries list to the most recent 20 items with a "Load More" option to maintain mobile performance.
- Debounce the note input field by 1500ms to prevent excessive database writes while typing.
- Provide a date/time picker to override the automatic timestamp for backdated entries.

# Analysis Panel UI
- desktop friendly for more complex visualizations
- new panel for analysis
  - show trends and summaries for weight, glucose level, blood pressure, and heart rate over time
  - provide visualizations such as charts or graphs to help users understand their health trends over time
  - allow users to filter the analysis by date range to focus on specific periods of their health data
  - be able to export the analysis data for further review or sharing with healthcare providers
- V1 Export format restricted to downloadable CSV.
- Charts should plot individual points chronologically, handling multiple same-day entries as distinct data points.

## Database
- Table: health_entries
  - id: primary key // unique identifier for each health entry
  - user_id: foreign key to users table
  - weight: float // max 2 decimal places
  - glucose_level: float // max 2 decimal places
  - blood_pressure: string // stored as "Systolic/Diastolic"
  - heart_rate: integer
  - note: text
  - timestamp: datetime // the time when the health entry was recorded, can be overridden by the user via the date/time picker
  - created_at: datetime
  - updated_at: datetime
  - deleted_at: datetime (nullable, for soft deletes)

# Future Version 2
- additional tables and UI for more health data
- add support for additional health metrics such as lab results, blood work, and other relevant medical tests
- add support for tracking medication and supplement intake, including dosage and frequency
- add support for tracking symptoms and side effects related to medications and health conditions
- add support for setting reminders for medication intake and health check-ins
