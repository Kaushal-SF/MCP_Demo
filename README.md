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

| Ask                                                        | What you get                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| _"What's in my review queue?"_                             | PRs waiting for you, oldest first, with their size                               |
| _"Review owner/repo#123 against the react checklist"_      | A structured review: summary, risk, findings, checklist, a comment ready to post |
| _"How risky is owner/repo#123? What should I read first?"_ | A 0–100 score, the reasons, and which files to read first                        |
| _"Write my stand-up"_                                      | Yesterday / Today / Blockers from your real GitHub activity                      |
| _"Release notes for owner/repo from v1.2.0 to v1.3.0"_     | Merged PRs grouped into Features, Bug fixes and so on, breaking changes first    |

PRs can be given as links (`https://github.com/owner/repo/pull/123`) or as `owner/repo#123`. The
same tasks are also available as ready-made [slash commands](#slash-commands).

## Install (2 minutes)

**You need:**

- [Node.js 22 or newer](https://nodejs.org) (`node --version`)
- The [GitHub CLI](https://cli.github.com), signed in: run `gh auth login`, then check with
  `gh auth status`. DevFlow uses this login, so there is no token to create.
  (No GitHub CLI? See [Use your own token](#use-your-own-token).)

### Step 1: Get DevFlow

**From npm** (once `devflow-pr-mcp` is published): nothing to download; `npx` fetches it in step 2.

**From source** (works today, before the npm release):

```bash
git clone https://github.com/Kaushal-SF/MCP_Demo.git devflow
cd devflow
npm ci
npm run build      # creates dist/index.js
npm run bundle     # optional: creates build/devflow.mcpb for Claude Desktop
```

### Step 2: Add it to your AI tool

| Host                  | From npm                                                                            | From source                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Claude Code**       | `claude mcp add devflow -- npx -y devflow-pr-mcp`                                   | In the `devflow` folder: `claude mcp add devflow -- node "$PWD/dist/index.js"`                      |
| **Claude Desktop**    | Download `devflow.mcpb` from the GitHub release, double-click it, **Install**       | Double-click `build/devflow.mcpb`, **Install**                                                      |
| **VS Code**           | `.vscode/mcp.json` below, with `"command": "npx", "args": ["-y", "devflow-pr-mcp"]` | `.vscode/mcp.json` below, with `"command": "node", "args": ["/full/path/to/devflow/dist/index.js"]` |
| **Cursor and others** | Command `npx`, arguments `-y devflow-pr-mcp`                                        | Command `node`, argument `/full/path/to/devflow/dist/index.js`                                      |

In Claude Desktop, leave the token field empty if you use the GitHub CLI.

VS Code `.vscode/mcp.json` (or run **MCP: Add Server** from the command palette):

```json
{
  "servers": {
    "devflow": { "type": "stdio", "command": "npx", "args": ["-y", "devflow-pr-mcp"] }
  }
}
```

Restart the host (or start a new Claude Code session) after adding it.

## Test it

These steps work for anyone, because they use a public repository.

**1. Check it's connected**

- Claude Code: `claude mcp list` shows `devflow: … ✓ Connected`. Inside a session, `/mcp` shows it too.
- Claude Desktop: **Settings → Extensions** shows DevFlow as enabled.
- VS Code: **MCP: List Servers** shows `devflow` as running.

**2. Ask about a public PR**

| Ask                                                                                  | You should see                                                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| _"How risky is modelcontextprotocol/typescript-sdk#2968? What should I read first?"_ | A score of 70/100 (high), the reasons, a list of files to read first, and CI with 18 checks passed |
| _"Release notes for modelcontextprotocol/typescript-sdk from v2.2.0 to v2.3.0"_      | About 30 PRs grouped into sections, with contributors                                              |
| _"Show me the react review checklist from devflow"_                                  | The bundled React checklist                                                                        |

Your host may ask permission the first time each DevFlow tool runs. Every tool is read-only, so it is
safe to allow them all.

**3. Try your own data**

- _"What's in my review queue?"_ lists PRs where your review is requested (it may be empty).
- _"Write my stand-up for the last 3 days."_
- `/mcp__devflow__review-pr` (Claude Code) with one of your PRs. See [Slash commands](#slash-commands).

**4. Without an AI (optional)**: the [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
opens a web page where you can call each tool by hand:

```bash
npx @modelcontextprotocol/inspector npx -y devflow-pr-mcp     # from npm
npm run inspect                                               # from source, in the devflow folder
```

### Slash commands

DevFlow ships three ready-made prompts. Each host shows them differently:

| Prompt        | Claude Code                      | VS Code                        | Claude Desktop                             |
| ------------- | -------------------------------- | ------------------------------ | ------------------------------------------ |
| Review a PR   | `/mcp__devflow__review-pr`       | `/mcp.devflow.review-pr`       | **+** button → DevFlow → `review-pr`       |
| Stand-up      | `/mcp__devflow__standup-summary` | `/mcp.devflow.standup-summary` | **+** button → DevFlow → `standup-summary` |
| Release notes | `/mcp__devflow__release-notes`   | `/mcp.devflow.release-notes`   | **+** button → DevFlow → `release-notes`   |

In Claude Code, put arguments after the command, separated by spaces:
`/mcp__devflow__review-pr owner/repo#123 react` or `/mcp__devflow__standup-summary 3`.
Type `/devflow` to see them in the command list. The `pr` argument suggests the PRs waiting for your
review in hosts that support suggestions.

### Troubleshooting

| Symptom                                      | Fix                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| DevFlow is not listed, or shows as failed    | Check `node --version` is 22 or newer. Restart the host. In Claude Code, `claude mcp list` shows the error.      |
| "No GitHub token found"                      | Run `gh auth login` (or set `GITHUB_TOKEN`), then restart the host.                                              |
| Works in the terminal, not in Claude Desktop | Desktop apps don't see variables from your shell profile. Run `gh auth login`, or paste a token when installing. |
| `[UNAUTHORIZED]`                             | Your login has expired: `gh auth status`, then `gh auth login`.                                                  |
| `[NOT_FOUND]` for a PR                       | Check the link, and that your GitHub account can see that repository.                                            |
| `[RATE_LIMITED]`                             | GitHub is limiting requests. Wait the time shown in the message.                                                 |
| Organisation repos return `[FORBIDDEN]`      | The organisation may require SSO: `gh auth refresh`, or authorise your token for SSO on GitHub.                  |

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

**Prompts**: ready-made tasks; see [Slash commands](#slash-commands) for how each host shows them.

| Prompt            | Arguments             | What it does                                                                          |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `review-pr`       | `pr`, `checklist?`    | Context → risk → diff of the riskiest files → checklist → review with a draft comment |
| `standup-summary` | `days?`, `repo?`      | Yesterday / Today / Blockers                                                          |
| `release-notes`   | `repo`, `from`, `to?` | Reader-friendly release notes                                                         |

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
