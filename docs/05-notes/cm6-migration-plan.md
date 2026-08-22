# EasyMDE (CM5) → CodeMirror 6 Migration Plan

Phase 0 spike (`public/notes/cm6-spike.html`) passed on real devices — see
`/memories/repo/cm6-migration-phase0-results.md`. CM6's real `contenteditable`
surface gives native spellcheck/autocorrect on desktop + mobile, which
EasyMDE's CM5 hidden-textarea proxy never could. This doc plans the cutover
of the production notes editor.

## Key architectural decision

`notes.html` never talks to EasyMDE directly — it only calls the adapter at
`window.D11NotesEditorShortcuts` (defined in `public/notes/notes-editor.js`):
`init`, `getValue`, `setValue`, `setEditorVisible`, `refresh`, `focus`,
`getCursor`, `insertAtCursor`, `getInstance`.

**Plan: keep that adapter's public API 100% identical, and only rewrite its
internals to drive a CM6 `EditorView` instead of an EasyMDE instance.** If
done right, `src/client/notes.html` needs zero or near-zero changes —
all the risk is contained inside `notes-editor.js` + the CSS block that
skins the editor chrome.

## Vendoring (no CDN at runtime, no bundler — matches project convention)

Unlike the throwaway spike (which pulled from esm.sh at runtime), the
production app self-hosts vendor JS/CSS under `public/vendor/`
(`easymde.min.js`, `marked.min.js`, etc.) with no build step. Do the same
for CM6:

1. Fetch a single bundled ESM file via esm.sh's `?bundle` param, e.g.
   `https://esm.sh/codemirror@6.0.2?bundle` plus the markdown/commands
   packages bundled together (a small wrapper module can re-export exactly
   what's needed so only one file needs vendoring).
2. **Pin exact versions** — `codemirror@6.65.x`/`@6` bare ranges resolve to
   a mis-tagged CM5 republish (see `/memories/cdn-package-gotchas.md`).
   Use `codemirror@6.0.2`, `@codemirror/lang-markdown@6`,
   `@codemirror/commands@6`, `@codemirror/state@6`, `@codemirror/language@6`
   (for `HighlightStyle`/`syntaxHighlighting`), `@lezer/highlight@1`.
3. Save the fetched bundle to `public/vendor/codemirror6.bundle.js`, verify
   its exports via the same live-browser `Object.keys()` check used in
   Phase 0 before trusting it.
4. Load it as an ES module (`<script type="module">` or `import` inside
   `notes-editor.js` once that file is converted to a module — check whether
   any inline `<script>` in `notes.html` currently relies on
   `notes-editor.js` executing as a classic script before doing this).

## Work breakdown

### 1. Adapter rewrite (`notes-editor.js`)
- [ ] Replace `initEasyMDE` with `initCM6` — construct one `EditorView` per
      page load (reused across notes), with `basicSetup`-equivalent minimal
      extensions, `markdown()` language support, `history()` +
      `historyKeymap` (CM6 doesn't bundle undo like CM5 did), and the
      `nativeInputAttributes` facet proven in the spike
      (`spellcheck/autocorrect/autocapitalize`).
- [ ] Switching notes: reuse the single `EditorView`; swap content via a
      full-document replace transaction (`view.dispatch({changes: {from: 0,
      to: view.state.doc.length, insert: nextValue}})`) — mirrors current
      `easyMDE.value(nextValue)` swap-on-note-open behavior.
- [ ] `getValue`/`setValue` → `view.state.doc.toString()` /
      dispatch-replace. Keep the `fallbackInput` param for the "editor not
      yet mounted" case, same as today.
- [ ] `getCursor`/`insertAtCursor` → `view.state.selection.main.{from,to}`
      and `view.dispatch({changes: {from, to, insert: text}, selection:
      {anchor: from + text.length}})`. This directly feeds the attachment
      upload flow's cursor-preserving insert (`uploadNoteAttachment` in
      `notes.html`) — must keep return shape identical.
- [ ] `setEditorVisible` → toggle a `hidden`/`.hidden` class on the CM6 host
      element + custom toolbar container (same pattern as today, just a
      different container to query).
- [ ] `focus`/`refresh` → `view.focus()` / no-op or `view.requestMeasure()`
      (CM6 doesn't need CM5's manual `.refresh()` re-layout call, but keep
      the function as a harmless no-op so callers don't need updates).
- [ ] `change` event → `EditorView.updateListener.of(update => { if
      (update.docChanged) options.onEditorInput?.() })`.
- [ ] `blur` event → `EditorView.domEventHandlers({ blur: () =>
      options.onEditorBlur?.() })` (drives the existing blur-autosave in
      `notes.html`).
- [ ] `paste` event → same `domEventHandlers({ paste: ... })`, replacing the
      current `cm.getInputField().addEventListener('paste', ...)` — feeds
      `handleNoteEditorPaste` unchanged.

### 2. Custom toolbar (CM6 has no built-in toolbar UI)
- [ ] Rebuild the toolbar DOM (reuse `cm6-spike.html`'s button set as a
      starting point: Bold, Italic, Heading, List, Checklist, Undo, Redo)
      plus the two EasyMDE toolbar items not yet prototyped: **Link**
      (insert `[title](url)` scaffold at selection) and **Table** (confirm
      whether this button is actually used before porting it — if so, insert
      a markdown table scaffold the same way EasyMDE's table plugin does).
- [ ] Reuse the existing `.editor-toolbar` CSS class names/DOM structure
      where possible to minimize the CSS rewrite in step 4.
- [ ] Port `applyChecklistCycleOnCurrentLine` and `applyFixedHeadingLevel`
      (currently operate on a CM5 `Doc`) to CM6 transactions (line lookup
      via `view.state.doc.lineAt(pos)`, replace via `view.dispatch`).
- [ ] Wire keyboard shortcuts via CM6 `keymap.of([...])` instead of CM5's
      `cm.addKeyMap`: `Cmd-B`/`Cmd-I`/`Cmd-K` (bold/italic/link),
      `Shift-Cmd-L` (checklist cycle), `Shift-Cmd-H` (heading), `Shift-Cmd-T`
      (title `#`), `Shift-Cmd-C` (code block, currently mapped to
      `toggleCodeBlock`). Drop or reimplement `Cmd-Shift-I` (`drawImage`) —
      confirm it's actually wired to anything today before porting.
      Retire the parallel `enableCustomShortcuts` textarea-based shortcut
      path in `notes-editor.js` (`toggleMarkdownWrap`,
      `toggleMarkdownTaskOnCurrentLine`, etc.) — those manipulate a real
      `<textarea>` and don't apply to a contenteditable; it's currently
      unused anyway (`enableCustomShortcuts: false` in `notes.html`).
- [ ] Toolbar buttons must `preventDefault` on `mousedown` so clicking them
      doesn't blur the editor before the command runs (standard CM6/EasyMDE
      gotcha) — confirmed needed since blur triggers autosave.

### 3. CSS rewrite (`src/client/notes.html`, ~lines 795–1020)
- [ ] Replace `.EasyMDEContainer` / `.CodeMirror*` selectors with CM6
      equivalents: `.cm-editor`, `.cm-content`, `.cm-line`, `.cm-scroller`,
      `.cm-focused`, `.cm-gutters` (if a gutter is ever added — not planned).
- [ ] Replace CM5 mode-token classes (`.cm-header`, `.cm-strong`, `.cm-em`,
      `.cm-link`, `.cm-url`, `.cm-quote`, `.cm-comment`, `.cm-tag`,
      `.cm-attribute`, `.cm-string`) with a CM6 `HighlightStyle` built via
      `@codemirror/language`'s `syntaxHighlighting()` + `@lezer/highlight`
      tags, mapped to either `classHighlighter` (stable class names you
      style in CSS, closest to current approach) or an inline `HighlightStyle`
      (no CSS classes needed, styles are inlined via CM6 theme). Prefer
      `classHighlighter` to keep the existing CSS-based theming pattern.
- [ ] Re-verify the preview-mode hide/show CSS (editor container margin
      collapse noted in the existing CSS comment) still holds with CM6's DOM
      shape.

### 4. Cleanup
- [ ] Remove `/vendor/easymde.min.css` + `/vendor/easymde.min.js` `<link>`/
      `<script>` tags from `notes.html` once cutover is verified.
- [ ] Keep `marked.min.js` (preview pane) and `font-awesome.min.css`
      (confirm still needed for other icons before removing) — both are
      independent of the editor engine.
- [ ] Delete or clearly mark `public/notes/cm6-spike.html` as historical
      once the real integration lands (it's not linked from the app either
      way).

### 5. Manual QA (real devices only — VS Code's built-in browser gave false
   negatives during Phase 0, see repo memory)
- [ ] iPhone Safari + desktop Safari: typing, spellcheck, autocapitalize.
- [ ] All toolbar buttons + all keyboard shortcuts.
- [ ] Checklist cycling, heading shortcuts.
- [ ] Paste-image upload with cursor-preserving insert mid-document.
- [ ] Preview toggle (edit ⇄ preview, including the "hydrating" loading
      state on note switch).
- [ ] Word/character count.
- [ ] Blur-triggered autosave (including via toolbar button clicks — must
      NOT fire spuriously).
- [ ] Undo/redo.
- [ ] Switching between notes repeatedly (single reused `EditorView`) —
      check for stale selection/content bleed-through.

## Rollback

No build step, no feature flag needed — this is a single reviewable commit
(`notes-editor.js` internals + the CSS block + `notes.html` `<link>`/
`<script>` tags). Revert is trivial if real-device QA turns up a blocker.
