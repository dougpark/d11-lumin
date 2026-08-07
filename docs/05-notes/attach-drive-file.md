# Attach Drive Files to Notes

# repurpose existing btn-note-attach 
- to open a new popup for Drive file selection

# UX
- Default State (Recent Files): When opened, immediately list the 5 most recently modified/uploaded Drive objects. Statistically, users are usually attaching something they just put into Drive.
- Active State (Fuzzy Search): A prominent search input at the top. As soon as the user types, the "Recent" list is replaced by real-time search results.

- the [Upload] button should open the existing file upload modal, and when a file is uploaded, it should attach to the note and close the modals. Use current logic for creating a note attachment record and linking it to the note.

- Search should be real time as the user types, and should search over the following fields:
  - Drive file name
  - Drive file tags (if any)
  - Drive file AI tags (if any)


# UI Mockup
+-------------------------------------------------------+
| Attach from Lumin Drive                            X  |
+-------------------------------------------------------+
| [ Search files by name or tag...                   ]  |
+-------------------------------------------------------+
| Recent Files:                                         |
| [File Icon] annual_report_2026.pdf      (10 mins ago) |
| [Img Icon]  server_rack_diagram.png     (2 hours ago) |
| [Code Icon] backup_script.sh              (Yesterday) |
+-------------------------------------------------------+
| [Upload]                             [Cancel] [Attach]|
+-------------------------------------------------------+

# Version 2 Enhancements
- Add an indicator to the Drive file list to show which files are attached to a note.
- Create an Info panel that shows the Drive file's metadata, including dates, tags, ai summary and AI tags, when a file is selected in the drive list. whatever is available in the attachments table.
- Info panel to include a list of all notes that the Drive file is attached to, with links to those notes to open in a new tab.

- On the note side, add a Drive file icon to the note's attachment list for any attached Drive files. Clicking the icon should open Drive in a new tab, and display the file's metadata and linked notes.