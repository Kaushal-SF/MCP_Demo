---
description: Draft release notes between two tags or dates
argument-hint: <owner/repo> <from> [to]
---

Draft release notes from `$ARGUMENTS`: the repository, the previous release (a tag, branch, SHA or `YYYY-MM-DD` date), and optionally the new one (default: now).

Call `generate_release_notes` with those values. It returns the merged pull requests already grouped, plus a `markdown` field.

Present the notes with breaking changes first, then features, fixes and the rest. Keep each line readable by someone who did not write the code: say what changed for a user of the project, not which files moved. Credit the contributors the tool lists. If it reports that the results were truncated, say so rather than implying the list is complete.
