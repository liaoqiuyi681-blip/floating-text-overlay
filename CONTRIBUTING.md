# Contributing

## Report a bug

Open an issue containing:

- Floating Text Overlay version
- Obsidian desktop version and operating system
- Theme, CSS snippets, and editor-related community plugins
- Exact reproduction steps
- Expected and actual behavior
- A screenshot or short screen recording when the issue is visual

For scrolling issues, include whether the failure occurs in Live Preview, Source mode, Reading View, or all of them.

## Development workflow

1. Use a separate Obsidian test vault.
2. Run `npm install` once, then `npm run dev` during development.
3. Run `npm run build` before submitting a pull request.
4. Run `npm run docs:toc` whenever README headings change.
5. Complete the affected section in `TESTING.md`.

## Pull requests

Keep each pull request narrow. Explain the problem, implementation, validation steps, and compatibility implications. Do not commit generated local plugin data such as `data.json`.
