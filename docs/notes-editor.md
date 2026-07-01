# Notes Editor Features

# EasyMDE Implementation Checklist

## Phase 1 - Core Integration
- [x] Load EasyMDE CSS from jsDelivr in chat page head
- [x] Load EasyMDE JS from jsDelivr before notes-editor.js
- [x] Initialize EasyMDE against existing note editor textarea
- [x] Set `forceSync: true` so editor changes stay synced to source textarea
- [x] Disable custom markdown shortcut integration by default (use EasyMDE internal shortcuts)
- [x] Add adapter methods in notes-editor.js for `getValue`, `setValue`, and visibility control
- [x] Route note render/save flows to adapter-backed get/set value calls
- [x] Ensure paste-image flow works from EasyMDE input field

## Phase 3 - UI Polish
- [x] Add EasyMDE visual overrides to match current note editor card style
- [x] Hide EasyMDE toolbar/status UI for clean embedded experience
- [x] Preserve focus ring and border style consistency with existing design tokens
- [x] Constrain editor scroll height for mobile friendliness
- [x] Ensure preview mode hides EasyMDE editor surface and restores it on edit mode

# easyMDE
https://github.com/Ionaru/easy-markdown-editor

- jsDelivr
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.css">
<script src="https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.js"></script>

- named text area
<textarea id="my-text-area"></textarea>
<script>
const easyMDE = new EasyMDE({element: document.getElementById('my-text-area')});
</script>

- get contents from easyMDE
<script>
easyMDE.value();
</script>

- set contents of easyMDE
<script>
easyMDE.value('New input for **EasyMDE**');
</script>

- forcesync: set to true, force text changes made in EasyMDE to be immediately stored in original text area. Defaults to false




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
- Shift-cmd-T: Toggle md heading 1 # at beginning of the line
- Shift-cmd-H: Toggle md heading 2 ## at beginning of the line
- remove - Shift-cmd-B: Toggle md bold ** around selection
- remove - Shift-cmd-I: Toggle md italic * around selection
- Shift-cmd-K: Toggle md code ` around selection
- cmd-B: Toggle md bold ** around selection
- cmd-I: Toggle md italic * around selection
- cmd-K: Insert md link at cursor position [title](url) or around selection [title](url)

