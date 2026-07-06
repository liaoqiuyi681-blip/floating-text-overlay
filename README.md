<p align="center">
  <img width="128" height="128" alt="brand" src="https://github.com/user-attachments/assets/8bf4e43f-fad2-4224-b640-f78b659eb4ca" />

</p>

<h1 align="center">Floating Text Overlay</h1>

<p align="center">
  Movable, resizable Markdown annotations that remain attached to the part of an Obsidian note where they matter.
</p>

<p align="center">
  <a href="https://github.com/liaoqiuyi681-blip/floating-text-overlay/releases">
</a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/liaoqiuyi681-blip/floating-text-overlay?color=7C3AED" alt="MIT license"></a>
  <a href="https://github.com/liaoqiuyi681-blip/floating-text-overlay/issues"><img src="https://img.shields.io/github/issues/liaoqiuyi681-blip/floating-text-overlay?color=7C3AED" alt="Open issues"></a>
  <img src="https://img.shields.io/badge/Obsidian-Desktop-7C3AED?logo=obsidian&logoColor=white" alt="Obsidian desktop">
</p>

<p align="center">
 <img width="1983" height="793" alt="0" src="https://github.com/user-attachments/assets/ff4235ed-2ef2-4351-8e88-47ed2b41c23c" />

</p>

> [!NOTE]
> **v0.7.0 introduces document-positioned labels with scroll synchronisation.** A label now moves with the note content instead of remaining fixed in the reading viewport.

<!-- TOC:start -->
<details>
<summary><strong>Table of contents</strong></summary>

- [Why this plugin](#why-this-plugin)
- [Feature set](#feature-set)
- [Interface preview](#interface-preview)
- [Scroll synchronisation](#scroll-synchronisation)
- [Installation](#installation)
  - [Manual installation — current release path](#manual-installation-current-release-path)
  - [Community Plugins — pending submission](#community-plugins-pending-submission)
- [Usage](#usage)
  - [Create a label](#create-a-label)
  - [Link a label to source text](#link-a-label-to-source-text)
  - [Move and resize](#move-and-resize)
  - [Change appearance](#change-appearance)
  - [Preview Markdown](#preview-markdown)
- [Editing Toolbar compatibility](#editing-toolbar-compatibility)
- [Storage model](#storage-model)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Run locally](#run-locally)
  - [Build a release](#build-a-release)
- [Testing](#testing)
- [Repository assets](#repository-assets)
- [Contributing](#contributing)
- [License](#license)

</details>
<!-- TOC:end -->

## Why this plugin

Markdown notes are inherently linear. Research, revision, planning, and review work often require short contextual annotations that should sit beside an idea without interrupting the original document flow.

Floating Text Overlay adds editable note widgets above a Markdown note. A widget can be moved, resized, linked to selected text, hidden and reopened from that text, and styled independently. The original Markdown file remains untouched.

## Feature set

| Capability | What it does |
| --- | --- |
| Floating labels | Add an editable annotation anywhere over the current note. |
| Document-positioned scrolling | Labels use document-space coordinates and move with the page when you scroll. |
| Text links | Select source text, create a label, and retain an interactive link between the two. |
| Context toggle | `Ctrl` + click linked text on Windows/Linux, or `Cmd` + click on macOS, to show or hide associated labels. |
| Flexible layout | Drag with the header and resize from the lower-right handle. |
| Minimal interface | Controls stay hidden until the label is hovered or focused. |
| Appearance controls | Set a label background colour and transparency from the right-click menu. |
| Markdown preview | Switch a label between Markdown source and a rendered preview. |
| Safe note body | Label content and geometry are stored in plugin data, not inserted into the Markdown file. |

## Interface preview

These editable SVG previews establish the intended dark-theme visual language. Before submitting to Obsidian Community Plugins, replace them with captures from a local test vault that show the released interface exactly.

<table>
  <tr>
    <td width="50%"><img width="370" height="270" alt="1" src="https://github.com/user-attachments/assets/f899a567-8889-439c-89cd-d29ebe6aa0a2" />
<br><strong>Editable floating label</strong></td>
    <td width="50%"><img width="370" height="270" alt="2" src="https://github.com/user-attachments/assets/c9c48f25-b0ba-4b46-aaf1-2bec077eeb1d" />
<br><strong>Linked source text</strong></td>
  </tr>
  <tr>
    <td width="50%"><img width="370" height="270" alt="3" src="https://github.com/user-attachments/assets/7beed427-4353-44fb-89c0-9977febf26ca" />
<br><strong>Right-click appearance controls</strong></td>
    <td width="50%"><img width="370" height="270" alt="4" src="https://github.com/user-attachments/assets/29efc15f-2dab-462b-9328-a003dc3e8944" />
<br><strong>Scroll synchronisation</strong></td>
  </tr>
</table>

## Scroll synchronisation

A label's coordinates are now measured relative to the note document rather than the visible window.

- Create a label halfway down a long note: it remains beside that document region.
- Scroll the note: the label moves up or down with the corresponding Markdown content.
- Drag and resize operations respect the scrollable document dimensions, not only the visible viewport.
- The scroll listener is scoped to each rendered Markdown view and is removed when the view or the plugin unloads.

## Installation

### Manual installation — current release path

1. Download the latest **Release** from this repository.
2. Create the folder below inside your vault:

   ```text
   <vault>/.obsidian/plugins/floating-text-overlay/
   ```

3. Copy these release assets into that folder:

   ```text
   main.js
   manifest.json
   styles.css
   ```

4. In Obsidian, open **Settings → Community plugins** and enable **Floating Text Overlay**.

### Community Plugins — pending submission

The plugin is not yet listed in Obsidian's Community Plugins directory. Once it has passed the submission review, users will be able to install it from **Settings → Community plugins → Browse**.

## Usage

### Create a label

Open a Markdown note and use either the ribbon icon or the command:

```text
Floating Text Overlay: Add floating text box
```

A newly created, untouched empty label is only a transient draft. It is saved after a real action such as typing, dragging, resizing, styling, previewing, or explicitly linking text.

### Link a label to source text

1. In Live Preview or Source mode, select non-empty text in the Markdown editor.
2. Create a floating label. The label is linked automatically.
3. Alternatively, select text, right-click an existing label, and choose **Link current selection**.
4. Use `Ctrl` + click / `Cmd` + click on the highlighted linked text to toggle the label.

### Move and resize

- Hover the label to reveal its header.
- Drag the header to move the label.
- Drag the lower-right corner handle to resize it.

### Change appearance

Right-click a label to change its background colour and transparency. New labels start with a white surface.

### Preview Markdown

Click **Preview Markdown** from the label footer. Click **Back to edit** to return to the source editor.

## Editing Toolbar compatibility

This plugin includes an experimental bridge for [Editing Toolbar](https://github.com/PKM-er/obsidian-editing-toolbar). Keep the floating label focused, select text inside it, then invoke a toolbar command.

The bridge is intended for common Markdown operations such as bold, italic, headings, lists, inline code, undo/redo, font colour, and background colour. Since Editing Toolbar is a separate community plugin with its own command registration and UI modes, verify the exact buttons you use in your vault before release. Track results in [TESTING.md](TESTING.md).

## Storage model

Floating label state is stored in the plugin's Obsidian data file, keyed by note path. The following values are persisted after a meaningful edit:

- label text
- document-space position
- width and height
- background colour and opacity
- visibility state
- optional linked-text anchor and contextual metadata

Moving or resizing a label does **not** write, reflow, or insert content into the note's Markdown body.

## Development

### Prerequisites

- Node.js 18 or later
- Obsidian desktop
- A separate test vault

### Run locally

```bash
npm install
npm run dev
```

During development, place the repository at:

```text
<test-vault>/.obsidian/plugins/floating-text-overlay/
```

Reload Obsidian after a build. The folder name must match the plugin `id` in `manifest.json`.

### Build a release

```bash
npm run build
npm run docs:toc
```

A GitHub release must attach:

```text
main.js
manifest.json
styles.css
```

The release tag must match `manifest.json`, for example `0.7.0`.

## Testing

Follow the full workflow in [TESTING.md](TESTING.md). The scroll-specific regression test should be run in both Live Preview and Reading View with a note long enough to scroll through multiple screen heights.

## Repository assets

| Asset | Purpose |
| --- | --- |
| [`assets/logo.svg`](assets/logo.svg) | Repository avatar, release asset, and future directory branding. |
| [`assets/hero-banner.svg`](assets/hero-banner.svg) | GitHub README header. |
| [`docs/images/scroll-sync-demo.gif`](docs/images/scroll-sync-demo.gif) | Visual explanation of the v0.7.0 scroll behaviour. |
| [`docs/images/*.svg`](docs/images) | Editable dark-theme preview set. |

## Contributing

Open an issue with a reproducible vault setup, Obsidian version, operating system, theme, enabled editor plugins, and screenshots or screen recording. Pull requests are welcome for isolated, tested improvements.

## License

MIT © 2026 Qiuyi Liao
