# Floating Text Overlay

An Obsidian desktop plugin that adds movable, resizable, editable Markdown text labels above a note without changing the note's Markdown body.

> Status: early prototype / v0.6.0.

## v0.6.0 changes

- **No creation-time recovery store.** A new label remains a transient draft until the user edits, moves, resizes, styles, previews, or explicitly links it.
- **Immediate deletion.** The header delete button, context-menu delete action, and remove-all command now delete without a confirmation dialog.
- **White default surface.** New labels start with a white background; alternate background colours and transparency remain available from the right-click options.
- **Direct colour-command bridge.** Editing Toolbar's callback-only `change-font-color` and `change-background-color` commands are intercepted while a label is focused. The plugin reads the chosen Editing Toolbar settings and writes the same `<font color="…">…</font>` and `<mark style="background:…">…</mark>` markup into the label.
- **Editing Toolbar command interception.** While a label editor is focused, the plugin redirects `editing-toolbar:*` and standard `editor:*` formatting commands to that label. The bridge handles the regular Editing Toolbar buttons directly—bold, italics, strikethrough, underline, highlight, inline code, headings, block quotes, bullet lists, numbered lists, checklists, clear formatting, undo, and redo—and passes compatible editor callbacks a textarea-backed Editor adapter.
- **Scoped compatibility bridge.** The temporary `workspace.activeEditor` proxy exists only while a label is focused, then the native Obsidian editor state is restored. This avoids keeping a global editor override active after the user returns to a note.

## Features

- Add a floating text label from the ribbon icon or Command palette.
- Edit text directly inside the label. An empty label shows `Type here…`, which disappears as soon as the editor receives focus.
- Drag a label using the header that appears only when the pointer is over the label.
- Resize a label by dragging its visible lower-right resize marker.
- Keep the header and Markdown preview controls hidden until the pointer is over the label or the label editor has focus. When shown, they occupy dedicated layout rows and do not cover the first or last text lines.
- Right-click a label to change its background color and transparency with live preview.
- Select Markdown text and then add a label to automatically link the label to that text.
- Select Markdown text, right-click an existing label, and choose **Link current selection** to create or replace the link.
- Right-click an already linked label to locate the linked text or remove the link.
- Highlight linked source text in Live Preview / Source mode without changing the note body.
- Ctrl+click on highlighted linked text to toggle its associated label between open and closed. On macOS, use Cmd+click.
- A newly created empty label is a transient draft. It is saved only after you type, move, resize, change appearance, preview it, or explicitly link it.
- Deletion is immediate and permanent; no confirmation dialog or recovery copy is kept.
- Store label content, size, position, appearance, and links in plugin data instead of changing the Markdown file.

## Editing Toolbar usage

1. Click inside a floating label and select the text to format.
2. Keep the label focused.
3. Click an Editing Toolbar command, for example Bold, Italic, Heading, Highlight, Font color, List, Link, Code, Undo, or Redo.
4. The resulting Markdown is written into the label, not into the note body.
5. Use **Preview Markdown** in the label to inspect the rendered result.

The bridge is scoped to the label that currently has focus. It temporarily exposes the label as the active editor and restores Obsidian's native editor as soon as focus leaves the label.

## Link behavior

A link stores the selected text, source offsets, occurrence index, and surrounding context. While a note is open, its source range is mapped through every CodeMirror document change. When a note is reopened, the plugin first checks the updated offsets, then nearby stored context, then the saved text occurrence. This makes ordinary wording changes resilient while still avoiding modifications to the Markdown file itself.

Links work from Obsidian's Markdown editor. Select the text in Live Preview or Source mode before adding or linking a label.

## Local installation for testing

1. Build the plugin with `npm install` followed by `npm run build`.
2. Create this folder in a test vault:
   ```text
   <your-vault>/.obsidian/plugins/floating-text-overlay/
   ```
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. In Obsidian, enable **Community plugins**, then enable **Floating Text Overlay**.

## Development

```bash
npm install
npm run dev
```

For development, place this repository directly at:

```text
<your-test-vault>/.obsidian/plugins/floating-text-overlay/
```

Reload Obsidian after code changes.

## Release assets

Every GitHub release must include these files as release attachments:

- `main.js`
- `manifest.json`
- `styles.css`

The GitHub release tag must exactly match the version in `manifest.json`, such as `0.6.0`.

## License

MIT.
