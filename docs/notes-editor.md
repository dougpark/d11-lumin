# Notes Editor Features

# help modal
Place a small ⌘ icon in the top-right corner of your editor toolbar. Clicking it opens a clean, centered modal with a list of keyboard shortcuts and their actions. The modal should be dismissible by clicking outside of it or pressing the Escape key.
Shortcut	            Action
Cmd + B 	            Bold
Cmd + I             	Italic
Cmd + K	                Insert Link
Shift-Cmd-L	            Task List
Shift-Cmd-T	            Title (#)
Shift-Cmd-H	            Heading (##)
Shift-Cmd-K	            Inline Code

# Shortcuts
- Shift-cmd-L: Toggle md task list - [ ] at beginning of the line (already implemented in notes-editor.js)
- Shift-cmd-T: Toggle md title # at beginning of the line
- Shift-cmd-B: Toggle md bold ** around selection
- Shift-cmd-I: Toggle md italic * around selection
- Shift-cmd-K: Toggle md code ` around selection
- Shift-cmd-H: Toggle md heading ## at beginning of the line
- cmd-B: Toggle md bold ** around selection
- cmd-I: Toggle md italic * around selection
- cmd-K: Insert md link at cursor position [title](url) or around selection [title](url)

# Undo/Redo
- cmd-Z: Undo last change
- Shift-cmd-Z: Redo last undone change
- create an undo stack to support multiple undos/redos
- integrate undo/redo functionality with keyboard shortcuts
