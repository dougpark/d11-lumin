# Info panel to inspector panel
Turning that sidebar from a passive "Info" panel into an active "Inspector Panel"

# The Metadata & Summary Sections (Inline Editing)
Instead of adding clunky "Edit" buttons everywhere, use an "Edit on Hover/Click" pattern.
•	The Design: For fields like User tags and Summary, keep them rendering as flat text by default. When a user hovers over the field, subtly shift the background color or show a faint border/pencil icon to hint that it's interactive.
•	The Interaction: Clicking the text turns it into an active input field or textarea inline.
•	The Save Trigger: Don't make them click a "Save" button. Save automatically when they click away (on blur) or hit Enter or space (for tags).

# The Tags Section (Inline Editing)
Use the dashboard (app.html) tag list component for the tags section, but with inline editing enabled. This allows users to add or remove tags directly from the inspector panel without navigating away.
- The Design: Display existing tags as chips or badges. When a user hovers over a tag, show a small "x" icon to remove it. For adding new tags, provide an input field that expands when clicked.
- The Interaction: Clicking on the input field allows users to type a new tag. Pressing Enter or space adds the tag, while clicking the "x" removes it. The list should update in real-time.
