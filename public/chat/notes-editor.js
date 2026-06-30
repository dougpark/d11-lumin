// public/chat/notes-editor.js
// Notes editor enhancements that can evolve independently from chat.html.
(function attachNotesEditorShortcuts(globalScope) {
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

    function initNotesEditorShortcuts(options) {
        const state = options?.state
        const input = options?.input

        if (!state || !input) return
        if (input.dataset.notesShortcutsBound === 'true') return

        input.addEventListener('keydown', (event) => {
            const key = String(event.key || '').toLowerCase()
            const isCmdL = event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && key === 'l'
            if (!isCmdL) return

            if (state.activePage !== 'note-editor' || !state.editingNote || state.notePreviewOpen) return

            event.preventDefault()
            const changed = toggleMarkdownTaskOnCurrentLine(input)
            if (!changed) return

            input.dispatchEvent(new Event('input', { bubbles: true }))
        })

        input.dataset.notesShortcutsBound = 'true'
    }

    globalScope.D11NotesEditorShortcuts = {
        init: initNotesEditorShortcuts,
    }
})(window)
