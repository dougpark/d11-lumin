# notes-ui.md

# note-editor-page
- why does this need to exist on desktop or mobile?
- only useful thing it does is show the X close button, which can be moved to the top of the note-editor component itself, and then this page can be removed.
- the center text "Edit Note" is not needed.
- the Save button is not needed since autosave was implemented.
- it also keeps the note-editor-card from showing full width on mobile

if note-editor-page cant be removed then make it visually invisible by removing the header and footer, and making the background default background color, and removing the padding on the note-editor-card so it can take up the full width of the screen.

- move the btn-note-editor-back to the top left of the note-editor-card.