# Testing Guide

This document is the release checklist for Floating Text Overlay. Test in a separate vault with Community Plugins enabled.

## Environment

Record the following before reporting a result:

- Plugin version
- Obsidian desktop version
- Operating system
- Theme and CSS snippets
- Whether Editing Toolbar is enabled and its version
- Editor mode: Live Preview, Source mode, or Reading View

## Test fixture

Create a note called `Floating Text Overlay Test` and paste enough content to create at least four screen heights of scrolling. Include the following text near the first third and the second half of the note:

```markdown
## Linked Text A
This sentence should remain linked after it is edited.

## Linked Text B
This paragraph is far enough down the note to test scroll synchronisation.
```

## Core workflow

| ID | Action | Expected result |
| --- | --- | --- |
| C-01 | Create a label from the ribbon icon. | A white label appears with the `Type here…` placeholder. |
| C-02 | Click into the label and type text. | The placeholder disappears; regular text entry works. |
| C-03 | Hover a label. | Header, delete control, and Markdown preview control appear without covering content. |
| C-04 | Drag the header. | The label moves; the Markdown body is unchanged. |
| C-05 | Resize from lower-right handle. | The entire widget resizes; text reflows normally. |
| C-06 | Right-click a label. | Colour and transparency controls are available. |
| C-07 | Delete a label. | It disappears immediately with no confirmation dialog. |
| C-08 | Reload Obsidian after editing a label. | Persisted labels restore with content, geometry, style, and links. |

## Link workflow

| ID | Action | Expected result |
| --- | --- | --- |
| L-01 | Select `This sentence should remain linked after it is edited.` and create a label. | The label is linked automatically. |
| L-02 | Inspect the source text. | It has the linked-text visual marker. |
| L-03 | `Ctrl` + click / `Cmd` + click the marked source text. | The linked label toggles closed. |
| L-04 | Repeat the modified click. | The linked label reopens. |
| L-05 | Edit the linked sentence by inserting words in the middle. | The linked range remains marked and continues to toggle the label. |
| L-06 | Right-click a linked label and select **Locate linked text**. | The editor selects and scrolls to the linked text. |
| L-07 | Right-click a linked label and select **Remove text link**. | The marker and link state are removed. |

## Scroll synchronisation regression test — v0.7.0

Run this test in **Live Preview** and **Reading View**.

1. Scroll to the middle of the long test note.
2. Create a label beside `Linked Text B`.
3. Type a short note so it persists.
4. Scroll upward by at least one full screen height.
5. Scroll downward past the original position.
6. Return to the linked content.

Expected:

- The floating label moves with the document, rather than staying fixed in the viewport.
- At the original section, the label remains near the content it was created beside.
- Scrolling does not make the editor lose focus or prevent text insertion.
- Dragging and resizing while scrolled down saves a position that remains correct after reloading.

## Editing Toolbar compatibility test

1. Enable Editing Toolbar and use a fixed/top toolbar layout first.
2. Click inside a floating label and select text.
3. Test the commands you rely on: bold, italic, heading, bullet list, numbered list, code, undo/redo, font colour, and background colour.
4. Confirm the selected text in the floating label changes, not the main note body.
5. Return focus to the note body and confirm Editing Toolbar works normally there.

Record unsupported commands as issues rather than assuming all toolbar modes are compatible.

## Performance and cleanup

1. Create at least 20 persisted labels over a long note.
2. Scroll continuously for 20 seconds.
3. Switch between notes, close the pane, reopen the note, and reload the plugin.
4. Confirm that labels follow the document and Obsidian remains responsive.
5. Confirm no duplicate overlay layers or duplicated labels are visible after repeated pane changes.

## Release gate

Do not publish a release until all of the following pass:

- [ ] Build: `npm run build`
- [ ] README table of contents: `npm run docs:toc`
- [ ] Manual installation from the three release assets
- [ ] Core workflow C-01 through C-08
- [ ] Link workflow L-01 through L-07
- [ ] Scroll synchronisation in Live Preview
- [ ] Scroll synchronisation in Reading View
- [ ] Editing Toolbar commands used by the release are verified locally
- [ ] Plugin reload and full Obsidian restart
- [ ] Release tag equals `manifest.json` version
