---
description: Write your stand-up from your GitHub activity
argument-hint: [days] [owner/repo]
---

Write the user's stand-up notes from `$ARGUMENTS`: the first argument is the number of days to look back (default 1), the second an optional repository to limit it to.

Call `get_my_activity` with those values, then write three short sections:

- **Yesterday** — what was merged and what was reviewed.
- **Today** — what is still open or in progress.
- **Blockers** — PRs waiting on someone else, and reviews waiting on the user.

Use plain sentences a person would say out loud, not a list of PR titles. If a section has nothing in it, say so rather than padding it, and never invent activity that the tool did not report.
