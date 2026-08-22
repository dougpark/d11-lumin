// public/chat/notes-editor.js
// Notes editor enhancements that can evolve independently from chat.html.
(function attachNotesEditorShortcuts(globalScope) {
    // Pin exact versions — bare "codemirror@6" resolves to a mis-tagged CM5 republish.
    // NOTE: deliberately NOT importing @codemirror/language separately here. Doing so (to
    // get classHighlighter for stable tok-* CSS classes) resolves a different @lezer/highlight
    // instance than the one @codemirror/lang-markdown's tags use, and crashes
    // ("TypeError: Cannot read properties of undefined (reading 'scope')") inside
    // @lezer/highlight's highlightRange during decoration build. minimalSetup's own bundled
    // defaultHighlightStyle comes from the same resolution graph as `codemirror` core and
    // works without error, so we rely on that instead (see CSS notes in notes.html).
    const CM6_URLS = {
        core: 'https://esm.sh/codemirror@6.0.2',
        state: 'https://esm.sh/@codemirror/state@6',
        view: 'https://esm.sh/@codemirror/view@6',
        commands: 'https://esm.sh/@codemirror/commands@6',
        markdown: 'https://esm.sh/@codemirror/lang-markdown@6',
    }

    let cm6ModulesPromise = null
    function loadCM6Modules() {
        if (!cm6ModulesPromise) {
            cm6ModulesPromise = Promise.all([
                import(CM6_URLS.core),
                import(CM6_URLS.state),
                import(CM6_URLS.view),
                import(CM6_URLS.commands),
                import(CM6_URLS.markdown),
            ]).then(([core, state, view, commands, mdLang]) => ({
                EditorView: view.EditorView,
                keymap: view.keymap,
                minimalSetup: core.minimalSetup,
                EditorState: state.EditorState,
                markdown: mdLang.markdown,
                undo: commands.undo,
                redo: commands.redo,
                historyKeymap: commands.historyKeymap,
            }))
        }
        return cm6ModulesPromise
    }

    let activeView = null
    let activeContainer = null

    function refreshEditorLayout() {
        activeView?.requestMeasure()
    }

    function focusEditor(fallbackInput) {
        if (activeView) {
            activeView.focus()
            return
        }
        if (fallbackInput) {
            fallbackInput.focus()
        }
    }

    function getEditorValue(fallbackInput) {
        if (activeView) {
            return activeView.state.doc.toString()
        }
        return fallbackInput?.value || ''
    }

    function setEditorValue(nextValue, fallbackInput) {
        const value = String(nextValue ?? '')
        if (activeView) {
            activeView.dispatch({
                changes: { from: 0, to: activeView.state.doc.length, insert: value },
            })
            if (fallbackInput && fallbackInput.value !== value) {
                fallbackInput.value = value
            }
            return
        }
        if (fallbackInput) {
            fallbackInput.value = value
        }
    }

    // Captures where to insert pasted content — a CM6 doc position when the editor is
    // mounted, or a plain textarea selection range otherwise. Returns null if neither is available.
    function getEditorCursorState(fallbackInput) {
        if (activeView) {
            const { from, to } = activeView.state.selection.main
            return { type: 'cm6', from, to }
        }
        if (fallbackInput && typeof fallbackInput.selectionStart === 'number') {
            return { type: 'textarea', start: fallbackInput.selectionStart, end: fallbackInput.selectionEnd ?? fallbackInput.selectionStart }
        }
        return null
    }

    // Inserts text at a previously-captured cursor state and returns the resulting cursor
    // state (so callers can chain further insertions immediately after it). Returns null
    // when no cursor state was supplied, letting the caller fall back to its own default.
    function insertTextAtCursor(text, fallbackInput, cursorState) {
        if (!cursorState) return null

        if (activeView && cursorState.type === 'cm6') {
            const docLength = activeView.state.doc.length
            const from = Math.min(cursorState.from, docLength)
            const to = Math.min(cursorState.to, docLength)
            activeView.dispatch({
                changes: { from, to, insert: text },
                selection: { anchor: from + text.length },
            })
            if (fallbackInput) fallbackInput.value = activeView.state.doc.toString()
            const nextPos = from + text.length
            return { type: 'cm6', from: nextPos, to: nextPos }
        }

        if (fallbackInput && cursorState.type === 'textarea') {
            const value = fallbackInput.value || ''
            const nextValue = value.slice(0, cursorState.start) + text + value.slice(cursorState.end)
            fallbackInput.value = nextValue
            const caret = cursorState.start + text.length
            fallbackInput.setSelectionRange?.(caret, caret)
            return { type: 'textarea', start: caret, end: caret }
        }

        return null
    }

    function setEditorVisible(isVisible, fallbackInput) {
        const visible = Boolean(isVisible)
        // Once CM6 has mounted, the raw textarea is a permanently-hidden value store — only
        // toggle its visibility here pre-mount, when it's still the actual visible editor.
        if (fallbackInput && !activeView) {
            fallbackInput.hidden = !visible
        }
        activeContainer?.classList.toggle('hidden', !visible)
        if (visible) refreshEditorLayout()
    }

    // ─── Formatting commands (shared by the toolbar buttons and keymap below) ──────

    function wrapSelectionWithMarker(view, marker) {
        const { from, to } = view.state.selection.main
        const selected = view.state.sliceDoc(from, to)
        const insert = `${marker}${selected}${marker}`
        view.dispatch({
            changes: { from, to, insert },
            selection: selected
                ? { anchor: from + marker.length, head: from + marker.length + selected.length }
                : { anchor: from + marker.length },
        })
        view.focus()
        return true
    }

    function wrapSelectionAsCode(view) {
        const { from, to } = view.state.selection.main
        const selected = view.state.sliceDoc(from, to)
        if (!selected.includes('\n')) {
            return wrapSelectionWithMarker(view, '`')
        }
        const insert = `\`\`\`\n${selected}\n\`\`\``
        view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + 4, head: from + 4 + selected.length },
        })
        view.focus()
        return true
    }

    function insertLinePrefix(view, prefix) {
        const { from } = view.state.selection.main
        const line = view.state.doc.lineAt(from)
        view.dispatch({
            changes: { from: line.from, to: line.from, insert: prefix },
            selection: { anchor: from + prefix.length },
        })
        view.focus()
        return true
    }

    function insertMarkdownLinkCM6(view) {
        const { from, to } = view.state.selection.main
        const selected = view.state.sliceDoc(from, to)
        const title = selected || 'title'
        const linkText = `[${title}](url)`
        const urlStart = from + linkText.length - 4
        const urlEnd = from + linkText.length - 1
        view.dispatch({
            changes: { from, to, insert: linkText },
            selection: { anchor: urlStart, head: urlEnd },
        })
        view.focus()
        return true
    }

    function insertMarkdownImageScaffold(view) {
        const { from, to } = view.state.selection.main
        const selected = view.state.sliceDoc(from, to)
        const alt = selected || 'alt text'
        const insert = `![${alt}](url)`
        view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + 2, head: from + 2 + alt.length },
        })
        view.focus()
        return true
    }

    function insertTableScaffold(view) {
        const { from, to } = view.state.selection.main
        const insert = '\n| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Text     | Text     | Text     |\n'
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } })
        view.focus()
        return true
    }

    function applyChecklistCycleOnCurrentLine(view) {
        const pos = view.state.selection.main.from
        const line = view.state.doc.lineAt(pos)
        const text = line.text
        const match = text.match(/^(\s*)-\s\[( |x|X)\]\s?(.*)$/)

        let nextLine = text
        let oldPrefixLen = 0
        let newPrefixLen = 0

        if (!match) {
            const indentMatch = text.match(/^(\s*)(.*)$/)
            const indent = indentMatch ? indentMatch[1] : ''
            const body = indentMatch ? indentMatch[2] : text
            const prefix = '- [ ] '
            nextLine = `${indent}${prefix}${body}`
            oldPrefixLen = indent.length
            newPrefixLen = indent.length + prefix.length
        } else if (match[2] === ' ') {
            const prefix = `${match[1]}- [x] `
            nextLine = `${prefix}${match[3]}`
            oldPrefixLen = text.length - match[3].length
            newPrefixLen = prefix.length
        } else {
            nextLine = `${match[1]}${match[3]}`
            oldPrefixLen = text.length - nextLine.length
            newPrefixLen = match[1].length
        }

        if (nextLine === text) return false

        const oldCh = pos - line.from
        const nextCh = oldCh <= oldPrefixLen
            ? Math.min(oldCh, newPrefixLen)
            : Math.min(newPrefixLen + (oldCh - oldPrefixLen), nextLine.length)

        view.dispatch({
            changes: { from: line.from, to: line.to, insert: nextLine },
            selection: { anchor: line.from + nextCh },
        })
        view.focus()
        return true
    }

    function applyFixedHeadingLevel(view, level) {
        if (!Number.isInteger(level) || level < 1) return false

        const pos = view.state.selection.main.from
        const line = view.state.doc.lineAt(pos)
        const text = line.text
        const indentMatch = text.match(/^(\s*)(.*)$/)
        const indent = indentMatch ? indentMatch[1] : ''
        const content = indentMatch ? indentMatch[2] : text

        const headingMatch = content.match(/^#{1,}\s?(.*)$/)
        const body = headingMatch ? headingMatch[1] : content
        const nextLine = `${indent}${'#'.repeat(level)} ${body}`

        if (nextLine === text) return false

        const oldPrefixLen = headingMatch
            ? text.length - `${indent}${headingMatch[1]}`.length
            : indent.length
        const newPrefixLen = `${indent}${'#'.repeat(level)} `.length

        const oldCh = pos - line.from
        const nextCh = oldCh <= oldPrefixLen
            ? Math.min(oldCh, newPrefixLen)
            : Math.min(newPrefixLen + (oldCh - oldPrefixLen), nextLine.length)

        view.dispatch({
            changes: { from: line.from, to: line.to, insert: nextLine },
            selection: { anchor: line.from + nextCh },
        })
        view.focus()
        return true
    }

    // ─── Toolbar (CM6 ships no built-in UI, unlike EasyMDE) ────────────────────────

    function buildToolbarSeparator() {
        const sep = document.createElement('i')
        sep.className = 'separator'
        return sep
    }

    function buildToolbarButton({ label, title, onClick }) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.title = title
        btn.setAttribute('aria-label', title)
        btn.innerHTML = label
        // Keep focus (and its blur-triggered autosave) on the editor until the command runs.
        btn.addEventListener('mousedown', (event) => event.preventDefault())
        btn.addEventListener('click', () => { if (activeView) onClick(activeView) })
        return btn
    }

    function buildToolbar({ undo, redo }) {
        const toolbar = document.createElement('div')
        toolbar.className = 'editor-toolbar'

        const buttons = [
            buildToolbarButton({ label: '<b>B</b>', title: 'Bold (Cmd-B)', onClick: (v) => wrapSelectionWithMarker(v, '**') }),
            buildToolbarButton({ label: '<i>I</i>', title: 'Italic (Cmd-I)', onClick: (v) => wrapSelectionWithMarker(v, '*') }),
            buildToolbarSeparator(),
            buildToolbarButton({ label: 'H', title: 'Heading', onClick: (v) => applyFixedHeadingLevel(v, 2) }),
            buildToolbarButton({ label: '&bull;', title: 'Bullet list', onClick: (v) => insertLinePrefix(v, '- ') }),
            buildToolbarButton({ label: '&#9745;', title: 'Toggle checklist (Shift-Cmd-L)', onClick: (v) => applyChecklistCycleOnCurrentLine(v) }),
            buildToolbarSeparator(),
            buildToolbarButton({ label: '&#128279;', title: 'Insert link (Cmd-K)', onClick: (v) => insertMarkdownLinkCM6(v) }),
            buildToolbarButton({ label: '&#9638;', title: 'Insert table', onClick: (v) => insertTableScaffold(v) }),
            buildToolbarSeparator(),
            buildToolbarButton({ label: '&#8630;', title: 'Undo', onClick: (v) => undo(v) }),
            buildToolbarButton({ label: '&#8631;', title: 'Redo', onClick: (v) => redo(v) }),
        ]
        for (const button of buttons) toolbar.appendChild(button)
        return toolbar
    }

    // ─── CM6 mount ──────────────────────────────────────────────────────────────────

    async function initCM6(options) {
        const input = options?.input
        if (!input) return null
        if (input.dataset.cm6Bound === 'true') return activeView
        input.dataset.cm6Bound = 'true'

        const modules = await loadCM6Modules()
        if (activeView) return activeView // guard a second init racing in while modules loaded

        const {
            EditorView, keymap, minimalSetup, EditorState, markdown,
            undo, redo, historyKeymap,
        } = modules

        const toolbar = buildToolbar({ undo, redo })
        const host = document.createElement('div')
        host.className = 'note-cm6-editor'

        const container = document.createElement('div')
        container.className = 'note-cm6-editor-wrap'
        container.appendChild(toolbar)
        container.appendChild(host)

        input.hidden = true
        input.insertAdjacentElement('afterend', container)
        activeContainer = container

        // Real contenteditable surface (unlike EasyMDE/CM5's hidden-textarea sync trick) —
        // this is what actually lets native spellcheck/autocorrect/autocapitalize work.
        const nativeInputAttributes = EditorView.contentAttributes.of({
            spellcheck: 'true',
            autocorrect: 'on',
            autocapitalize: 'sentences',
        })

        const customKeymap = keymap.of([
            { key: 'Mod-b', run: (v) => wrapSelectionWithMarker(v, '**') },
            { key: 'Mod-i', run: (v) => wrapSelectionWithMarker(v, '*') },
            { key: 'Mod-k', run: (v) => insertMarkdownLinkCM6(v) },
            { key: 'Mod-Shift-l', run: (v) => applyChecklistCycleOnCurrentLine(v) },
            { key: 'Mod-Shift-h', run: (v) => applyFixedHeadingLevel(v, 2) },
            { key: 'Mod-Shift-t', run: (v) => applyFixedHeadingLevel(v, 1) },
            { key: 'Mod-Shift-c', run: (v) => wrapSelectionAsCode(v) },
            { key: 'Mod-Shift-i', run: (v) => insertMarkdownImageScaffold(v) },
            ...historyKeymap,
        ])

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged && typeof options?.onEditorInput === 'function') {
                options.onEditorInput()
            }
        })

        const domHandlers = EditorView.domEventHandlers({
            blur: () => {
                if (typeof options?.onEditorBlur === 'function') options.onEditorBlur()
            },
            paste: (event) => {
                if (typeof options?.onEditorPaste === 'function') options.onEditorPaste(event)
            },
        })

        activeView = new EditorView({
            state: EditorState.create({
                doc: input.value || '',
                extensions: [
                    minimalSetup,
                    EditorView.lineWrapping,
                    markdown(),
                    nativeInputAttributes,
                    customKeymap,
                    updateListener,
                    domHandlers,
                ],
            }),
            parent: host,
        })

        return activeView
    }

    function getShortcutRows() {
        return [
            { shortcut: 'Cmd + B', action: 'Bold' },
            { shortcut: 'Cmd + I', action: 'Italic' },
            { shortcut: 'Cmd + K', action: 'Insert Link' },
            { shortcut: 'Shift + Cmd + L', action: 'Task List' },
            { shortcut: 'Shift + Cmd + T', action: 'Title (#)' },
            { shortcut: 'Shift + Cmd + H', action: 'Heading (##)' },
            { shortcut: 'Shift + Cmd + K', action: 'Inline Code' },
        ]
    }

    function ensureHelpModalElements() {
        const existing = document.getElementById('note-shortcuts-modal')
        if (existing) return existing

        const rowsMarkup = getShortcutRows().map((row) => `
            <tr class="border-b border-border last:border-b-0">
                <td class="px-4 py-2.5 text-sm text-[#1a1a2e]">
                    <span class="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs">${row.shortcut}</span>
                </td>
                <td class="px-4 py-2.5 text-sm text-muted-fg">${row.action}</td>
            </tr>
        `).join('')

        const overlay = document.createElement('div')
        overlay.id = 'note-shortcuts-modal'
        overlay.hidden = true
        overlay.className = 'fixed inset-0 z-[70] bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4 hidden'
        overlay.innerHTML = `
            <div class="w-full max-w-md rounded-2xl border border-border bg-white shadow-xl overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="note-shortcuts-title">
                <div class="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                    <h3 id="note-shortcuts-title" class="text-base font-semibold text-[#1a1a2e]">Keyboard Shortcuts</h3>
                    <button id="btn-note-shortcuts-close" type="button" class="w-8 h-8 rounded-full border border-border hover:border-primary flex items-center justify-center text-[#1a1a2e]" aria-label="Close shortcuts modal">×</button>
                </div>
                <div class="max-h-[65vh] overflow-y-auto">
                    <table class="w-full border-collapse">
                        <thead>
                            <tr class="bg-muted/70 border-b border-border">
                                <th scope="col" class="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-fg">Shortcut</th>
                                <th scope="col" class="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-fg">Action</th>
                            </tr>
                        </thead>
                        <tbody>${rowsMarkup}</tbody>
                    </table>
                </div>
            </div>
        `

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                setHelpModalOpen(overlay, false)
            }
        })

        const closeBtn = overlay.querySelector('#btn-note-shortcuts-close')
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                setHelpModalOpen(overlay, false)
            })
        }

        document.body.appendChild(overlay)
        return overlay
    }

    function setHelpModalOpen(modal, isOpen) {
        if (!modal) return
        const open = Boolean(isOpen)
        modal.hidden = !open
        modal.classList.toggle('hidden', !open)
    }

    function ensureHelpButton() {
        const existing = document.getElementById('btn-note-shortcuts-help')
        if (existing) return existing

        const actionsContainer = document.getElementById('btn-note-menu')?.parentElement
        if (!actionsContainer) return null

        const helpBtn = document.createElement('button')
        helpBtn.id = 'btn-note-shortcuts-help'
        helpBtn.type = 'button'
        helpBtn.className = 'w-9 h-9 rounded-full border border-border hover:border-primary flex items-center justify-center text-sm font-semibold text-[#1a1a2e]'
        helpBtn.setAttribute('aria-label', 'Open keyboard shortcuts help')
        helpBtn.title = 'Keyboard shortcuts'
        helpBtn.textContent = '⌘'

        actionsContainer.insertBefore(helpBtn, document.getElementById('btn-note-menu'))
        return helpBtn
    }

    function wireHelpModal() {
        const helpBtn = ensureHelpButton()
        const modal = ensureHelpModalElements()
        if (!helpBtn || !modal) return

        const openHelpModal = () => {
            setHelpModalOpen(modal, true)
            const closeButton = modal.querySelector('#btn-note-shortcuts-close')
            if (closeButton) closeButton.focus()
        }

        helpBtn.addEventListener('click', openHelpModal)

        if (document.body.dataset.noteShortcutsEscBound !== 'true') {
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return
                const shortcutsModal = document.getElementById('note-shortcuts-modal')
                if (shortcutsModal && !shortcutsModal.hidden) {
                    setHelpModalOpen(shortcutsModal, false)
                }
            })
            document.body.dataset.noteShortcutsEscBound = 'true'
        }

        return { openHelpModal }
    }

    function getLineBounds(text, position) {
        const safePos = Math.max(0, Math.min(position, text.length))
        const lineStart = text.lastIndexOf('\n', safePos - 1) + 1
        let lineEnd = text.indexOf('\n', safePos)
        if (lineEnd === -1) lineEnd = text.length
        return { lineStart, lineEnd }
    }

    function toggleMarkdownTaskOnCurrentLine(textarea) {
        if (!textarea) return false

        const value = textarea.value || ''
        const selectionStart = textarea.selectionStart ?? 0
        const selectionEnd = textarea.selectionEnd ?? selectionStart
        const { lineStart, lineEnd } = getLineBounds(value, selectionStart)
        const line = value.slice(lineStart, lineEnd)

        const taskMatch = line.match(/^(\s*)-\s\[( |x|X)\](.*)$/)
        let nextLine = line
        let selectionDelta = 0

        if (taskMatch) {
            const nextState = taskMatch[2] === ' ' ? 'x' : ' '
            nextLine = `${taskMatch[1]}- [${nextState}]${taskMatch[3]}`
        } else {
            const indentMatch = line.match(/^(\s*)(.*)$/)
            const indent = indentMatch ? indentMatch[1] : ''
            const body = indentMatch ? indentMatch[2] : line
            const prefix = '- [ ] '
            nextLine = `${indent}${prefix}${body}`

            const adjust = (pos) => {
                if (pos < lineStart || pos > lineEnd) return pos
                const offset = pos - lineStart
                if (offset <= indent.length) return pos
                return pos + prefix.length
            }

            const nextSelectionStart = adjust(selectionStart)
            const nextSelectionEnd = adjust(selectionEnd)
            selectionDelta = 1

            const nextValue = `${value.slice(0, lineStart)}${nextLine}${value.slice(lineEnd)}`
            textarea.value = nextValue
            textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd)
            return true
        }

        if (selectionDelta === 0) {
            const nextValue = `${value.slice(0, lineStart)}${nextLine}${value.slice(lineEnd)}`
            textarea.value = nextValue
            const offsetStart = selectionStart - lineStart
            const offsetEnd = selectionEnd - lineStart
            const nextSelectionStart = lineStart + Math.min(Math.max(offsetStart, 0), nextLine.length)
            const nextSelectionEnd = lineStart + Math.min(Math.max(offsetEnd, 0), nextLine.length)
            textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd)
            return true
        }

        return false
    }

    function applyCurrentLineEdit(textarea, editLine) {
        if (!textarea) return false

        const value = textarea.value || ''
        const selectionStart = textarea.selectionStart ?? 0
        const selectionEnd = textarea.selectionEnd ?? selectionStart
        const { lineStart, lineEnd } = getLineBounds(value, selectionStart)
        const line = value.slice(lineStart, lineEnd)
        const startOffset = selectionStart - lineStart
        const endOffset = selectionEnd - lineStart

        const result = editLine(line, startOffset, endOffset)
        if (!result || typeof result.nextLine !== 'string' || result.nextLine === line) return false

        const nextValue = `${value.slice(0, lineStart)}${result.nextLine}${value.slice(lineEnd)}`
        textarea.value = nextValue

        const mapOffset = typeof result.mapOffset === 'function'
            ? result.mapOffset
            : (offset) => offset

        const nextStart = lineStart + Math.min(Math.max(mapOffset(startOffset), 0), result.nextLine.length)
        const nextEnd = lineStart + Math.min(Math.max(mapOffset(endOffset), 0), result.nextLine.length)
        textarea.setSelectionRange(nextStart, nextEnd)
        return true
    }

    function toggleMarkdownHeadingOnCurrentLine(textarea) {
        return applyCurrentLineEdit(textarea, (line) => {
            const addMatch = line.match(/^(\s*)(.*)$/)
            const indent = addMatch ? addMatch[1] : ''
            const body = addMatch ? addMatch[2] : line

            const removeMatch = line.match(/^(\s*)##\s?(.*)$/)
            if (removeMatch) {
                const removeLen = line.length - `${removeMatch[1]}${removeMatch[2]}`.length
                return {
                    nextLine: `${removeMatch[1]}${removeMatch[2]}`,
                    mapOffset: (offset) => {
                        if (offset <= removeMatch[1].length) return offset
                        return Math.max(removeMatch[1].length, offset - removeLen)
                    },
                }
            }

            const prefix = '## '
            return {
                nextLine: `${indent}${prefix}${body}`,
                mapOffset: (offset) => {
                    if (offset <= indent.length) return offset
                    return offset + prefix.length
                },
            }
        })
    }

    function ensureSingleMarkdownHeadingOnCurrentLine(textarea) {
        return applyCurrentLineEdit(textarea, (line) => {
            const indentMatch = line.match(/^(\s*)(.*)$/)
            const indent = indentMatch ? indentMatch[1] : ''

            const headingMatch = line.match(/^(\s*)#{1,}\s?(.*)$/)
            if (headingMatch) {
                const nextLine = `${headingMatch[1]}${headingMatch[2]}`
                const oldPrefixLen = line.length - nextLine.length
                return {
                    nextLine,
                    mapOffset: (offset) => {
                        if (offset <= headingMatch[1].length) return offset
                        return Math.max(headingMatch[1].length, offset - oldPrefixLen)
                    },
                }
            }

            const body = indentMatch ? indentMatch[2] : line
            const nextLine = `${indent}# ${body}`
            const newPrefixLen = `${indent}# `.length
            return {
                nextLine,
                mapOffset: (offset) => {
                    if (offset <= indent.length) return offset
                    return Math.min(offset + 2, nextLine.length)
                },
            }
        })
    }

    function toggleMarkdownWrap(textarea, marker) {
        if (!textarea || !marker) return false

        const value = textarea.value || ''
        const selectionStart = textarea.selectionStart ?? 0
        const selectionEnd = textarea.selectionEnd ?? selectionStart
        const markerLen = marker.length

        if (selectionStart === selectionEnd) {
            const insert = `${marker}${marker}`
            textarea.value = `${value.slice(0, selectionStart)}${insert}${value.slice(selectionEnd)}`
            const caret = selectionStart + markerLen
            textarea.setSelectionRange(caret, caret)
            return true
        }

        const selected = value.slice(selectionStart, selectionEnd)
        if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= markerLen * 2) {
            const unwrapped = selected.slice(markerLen, selected.length - markerLen)
            textarea.value = `${value.slice(0, selectionStart)}${unwrapped}${value.slice(selectionEnd)}`
            textarea.setSelectionRange(selectionStart, selectionStart + unwrapped.length)
            return true
        }

        const hasOuterMarker =
            value.slice(selectionStart - markerLen, selectionStart) === marker
            && value.slice(selectionEnd, selectionEnd + markerLen) === marker

        if (hasOuterMarker) {
            const outerStart = selectionStart - markerLen
            const outerEnd = selectionEnd + markerLen
            const unwrapped = value.slice(selectionStart, selectionEnd)
            textarea.value = `${value.slice(0, outerStart)}${unwrapped}${value.slice(outerEnd)}`
            textarea.setSelectionRange(outerStart, outerStart + unwrapped.length)
            return true
        }

        const wrapped = `${marker}${selected}${marker}`
        textarea.value = `${value.slice(0, selectionStart)}${wrapped}${value.slice(selectionEnd)}`
        textarea.setSelectionRange(selectionStart + markerLen, selectionStart + markerLen + selected.length)
        return true
    }

    function insertMarkdownLink(textarea) {
        if (!textarea) return false

        const value = textarea.value || ''
        const selectionStart = textarea.selectionStart ?? 0
        const selectionEnd = textarea.selectionEnd ?? selectionStart
        const selected = value.slice(selectionStart, selectionEnd)
        const title = selected || 'title'
        const linkText = `[${title}](url)`

        textarea.value = `${value.slice(0, selectionStart)}${linkText}${value.slice(selectionEnd)}`

        const urlStart = selectionStart + linkText.length - 4
        const urlEnd = selectionStart + linkText.length - 1
        textarea.setSelectionRange(urlStart, urlEnd)
        return true
    }

    function isShortcutEnabled(state) {
        return state.activePage === 'note-editor' && state.editingNote && !state.notePreviewOpen
    }

    function initNotesEditorShortcuts(options) {
        const state = options?.state
        const input = options?.input

        if (!state || !input) return
        if (input.dataset.notesShortcutsBound === 'true') return

        const helpModalApi = wireHelpModal()
        initCM6({
            input,
            titleInput: options?.titleInput,
            onEditorPaste: options?.onEditorPaste,
            onEditorInput: options?.onEditorInput,
            onEditorBlur: options?.onEditorBlur,
        }).catch((err) => {
            console.error('Failed to load CodeMirror 6 editor', err)
        })

        const enableCustomShortcuts = options?.enableCustomShortcuts === true
        if (!enableCustomShortcuts) {
            input.dataset.notesShortcutsBound = 'true'
            return
        }

        input.addEventListener('keydown', (event) => {
            if (event.isComposing) return
            const key = String(event.key || '').toLowerCase()
            const isCmdOnly = event.metaKey && !event.ctrlKey && !event.altKey
            if (!isCmdOnly) return
            if (!isShortcutEnabled(state)) return

            let changed = false

            if (event.shiftKey) {
                if (key === '?') {
                    event.preventDefault()
                    helpModalApi?.openHelpModal?.()
                    return
                }
                if (key === 'l') changed = toggleMarkdownTaskOnCurrentLine(input)
                else if (key === 't') changed = ensureSingleMarkdownHeadingOnCurrentLine(input)
                else if (key === 'h') changed = toggleMarkdownHeadingOnCurrentLine(input)
                else if (key === 'b') changed = toggleMarkdownWrap(input, '**')
                else if (key === 'i') changed = toggleMarkdownWrap(input, '*')
                else if (key === 'k') changed = toggleMarkdownWrap(input, '`')
            } else {
                if (key === 'b') changed = toggleMarkdownWrap(input, '**')
                else if (key === 'i') changed = toggleMarkdownWrap(input, '*')
                else if (key === 'k') changed = insertMarkdownLink(input)
            }

            if (!changed) return

            event.preventDefault()
            input.dispatchEvent(new Event('input', { bubbles: true }))
        })

        input.dataset.notesShortcutsBound = 'true'
    }

    globalScope.D11NotesEditorShortcuts = {
        init: initNotesEditorShortcuts,
        getValue: getEditorValue,
        setValue: setEditorValue,
        setEditorVisible,
        refresh: refreshEditorLayout,
        focus: focusEditor,
        getCursor: getEditorCursorState,
        insertAtCursor: insertTextAtCursor,
        getInstance: () => activeView,
    }
})(window)
