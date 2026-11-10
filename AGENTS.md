# Repository Guidelines

## Project Boundaries

Keep the blog compatible with static hosting and dependency-light; prefer plain browser APIs over new build tooling. Treat CDN additions as project dependencies and document why they are needed. Do not commit secrets or tokens.

`blog-data.js` is generated; do not edit it by hand. After adding, deleting, or renaming posts, regenerate it with `scripts/generate-blog-data.mjs`. Keep the index in sync when publishing posts; exclude `notes/`.

## Writing Conventions

- `notes/` is reserved for the author's own notes, collected material, and future blog content. Do not use it for generated outlines, drafts, research summaries, or temporary workspaces unless explicitly requested. This boundary overrides writing skills' default working directories.
- Before titling a paper post, inspect existing first headings in `blogs/papers/` and continue the repository-wide `经典论文解读（中文序号）` sequence from the latest published number unless the user explicitly waives continuity. Topic labels do not restart numbering.
- Reference source files with repository-relative paths or public links; never include personal development environment paths in article content. Keep source links in the final reference section, including links to paper sections or tables. Preserve factual attribution in prose; add inline source links only when explicitly requested.
- After completing a post, remove task-generated outlines, draft versions, source summaries, preview screenshots, and empty temporary directories. Keep the final article, required images, and generated index; preserve existing notes and unrelated files. This cleanup rule overrides skills' artifact-retention defaults unless the user explicitly asks to retain intermediates.

## Choosing Content Formats

Choose the form that serves the content; avoid diagrams or tables that repeat the prose sentence by sentence.

| Form | Purpose |
| --- | --- |
| Prose | Explain concepts, conditions, causal relationships, reasoning, and conclusions; provide necessary context for visuals. |
| Tables | Align shared dimensions for comparisons, mappings, selection criteria, and parameter lists. |
| Mermaid flowcharts | Show steps, dependencies, branches, state transitions, and simple component relationships. |
| SVG | Precisely express position, size, alignment, nesting, and parallel relationships, such as request swimlanes, batch composition, scheduling rounds, memory layouts, and tensor structures. |

Prefer SVG for layouts showing concurrent requests and scheduling. Write SVG directly when appropriate; no plotting library is required.

## SVG Assets and Validation

- Store article images in `assets/images/<topic>/` with descriptive filenames.
- Use image paths relative to the Markdown article file. The web reader resolves these against the article URL, supporting editor previews and deployment under a subpath.
- Give SVGs a `viewBox`, readable text, coordinated colors, and descriptive information such as a title and description. Pair colors with labels to convey meaning.
- Clearly distinguish rounds, time, counts, and proportions. Label teaching models and drawings that are not to scale.
- Verify asset paths, SVG structure, browser rendering, and narrow-screen readability. State any checks the available environment prevents.

## Verification and Pull Requests

Match verification to the change: check JavaScript syntax for code changes and manually exercise affected browser behavior. For reader changes, cover affected navigation, search, sorting, direct post links, and Markdown rendering, including tables, code blocks, and Mermaid diagrams.

Pull requests should include a concise summary, verification steps, screenshots for visual changes, and whether generated data files were refreshed.
