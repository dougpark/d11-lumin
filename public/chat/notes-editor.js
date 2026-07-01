// public/chat/notes-editor.js
// Notes editor enhancements that can evolve independently from chat.html.
(function attachNotesEditorShortcuts(globalScope) {
    let activeEasyMDE = null

    function getEasyMDEContainer() {
        if (!activeEasyMDE?.codemirror) return null
        return activeEasyMDE.codemirror.getWrapperElement()?.closest('.EasyMDEContainer') || null
    }

    function getEditorValue(fallbackInput) {
        if (activeEasyMDE && typeof activeEasyMDE.value === 'function') {
            return activeEasyMDE.value()
        }
        return fallbackInput?.value || ''
    }

    function setEditorValue(nextValue, fallbackInput) {
        const value = String(nextValue ?? '')
        if (activeEasyMDE && typeof activeEasyMDE.value === 'function') {
            activeEasyMDE.value(value)
            if (fallbackInput && fallbackInput.value !== value) {
                fallbackInput.value = value
            }
            return
        }
        if (fallbackInput) {
            fallbackInput.value = value
        }
    }

    function setEditorVisible(isVisible, fallbackInput) {
        const visible = Boolean(isVisible)
        if (fallbackInput) {
            fallbackInput.hidden = !visible
        }
        const container = getEasyMDEContainer()
        if (container) {
            container.classList.toggle('hidden', !visible)
        }
    }

    function initEasyMDE(options) {
        const input = options?.input
        if (!input) return null
        if (input.dataset.easyMdeBound === 'true' && activeEasyMDE) return activeEasyMDE
        if (typeof globalScope.EasyMDE !== 'function') return null

        const easyMDE = new globalScope.EasyMDE({
            element: input,
            forceSync: true,
            toolbar: [
                'bold',
                'italic',
                'heading',
                '|',
                'unordered-list',
                '|',
                'link',
                'table',
                '|',
                'preview',
                'side-by-side',
                'fullscreen',
            ],
            status: false,
            spellChecker: false,
            autoDownloadFontAwesome: true,
            shortcuts: {
                toggleHeadingBigger: null,
            },
        })

        activeEasyMDE = easyMDE
        input.dataset.easyMdeBound = 'true'

        const cm = easyMDE.codemirror
        if (cm) {
            cm.addKeyMap({
                'Shift-Cmd-H': (instance) => {
                    applyFixedHeadingLevel(instance, 2)
                },
                'Shift-Ctrl-H': (instance) => {
                    applyFixedHeadingLevel(instance, 2)
                },
            })

            cm.on('change', () => {
                if (typeof options?.onEditorInput === 'function') {
                    options.onEditorInput()
                }
            })

            cm.on('blur', () => {
                if (typeof options?.onEditorBlur === 'function') {
                    options.onEditorBlur()
                }
            })

            const cmInput = cm.getInputField?.()
            if (cmInput && typeof options?.onEditorPaste === 'function') {
                cmInput.addEventListener('paste', (event) => {
                    options.onEditorPaste(event)
                })
            }
        }

        return easyMDE
    }

    function applyFixedHeadingLevel(cm, level) {
        if (!cm || !Number.isInteger(level) || level < 1) return

        const doc = cm.getDoc()
        const start = doc.getCursor('start')
        const lineNo = start.line
        const line = doc.getLine(lineNo) || ''
        const indentMatch = line.match(/^(\s*)(.*)$/)
        const indent = indentMatch ? indentMatch[1] : ''
        const content = indentMatch ? indentMatch[2] : line

        const headingMatch = content.match(/^#{1,}\s?(.*)$/)
        const body = headingMatch ? headingMatch[1] : content
        const nextLine = `${indent}${'#'.repeat(level)} ${body}`

        if (nextLine === line) return

        const oldPrefixLen = headingMatch
            ? line.length - `${indent}${headingMatch[1]}`.length
            : indent.length
        const newPrefixLen = `${indent}${'#'.repeat(level)} `.length

        doc.replaceRange(nextLine, { line: lineNo, ch: 0 }, { line: lineNo, ch: line.length })

        const oldCh = start.ch
        const nextCh = oldCh <= oldPrefixLen
            ? Math.min(oldCh, newPrefixLen)
            : Math.min(newPrefixLen + (oldCh - oldPrefixLen), nextLine.length)

        doc.setCursor({ line: lineNo, ch: nextCh })
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
        initEasyMDE({
            input,
            onEditorPaste: options?.onEditorPaste,
            onEditorInput: options?.onEditorInput,
            onEditorBlur: options?.onEditorBlur,
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
        getInstance: () => activeEasyMDE,
    }
})(window)
