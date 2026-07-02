# Floating Text Overlay

A lightweight Obsidian plugin that lets you create draggable floating notes anywhere on your document without modifying the original Markdown content.

![GitHub release](https://img.shields.io/github/v/release/liaoqiuyi681-blip/floating-text-overlay)
![License](https://img.shields.io/github/license/liaoqiuyi681-blip/floating-text-overlay)

---
## Why Floating Text Overlay?

Traditional Markdown notes are linear.

Sometimes you need annotations that behave like sticky notes without interrupting the document flow.

Floating Text Overlay allows you to:

- Keep your document clean.
- Place notes exactly where you need them.
- Link annotations to specific text.
- Hide notes while preserving their context.
---
## Features

### ✨ Floating editable notes

Create floating note widgets anywhere in the current note.

- Drag freely
- Resize freely
- Edit directly
- Markdown preview
<img width="480" height="358" alt="animation_edited" src="https://github.com/user-attachments/assets/5adcc97c-3e5d-4da2-a801-41992fd5e8e9" />

The floating notes are independent from the original Markdown content, so moving a note never changes your document layout.

---

### 🔗 Link notes to text

Associate a floating note with any selected text.

- Create a linked note directly from a text selection
- Highlight linked text
- Ctrl (Cmd on macOS) + Click linked text to show or hide its note
- Linked notes remain synchronized when the document is edited

---

### 🎨 Custom appearance

Each floating note supports:

- Background color
- Transparency
- Independent size
- Independent position

Settings are available from the context menu.

---

### 👀 Minimal interface

The title bar and toolbar are hidden by default.

They only appear when the mouse hovers over the note, providing a clean reading experience.

---

### 📝 Markdown support

Each floating note supports Markdown editing and preview.

Examples:

```markdown
# Heading

**Bold**

*Italic*

- List

> Quote

`Code`
```

---

## Screenshots

### Floating Notes

> *(Insert screenshot here)*

### Linked Text

> *(Insert screenshot here)*

### Context Menu

> *(Insert screenshot here)*

---

## Installation

### Community Plugins (Coming Soon)

Open

Settings → Community Plugins → Browse

Search:

```
Floating Text Overlay
```

Click **Install**.

---

### Manual Installation

Download the latest release from:

https://github.com/liaoqiuyi681-blip/floating-text-overlay/releases

Copy the following files into:

```
Vault/.obsidian/plugins/floating-text-overlay/
```

```
main.js
manifest.json
styles.css
```

Enable the plugin from

```
Settings
→ Community Plugins
```

---

## Usage

### Create a floating note

Click the toolbar icon.

---

### Link a note

1. Select text.
2. Create a floating note.
3. The note is automatically linked.

Or:

- Right-click an existing note.
- Choose **Link Current Selection**.

---

### Edit appearance

Right-click a note.

You can change:

- Background color
- Transparency

---

### Resize

Drag the resize handle in the bottom-right corner.

---

### Move

Drag the title area of the note.

---

## Roadmap

- [ ] Full CodeMirror editor support
- [ ] Better Editing Toolbar integration
- [ ] Canvas support
- [ ] Excalidraw integration
- [ ] Mobile optimization
- [ ] Export floating notes

---
## Feature Comparison

| Feature                 | Floating Text Overlay | Callout | Comments |
| ----------------------- | --------------------- | ------- | -------- |
| Floating notes          | ✅                     | ❌       | ❌        |
| Link to text            | ✅                     | ❌       | ⚠️       |
| Independent position    | ✅                     | ❌       | ❌        |
| Draggable               | ✅                     | ❌       | ❌        |
| Resizable               | ✅                     | ❌       | ❌        |
| Adjustable transparency | ✅                     | ❌       | ❌        |

---
## Compatibility

Tested with

- Obsidian 1.8+
- Windows

macOS and Linux support is planned.

---

## Known Limitations

The plugin is currently under active development.

Some advanced editor integrations are still being improved.

---

## Contributing

Issues and Pull Requests are welcome.

If you find a bug or have a feature request, please open an issue on GitHub.

---

## License

MIT License

Copyright (c) 2026 Qiuyi Liao
