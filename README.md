# DevFlow MCP

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants the context a reviewer
normally gathers by hand: PR details, the diff that matters, CI status, linked issues, a risk
assessment that says where to look first, your team's review checklists, and your own recent
activity for stand-ups and release notes.

Works with any MCP host: Claude Code, Claude Desktop, VS Code (Copilot agent mode), Cursor, and others.

> **Status:** v0.2 (Milestone 2). Tools, resources and prompts, read-only, over stdio.
> See [PROGRESS.md](PROGRESS.md) for the roadmap.

## Why

Reviewing a PR well means opening the PR, the diff, the CI page, the linked issue and the team
checklist, then deciding how careful to be. DevFlow lets your assistant do that legwork, so you
can ask:

- _"What should I review next?"_
- _"Review acme/web#42 against our React checklist."_
- _"Is this PR safe to merge? What's failing in CI?"_
- _"Write my stand-up."_ · _"Draft release notes since v1.2.0."_

## What's inside

**Tools**: the model calls these as needed. All are read-only.

| Tool                     | What it does                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `get_pr_context`         | PR metadata, description, changed files with line counts, CI check summary, issues it closes                 |
| `analyze_pr_risk`        | 0–100 risk score with explained signals (size, missing tests, sensitive paths, deps, CI) and a reading order |
| `get_pr_diff`            | Unified-diff patches for chosen files or globs, within a character budget                                    |
| `list_review_queue`      | Open PRs awaiting your review, oldest first, with age and size label (XS–XL); paginated                      |
| `get_my_activity`        | Your PRs merged, in progress and reviewed over the last N days, plus pending review requests                 |
| `generate_release_notes` | PRs merged between two tags, branches, SHAs or dates, grouped by type, with breaking changes and Markdown    |

**Resources**: reference material you or your host can attach.

| URI                                         | Content                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `devflow://checklists/{name}`               | Review checklists: `general`, `react`, `node`, `security`, or your team's own |
| `devflow://repos/{owner}/{repo}/guidelines` | The repository's CONTRIBUTING guide and pull-request template                 |

**Prompts**: slash-commands in hosts that support them. Arguments autocomplete.

| Prompt             | Arguments             | What it does                                                                               |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------ |
| `/review-pr`       | `pr`, `checklist?`    | Context → risk → diff of the riskiest files → checklist → structured review with a comment |
| `/standup-summary` | `days?`, `repo?`      | Yesterday / Today / Blockers from your real activity and review queue                      |
| `/release-notes`   | `repo`, `from`, `to?` | Polished, reader-friendly release notes                                                    |

The `pr` argument of `/review-pr` suggests the PRs currently waiting for your review.

Every tool publishes an input **and** output JSON Schema, returns `structuredContent`, and carries
annotations (`readOnlyHint`, `openWorldHint`, …) so hosts can auto-approve safe calls. PRs can be
referenced as `https://github.com/owner/repo/pull/123` or `owner/repo#123`.

## Quick start

**Requirements:** Node.js 22+ and a GitHub token.

1. **Create a token.** A [fine-grained PAT](https://github.com/settings/personal-access-tokens) with
   **read-only** access to _Pull requests_, _Contents_, _Commit statuses_, _Checks_ and _Metadata_ on
   the repositories you review. (A classic token with `repo` scope also works.) If you use the GitHub
   CLI, `gh auth token` prints one.

2. **Build** (until the package is published to npm):

   ```bash
   git clone https://github.com/Kaushal-SF/MCP_Demo.git devflow-mcp && cd devflow-mcp
   npm ci && npm run build
   ```

3. **Add it to your MCP host.**

   **Claude Code**

   ```bash
   # run from inside the devflow-mcp folder
   claude mcp add devflow --env GITHUB_TOKEN=$(gh auth token) -- node "$PWD/dist/index.js"
   ```

   **Claude Desktop**: `claude_desktop_config.json`

   ```json
   {
     "mcpServers": {
       "devflow": {
         "command": "node",
         "args": ["/absolute/path/to/devflow-mcp/dist/index.js"],
         "env": { "GITHUB_TOKEN": "github_pat_..." }
       }
     }
   }
   ```

   **VS Code**: `.vscode/mcp.json`

   ```json
   {
     "inputs": [
       {
         "id": "github-token",
         "type": "promptString",
         "description": "GitHub token",
         "password": true
       }
     ],
     "servers": {
       "devflow": {
         "type": "stdio",
         "command": "node",
         "args": ["/absolute/path/to/devflow-mcp/dist/index.js"],
         "env": { "GITHUB_TOKEN": "${input:github-token}" }
       }
     }
   }
   ```

## Configuration

All configuration is via environment variables (validated at startup; see [.env.example](.env.example)).

| Variable                  | Required | Default                  | Description                                                                            |
| ------------------------- | -------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`            | yes      | —                        | GitHub token used for all API calls                                                    |
| `GITHUB_API_URL`          | no       | `https://api.github.com` | GitHub Enterprise Server API URL, e.g. `https://github.example.com/api/v3`             |
| `DEVFLOW_LOG_LEVEL`       | no       | `info`                   | `trace` `debug` `info` `warn` `error` `fatal` `silent`. Logs go to stderr.             |
| `DEVFLOW_SENSITIVE_PATHS` | no       | —                        | Extra comma-separated globs `analyze_pr_risk` treats as sensitive                      |
| `DEVFLOW_CHECKLISTS_DIR`  | no       | bundled `checklists/`    | Folder of your team's own checklists; see [checklists/README.md](checklists/README.md) |

Logs always go to stderr. Hosts that support MCP logging also receive warnings and errors as log
notifications, or more if they ask for a lower level with `logging/setLevel`.

## Try it

After adding the server to your host, try:

| Ask or type                                      | What happens                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| _"What's in my review queue?"_                   | `list_review_queue`: your pending reviews, oldest first, with sizes         |
| `/review-pr` then pick a PR from the suggestions | Context, risk, diff of the riskiest files and checklist → structured review |
| _"How risky is owner/repo#123, and why?"_        | `analyze_pr_risk`: score, explained signals, which files to read first      |
| `/standup-summary`                               | Yesterday / Today / Blockers from your real GitHub activity                 |
| `/release-notes` with `from` = your last tag     | Grouped release notes with breaking changes first                           |

## Security

- **Read-only by design** in this version: no tool can modify GitHub. Checklists are read only
  from the configured folder, and checklist names are restricted to `[a-z0-9-]`, so a crafted URI
  cannot read other files.
- **Least privilege:** use a fine-grained, read-only token scoped to the repos you need.
- **Secrets stay in env vars:** never in files or logs (the logger redacts token fields).
- **Untrusted content:** PR titles, descriptions, file names and code are written by PR authors.
  Tool descriptions, prompts and server instructions tell the model to treat them as data, not
  instructions (prompt-injection awareness). Output is bounded: descriptions at 4,000 characters,
  diffs by a character budget, guidelines at 8,000 characters each.
- **Log notifications** sent to the host never include stack traces or secrets.
- **Errors don't leak internals:** expected failures return actionable messages; unexpected ones
  return a generic message and are logged server-side.

## Development

```bash
npm run dev            # run from source (tsx)
npm test               # unit + in-memory MCP integration tests
npm run test:coverage  # with coverage thresholds
npm run lint           # ESLint (strict, type-checked)
npm run typecheck      # tsc --noEmit
npm run build          # bundle to dist/ with tsup
npm run inspect        # build and open the MCP Inspector against the server
GITHUB_TOKEN=$(gh auth token) npm run smoke -- owner/repo#123 [v1.0.0]   # live end-to-end check of everything
```

Project documentation:

| Document                           | Read it to learn                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the code is organised: layers, folders, testing strategy                 |
| [Flow.md](Flow.md)                 | How execution travels across files and functions, including every error path |
| [Decisions.md](Decisions.md)       | Why each choice was made: alternatives, trade-offs, when to revisit          |
| [PROGRESS.md](PROGRESS.md)         | What has been built so far, how it was verified, and what's next             |
| [CHANGELOG.md](CHANGELOG.md)       | Released changes by version                                                  |

## License

[MIT](LICENSE)
