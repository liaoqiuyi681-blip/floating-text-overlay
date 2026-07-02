
A lightweight Obsidian plugin that lets you create draggable floating notes anywhere on your document without modifying the original Markdown content.

![GitHub release|93](https://img.shields.io/github/v/release/liaoqiuyi681-blip/floating-text-overlay)
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
<center><img width="480" height="358" alt="animation_edited" src="https://github.com/user-attachments/assets/5adcc97c-3e5d-4da2-a801-41992fd5e8e9" /></center>

The floating notes are independent from the original Markdown content, so moving a note never changes your document layout.

---

### 🔗 Link notes to text

Associate a floating note with any selected text.

- Create a linked note directly from a text selection
- Highlight linked text
- Ctrl (Cmd on macOS) + Click linked text to show or hide its note
- Linked notes remain synchronized when the document is edited
<img width="507" height="199" alt="image" src="https://github.com/user-attachments/assets/1646b956-50b8-4b7c-8865-f601d55070db" />
<img width="414" height="337" alt="image" src="https://github.com/user-attachments/assets/2a22b168-e20e-4ab1-8c23-6e601bac1005" />


---

### 🎨 Custom appearance

Each floating note supports:

- Background color
- Transparency
- Independent size
- Independent position

Settings are available from the context menu.
<center><img width="237" height="184" alt="image" src="https://github.com/user-attachments/assets/e58d0e7e-24cf-4204-a1a1-1c35c31ad0ad" /> <img width="210" height="295" alt="image" src="https://github.com/user-attachments/assets/0995ff36-c616-4d29-bea6-69675fac896c" /></center>

---

### 👀 Minimal interface

The title bar and toolbar are hidden by default.

They only appear when the mouse hovers over the note, providing a clean reading experience.

<center><img width="199" height="197" alt="image" src="https://github.com/user-attachments/assets/62a6d16a-fd06-4ef6-a593-c13baacca563" /> <img width="199" height="197" alt="image" src="https://github.com/user-attachments/assets/0704d134-013b-4041-88b7-3cfe9cc00583" /></center>


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
