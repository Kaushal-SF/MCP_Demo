# DevFlow

A pull-request review assistant for Claude and other AI tools. It gathers what a reviewer normally
collects by hand: the PR, the diff that matters, CI status, linked issues and a risk score that
says where to look first. It reviews against your team's checklist, and it also writes your
stand-up and your release notes.

**Read-only:** it never changes anything on GitHub. **Local:** it runs on your machine with your
own GitHub login.

Works with Claude Code, Claude Desktop, VS Code (Copilot agent mode), Cursor and any other
[MCP](https://modelcontextprotocol.io) host.

## What you can ask

| Ask or type                                                      | What you get                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| _"What's in my review queue?"_                                   | PRs waiting for you, oldest first, with their size                               |
| `/review-pr`, then pick a PR from the list                       | A structured review: summary, risk, findings, checklist, a comment ready to post |
| _"How risky is owner/repo#123?"_                                 | A 0–100 score, the reasons, and which files to read first                        |
| `/standup-summary`                                               | Yesterday / Today / Blockers from your real GitHub activity                      |
| _"Release notes for owner/repo from v1.2.0"_ or `/release-notes` | Merged PRs grouped into Features, Bug fixes and so on, breaking changes first    |

PRs can be given as links (`https://github.com/owner/repo/pull/123`) or as `owner/repo#123`.

## Install (2 minutes)

**You need:** [Node.js 22+](https://nodejs.org) and the [GitHub CLI](https://cli.github.com)
signed in (`gh auth login`). DevFlow uses that login, so there is no token to create.
(No GitHub CLI? See [Use your own token](#use-your-own-token).)

**Claude Code**

```bash
claude mcp add devflow -- npx -y devflow-pr-mcp
```

**Claude Desktop**: download `devflow.mcpb`, double-click it, and click **Install**. Leave the token
field empty.

**VS Code**: add to `.vscode/mcp.json` (or run **MCP: Add Server** from the command palette)

```json
{
  "servers": {
    "devflow": { "type": "stdio", "command": "npx", "args": ["-y", "devflow-pr-mcp"] }
  }
}
```

**Cursor and other hosts**: the command is `npx -y devflow-pr-mcp`.

Then ask _"What's in my review queue?"_ to check it works.

> **Before the npm release:** clone and build once, then use `node /full/path/to/dist/index.js`
> instead of `npx -y devflow-pr-mcp`:
>
> ```bash
> git clone https://github.com/Kaushal-SF/MCP_Demo.git devflow && cd devflow
> npm ci && npm run build
> claude mcp add devflow -- node "$PWD/dist/index.js"
> ```
>
> `npm run bundle` builds the Claude Desktop installer at `build/devflow.mcpb`.

## What's inside

**Tools**: the AI calls these on its own when your question needs them.

| Tool                     | What it does                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `get_pr_context`         | PR details and description, changed files, CI status, issues it closes                          |
| `analyze_pr_risk`        | 0–100 risk score with reasons (size, missing tests, sensitive paths, dependencies, CI failures) |
| `get_pr_diff`            | The code changes for chosen files, within a size budget                                         |
| `list_review_queue`      | Open PRs waiting for your review, oldest first, sized XS–XL                                     |
| `get_my_activity`        | Your PRs merged, in progress and reviewed in the last N days, plus reviews waiting for you      |
| `generate_release_notes` | PRs merged between two tags, branches, commits or dates, grouped by type, as Markdown           |

**Prompts**: slash commands. Arguments autocomplete; `/review-pr` suggests your pending reviews.

| Prompt             | Arguments             | What it does                                                                          |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------- |
| `/review-pr`       | `pr`, `checklist?`    | Context → risk → diff of the riskiest files → checklist → review with a draft comment |
| `/standup-summary` | `days?`, `repo?`      | Yesterday / Today / Blockers                                                          |
| `/release-notes`   | `repo`, `from`, `to?` | Reader-friendly release notes                                                         |

**Resources**: reference material you can attach in hosts that support it.

| URI                                         | Content                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `devflow://checklists/{name}`               | Review checklists: `general`, `react`, `node`, `security`, or your team's own |
| `devflow://repos/{owner}/{repo}/guidelines` | The repository's CONTRIBUTING guide and pull-request template                 |

## Settings (all optional)

Set these as environment variables in your host's server config.

| Variable                  | Default                  | Description                                                                              |
| ------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`            | your `gh` login          | A GitHub token to use instead of the GitHub CLI login                                    |
| `DEVFLOW_CHECKLISTS_DIR`  | bundled checklists       | A folder of your team's own checklists; see [checklists/README.md](checklists/README.md) |
| `DEVFLOW_SENSITIVE_PATHS` | —                        | Extra comma-separated globs that `analyze_pr_risk` treats as sensitive                   |
| `GITHUB_API_URL`          | `https://api.github.com` | GitHub Enterprise Server, e.g. `https://github.example.com/api/v3`                       |
| `DEVFLOW_LOG_LEVEL`       | `info`                   | `trace` `debug` `info` `warn` `error` `fatal` `silent` (logs go to stderr)               |

### Use your own token

For the least access, create a
[fine-grained token](https://github.com/settings/personal-access-tokens) with **read-only** access
to _Pull requests_, _Contents_, _Commit statuses_, _Checks_ and _Metadata_, and pass it as
`GITHUB_TOKEN`:

```bash
claude mcp add devflow --env GITHUB_TOKEN=github_pat_... -- npx -y devflow-pr-mcp
```

In Claude Desktop, paste it into the token field when installing.

## Security

- **Read-only.** No tool can change GitHub. Hosts can auto-approve every DevFlow tool safely.
- **Your login stays local.** The token comes from your environment or the GitHub CLI. It is never
  written to a file and is redacted from logs.
- **PR content is treated as untrusted.** Titles, descriptions and code are written by PR authors.
  The tools and prompts tell the AI to treat them as data, never as instructions, and outputs are
  size-limited.
- **No file access beyond the checklists folder.** Checklist names are restricted to `a-z`, `0-9`
  and `-`, so a crafted request cannot read other files.

## For contributors

```bash
npm ci
npm test               # unit + MCP integration tests
npm run lint && npm run typecheck
npm run build          # one self-contained file: dist/index.js
npm run bundle         # Claude Desktop installer: build/devflow.mcpb
npm run inspect        # explore the server in the MCP Inspector
npm run smoke -- owner/repo#123 [v1.0.0]   # live check of everything against real GitHub
```

| Document                           | Read it to learn                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| [DEMO.md](DEMO.md)                 | A 5-minute demo script, with preparation and likely questions                |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the code is organised: layers, folders, build, testing                   |
| [Flow.md](Flow.md)                 | How execution travels across files and functions, including every error path |
| [Decisions.md](Decisions.md)       | Why each choice was made: alternatives, trade-offs, when to revisit          |
| [PROGRESS.md](PROGRESS.md)         | What was built, how it was verified, and what's left                         |
| [CHANGELOG.md](CHANGELOG.md)       | Changes by version                                                           |

## License

[MIT](LICENSE)
