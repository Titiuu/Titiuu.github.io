# Repository Guidelines

## Project Structure & Module Organization

This repository is a static GitHub Pages personal blog. Core page files live at the repository root:

- `index.html`: home/profile page and category entry points.
- `category.html`: blog reader page.
- `styles.css`: shared layout, responsive styles, and article presentation.
- `script.js`: language switching, search, reader behavior, Markdown rendering, and Mermaid rendering.
- `blogs/<category>/*.md`: source Markdown posts. Current categories are `tech`, `papers`, and `projects`.
- `notes/*.md`: scratch notes and future blog material. These files are not surfaced in the frontend and should not be added to `blog-data.js`.
- `scripts/`: Node scripts that generate static data files.
- `blog-data.js`: generated blog index; do not edit by hand.
- `github-contributions-data.js`: generated GitHub contributions data.

There is no formal test directory or asset pipeline at this time.

## Build, Test, and Development Commands

Run local preview from the repository root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Use an HTTP server because the reader fetches Markdown files on demand.

Regenerate the blog index after adding, deleting, or renaming posts:

```bash
node scripts/generate-blog-data.mjs
```

Update contribution data manually:

```bash
node scripts/generate-github-contributions.mjs
```

Check JavaScript syntax before committing:

```bash
node --check script.js
node --check scripts/generate-blog-data.mjs
node --check scripts/generate-github-contributions.mjs
```

## Coding Style & Naming Conventions

Use two-space indentation in HTML, CSS, and JavaScript. Keep code dependency-light and compatible with static hosting. Prefer plain browser APIs over adding build tooling.

Name blog files with a date-prefixed slug:

```text
blogs/tech/2024-09-03-redis-notes.md
```

The first `#` heading becomes the post title. Keep category keys aligned with `scripts/generate-blog-data.mjs`.

Name scratch notes descriptively under `notes/`; they do not need date-prefixed blog slugs until promoted into `blogs/<category>/`.

## Testing Guidelines

There is no automated test framework. Validate changes with syntax checks and manual browser testing. For reader changes, test category navigation, search, sort toggling, direct `category.html?category=...&post=...` links, Markdown tables, code blocks, and Mermaid diagrams.

## Commit & Pull Request Guidelines

Recent commits use short, imperative messages such as `Optimize blog content loading` and `Render Mermaid diagrams in reader`; `docs:` prefixes are also acceptable for documentation-only changes.

Pull requests should include a concise summary, manual verification steps, and screenshots for visual layout changes. Mention whether generated files such as `blog-data.js` or `github-contributions-data.js` were refreshed.

## Security & Configuration Tips

Do not commit secrets or tokens. The contributions generator writes public GitHub activity data only. Treat CDN script additions as project-level dependencies and document why they are needed.
