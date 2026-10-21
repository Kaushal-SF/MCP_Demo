# Review checklists

Each `*.md` file in this folder is served as an MCP resource at `devflow://checklists/<file-name>`
and can be applied with the `/review-pr` prompt (`checklist` argument). This README is ignored.

## Format

```markdown
# Title shown to users

> One-line description shown in resource lists.

## Section

- [ ] A checkable item, phrased so evidence can confirm or refute it.
```

- File names: lowercase letters, digits and dashes (`react.md`, `mobile-app.md`).
- Keep items concrete and verifiable from a diff. "Code is clean" is not checkable; "No unused
  imports or commented-out code" is.

## Using your team's own checklists

Point `DEVFLOW_CHECKLISTS_DIR` at a folder of files in this format. It replaces this folder. Files
are re-read on every request, so edits apply without restarting the server.
