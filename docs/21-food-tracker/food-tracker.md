# food tracker

## Overview
- a new page called Food Tracker in new food.html built similar to health.html
- mobile first and desktop support
- a new table called food_entries
- a new R2 bucket called food_entries
- provide a new page linked from health.html header
- add to /vendor/suite-menu.js Lumin Suite menu 
- button to trigger a take photo action
- second button to trigger a browser photo upload from library
- save photo to R2 food_entries
- create a new record in the food_entries table
- autosave

## food.html
- built similar to health.html

### quick entry panel
- button to capture a new photo from camera (starts a new entry)
- button to start new entry manually
- copy/paste zone and drag/drop zone and upload from library to upload photo
- show reduced size photo that leaves room on mobile device to see remaining quick entry panel without scrolling
- auto fill timestamp (same logic to edit timestamp from health.html)
- feel - happy or sad icons, single tap to select
- location - detect from photo exif if possible, let select between home and away
- energy - energized or sluggish icons
- field to capture notes
- show time-of-day - breakfast, lunch, dinner, late night (calculate from timestamp)
- autosave on leaving a field

#### default time-of-day
- breakfast before 11:00am
- lunch before 3:00pm
- dinner before 8:00pm

#### location
- determine home location from photo exif data if possible
- detect if user is away
- let user tap home or away icons to override
- defaults to home

#### energy
- energized or sluggish 
- user can manually adjust energy level 
- use single click icons to select
- defaults to null 

#### Goal review
By combining the Timestamp (automatic), Home/Out (one tap), and Happy/Sad (one tap), you get an incredibly rich dataset for behavioral reflection without ever making the user open their keyboard.

## Recent Entries list panel
- thumbnails of recent entries
- timestamp
- feel icon, energy icon, location icon, time-of-day icon
- edit button to show edit panel
- delete button to soft remove entry from D1 

### Tap/click on thumbnail
- opens a popover for mobile full screen image view with promonent X window close in top right
- desktop opens a modal with larger image view, click X or anywhere outside to close

## Database Schema - use wrangler migrations - table food_entries
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  feel          TEXT, // user happy or sad
  energy        TEXT, // user energized or sluggish
  location      TEXT, // user home or out
  location_exif  TEXT, // from photo exif data
  time-of-day    TEXT, // breakfast, lunch, dinner, late night
  ai_generated_tags TEXT,
  ai_summary    TEXT,
  note           TEXT,
  image_url        TEXT, // URL private slug to the photo stored in R2
  timestamp      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  deleted_at     TEXT,
  

## R2
- bucket to store food entry photos
- See /routes/drive.ts for similar code

# Future Version 2 Ideas
## Analysis Panel
### The "Visual Heatmap" (Pattern Detection)
Instead of standard bar graphs, use a time-of-day grid that correlates your emotional response to when and where you eat.
•	The Matrix: A grid layout where columns are the days of the week (Mon–Sun) and rows are the meal windows (Breakfast, Lunch, Dinner, Late Night).
•	The Visuals: Each slot displays the actual thumbnail of the photo taken. If it was marked "Happy," it gets a subtle green border or a floating 😊. If it was "Sad," a red border or a 😔.
•	The Insight: At a glance, the user can spot behavioral clusters. They might see a solid wall of green morning photos, but notice that their "Late Night" row is entirely red flags. It instantly answers the question: Where exactly is my friction point during the week?

### The Playbook (Green Room): 
- A dedicated filter that pulls the top 10 most recent "Happy + Home-Cooked" meal photos.
•	Why it works: When the user is tired on a Sunday evening trying to plan their week, they don't have to look up recipes online. They just look at their own Playbook of meals they know they loved and felt good eating. It’s a custom, user-generated menu.
### The Trigger Gallery (Red Room): 
- A filtered view of the "Sad" meals.
•	Why it works: It serves as an objective, non-judgmental mirror. Seeing a collection of three consecutive fast-food photos from a stressful work week helps the user recognize the context of their slip-ups without feeling bad about numerical failures.
### The "Streak of Alignment"
Instead of counting calories burned or days of perfect dieting, measure Mindfulness Consistency.
•	The Visuals: A simple calendar view where a day lights up if the user took at least two photos and assigned an emotional tag to them.
•	The Insight: It rewards the habit of mindfulness rather than the perfection of the diet. Even if a user ate pizza and marked it 😔, they still get a win for the day because they logged it honestly.