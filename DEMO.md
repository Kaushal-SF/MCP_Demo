# Demo script (5 minutes)

A ready-to-run demo of DevFlow in Claude Code or Claude Desktop. Read the **Prepare** section the
day before, and do one full dry run.

## Prepare (10 minutes, the day before)

1. **Sign in to GitHub:** `gh auth status` should say you're logged in. If not, run `gh auth login`.
2. **Install DevFlow** in the host you'll present from (see [README → Install](README.md#install-2-minutes)).
3. **Check it works:** follow [README → Test it](README.md#test-it). Allow all DevFlow tools when
   the host first asks, so no permission pop-ups interrupt the demo (they are all read-only).
4. **Pick a demo PR.** A good one has 5–30 changed files, mostly code, and CI results.
   A real trainee PR from your queue is ideal. Write its link down. A public fallback:
   `modelcontextprotocol/typescript-sdk#2968`. Its risk score (70) is inflated by moved docs, and
   Claude says so; that's a good moment to explain that the score is fixed rules and the AI adds
   judgement on top.
5. **Pick a release range.** A public example known to work:
   `modelcontextprotocol/typescript-sdk` from `v2.2.0` to `v2.3.0` (30 PRs).
6. **Make the window readable:** a large font, one empty conversation, nothing else on screen.

## Script

| Time      | Say                                                                                                                                                                | Do                                                                                               | Point out                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 0:00–0:30 | "Reviewing a PR means opening the PR, the diff, CI, the linked issue and our checklist, and then deciding how careful to be. DevFlow gives all of that to the AI." | Nothing yet.                                                                                     | The problem, in one sentence.                                                                                 |
| 0:30–1:15 | "Where do I start my day?"                                                                                                                                         | Ask: _What's in my review queue?_                                                                | Oldest first, with size. One question replaced a GitHub search.                                               |
| 1:15–3:15 | "Let's review one."                                                                                                                                                | Claude Code: `/mcp__devflow__review-pr <your PR> react`. Desktop: **+** → DevFlow → `review-pr`. | The risk score and its reasons; it reads only the riskiest files; checklist results; a ready-to-post comment. |
| 3:15–4:00 | "Releases are tedious too."                                                                                                                                        | Ask: _Release notes for modelcontextprotocol/typescript-sdk from v2.2.0 to v2.3.0_               | Grouped by type, breaking changes first, contributors listed. Ready to paste.                                 |
| 4:00–4:30 | "And my stand-up."                                                                                                                                                 | Claude Code: `/mcp__devflow__standup-summary 3`.                                                 | Built from real activity, not memory.                                                                         |
| 4:30–5:00 | "It only reads, it runs on your laptop, and it installs with one command."                                                                                         | Show the one-line install from the README.                                                       | Read-only, local, and nothing to configure if you use the GitHub CLI.                                         |

## If something goes wrong

The quick fixes below cover the demo itself; [README → Troubleshooting](README.md#troubleshooting)
covers every setup problem.

| Symptom                          | Fix                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| DevFlow is missing from the host | Claude Code: `claude mcp list`. Claude Desktop: Settings → Extensions. Restart the host.                     |
| "No GitHub token found"          | Run `gh auth login` (or set `GITHUB_TOKEN`), then restart the host.                                          |
| `[NOT_FOUND]` for a PR           | Check the link, and that your login can see that repository.                                                 |
| `[RATE_LIMITED]`                 | Wait until the reset time in the message, or switch to the public fallback examples.                         |
| No network                       | Show `npm run inspect` with a recording, or walk through [Flow.md](Flow.md) § 11 (the `/review-pr` journey). |

## Questions people usually ask

- **Can it change my repository?** No. Every tool only reads. That's why hosts can approve its
  tools without asking.
- **Where does my code go?** From GitHub to your machine, and then to the AI assistant you're
  already using, as in any chat where you paste code. DevFlow has no server of its own.
- **How is the risk score calculated?** With fixed, explainable rules, not by an AI: size, source
  changes without tests, sensitive paths, dependency changes and CI failures. Each point comes with
  its reason. See [Decisions.md](Decisions.md) D12.
- **Can we use our own checklists?** Yes. Put Markdown files in a folder and set
  `DEVFLOW_CHECKLISTS_DIR`. See [checklists/README.md](checklists/README.md).
- **Does it work with GitHub Enterprise?** Yes. Set `GITHUB_API_URL`.
- **Which AI tools does it work with?** Any MCP host: Claude Code, Claude Desktop, VS Code,
  Cursor and others.
