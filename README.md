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

### Claude Code: install the plugin

One command, with nothing to clone or build — the plugin carries the server with it:

```
/plugin install devflow --marketplace Kaushal-SF/devflow-mcp
```

Or from your shell:

```bash
claude plugin marketplace add Kaushal-SF/devflow-mcp
claude plugin install devflow@devflow-mcp
```

Claude Code asks for an optional GitHub token. **Leave it empty** if you are signed in with the
GitHub CLI; DevFlow picks that login up on its own. Then start a new session and ask it something
from [What you can ask](#what-you-can-ask), or run `/devflow:review-pr owner/repo#123`.

To update later, run `claude plugin update devflow@devflow-mcp`. To remove it,
`claude plugin uninstall devflow@devflow-mcp`.

### Other hosts: install from source

Claude Desktop, VS Code and Cursor install the MCP server directly.

#### Step 1: Get DevFlow

```bash
git clone https://github.com/Kaushal-SF/devflow-mcp.git devflow
cd devflow
npm ci
npm run build      # creates dist/index.js
npm run bundle     # optional: creates build/devflow.mcpb for Claude Desktop
```

#### Step 2: Add it to your AI tool

| Host                  | What to do                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Desktop**    | Double-click `build/devflow.mcpb`, then **Install**                                                                              |
| **VS Code**           | `.vscode/mcp.json` below                                                                                                         |
| **Cursor and others** | Command `node`, argument `/full/path/to/devflow/dist/index.js`                                                                   |
| **Claude Code**       | Use [the plugin](#claude-code-install-the-plugin) instead, or `claude mcp add devflow --scope user -- node "$PWD/dist/index.js"` |

In Claude Desktop, leave the token field empty if you use the GitHub CLI.

VS Code `.vscode/mcp.json` (or run **MCP: Add Server** from the command palette):

```json
{
  "servers": {
    "devflow": {
      "type": "stdio",
      "command": "node",
      "args": ["/full/path/to/devflow/dist/index.js"]
    }
  }
}
```

Restart the host (or start a new Claude Code session) after adding it. `--scope user` makes
DevFlow available in every folder, not just the current one. Something not working? See
[Troubleshooting](#troubleshooting).

## Test it

These steps work for anyone, because they use a public repository.

**1. Check it's connected**

- Claude Code: `claude mcp list` shows `… ✓ Connected` — as `plugin:devflow:devflow` if you
  installed the plugin, or as `devflow` if you added the server yourself. Inside a session, `/mcp`
  shows it too, and `claude plugin list` shows the plugin as `✔ enabled`.
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
npm run inspect                                    # from source, in the devflow folder
npx @modelcontextprotocol/inspector node <path>    # <path> = the server's index.js
```

In the page, turn the server's switch on (it shows **Connected**), then open **Tools**, pick
`analyze_pr_risk` and run it with `pr` = `modelcontextprotocol/typescript-sdk#2968`.

The Inspector passes only basic variables (such as `HOME` and `PATH`) to the server, not the ones
your shell sets. A GitHub CLI login (`gh auth login`) works anyway. If your token comes from a
shell variable instead, pass it explicitly with `-e`. `npm run inspect` already does this for
`GITHUB_TOKEN` and `GH_TOKEN`:

```bash
npx @modelcontextprotocol/inspector -e GITHUB_TOKEN=$GITHUB_TOKEN node <path>
```

### Slash commands

DevFlow ships three ready-made tasks. Each host shows them differently:

| Task          | Claude Code (plugin)     | VS Code                        | Claude Desktop                             |
| ------------- | ------------------------ | ------------------------------ | ------------------------------------------ |
| Review a PR   | `/devflow:review-pr`     | `/mcp.devflow.review-pr`       | **+** button → DevFlow → `review-pr`       |
| Stand-up      | `/devflow:standup`       | `/mcp.devflow.standup-summary` | **+** button → DevFlow → `standup-summary` |
| Release notes | `/devflow:release-notes` | `/mcp.devflow.release-notes`   | **+** button → DevFlow → `release-notes`   |

Put arguments after the command, separated by spaces: `/devflow:review-pr owner/repo#123 react`,
`/devflow:standup 3`, or `/devflow:release-notes owner/repo v1.2.0 v1.3.0`. Type `/devflow` to see
them all.

If you added DevFlow to Claude Code as a plain MCP server rather than as the plugin, the same tasks
appear under their MCP names instead: `/mcp__devflow__review-pr`, `/mcp__devflow__standup-summary`
and `/mcp__devflow__release-notes`. The `pr` argument suggests the PRs waiting for your review in
hosts that support suggestions.

## Troubleshooting

**First, find the actual error message.** It usually says what to do.

| Host           | Where to look                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code    | `claude mcp list` (status per server), `/mcp` inside a session (select `devflow` for details), or `claude --debug`                                                                   |
| Claude Desktop | **Settings → Extensions → DevFlow**, and the log files in `~/Library/Logs/Claude/` (macOS) or `%APPDATA%\Claude\logs` (Windows)                                                      |
| VS Code        | **MCP: List Servers** → `devflow` → **Show Output**                                                                                                                                  |
| MCP Inspector  | The **Server Console** panel on the right                                                                                                                                            |
| Any terminal   | Run the server yourself: `node dist/index.js` (from source), or `node ~/.claude/plugins/**/devflow/server/index.js` (plugin). It prints startup errors and then waits; press Ctrl+C. |

For more detail, set `DEVFLOW_LOG_LEVEL=debug` in the server's environment.

### Signing in to GitHub

**"No GitHub token found"**

DevFlow found neither `GITHUB_TOKEN` nor a GitHub CLI login.

1. Run `gh auth status`. If it doesn't say "Logged in to github.com", run `gh auth login`
   (GitHub.com → HTTPS → log in with a web browser).
2. Restart the host, or switch the server off and on in the Inspector.

**`gh auth login` says the `GH_TOKEN` environment variable is being used**

Your shell sets `GH_TOKEN` (often in `~/.zshrc` or `~/.bashrc`), so the GitHub CLI refuses to store a
login. Sign in with the variable hidden:

```bash
env -u GH_TOKEN gh auth login
env -u GH_TOKEN gh auth status     # should say: Logged in to github.com account <you> (keyring)
```

**It works in the terminal but not in Claude Desktop, VS Code or the MCP Inspector**

Apps started from the Dock, Start menu or a browser don't see variables set in your shell profile,
and the MCP Inspector passes only basic ones (such as `HOME` and `PATH`). A token in `GH_TOKEN` or
`GITHUB_TOKEN` therefore works in the terminal only. Fix it once with a real GitHub CLI login
(above). Alternatives: paste a token into the Claude Desktop install dialog; add
`"env": { "GITHUB_TOKEN": "…" }` to the server in `.vscode/mcp.json`; or run the Inspector with
`-e GITHUB_TOKEN=…` (`npm run inspect` does this for you).

**`[UNAUTHORIZED]` on every request**

The token was rejected.

- If you set `GITHUB_TOKEN`, it **takes priority over the GitHub CLI login**. An old or revoked value
  there causes this even when `gh auth status` looks fine. Remove it from the host's server config
  (and from your shell with `unset GITHUB_TOKEN`), or replace it.
- Otherwise, your GitHub CLI login has expired: `gh auth login`.

**Results are for the wrong GitHub account** (stand-up or review queue shows someone else's work)

DevFlow uses whichever account the token belongs to. Check with `gh auth status`. If you have several
accounts, switch with `gh auth switch`, or set `GITHUB_TOKEN` to the right account's token.

### Starting the server

**DevFlow shows as "failed" or never connects**

- Check `node --version` is **22 or newer**. Older versions fail at startup.
- Using nvm, fnm, Volta or asdf? Apps started outside the terminal may find a different (older) Node,
  or none at all (`spawn node ENOENT`). Use the full path to Node as the command, from `which node`
  (macOS/Linux) or `where node` (Windows), for example `/Users/you/.nvm/versions/node/v24.11.0/bin/node`.
- From source: check that `dist/index.js` exists. If not, run `npm run build`.
- Read the error as described at the top of this section.

**`npx -y devflow-pr-mcp` fails with `404 Not Found`**

The package is not on npm. Install [the Claude Code plugin](#claude-code-install-the-plugin), or
[from source](#step-1-get-devflow) for other hosts.

**The path contains spaces** (for example `/Users/me/My Projects/devflow`)

Keep the quotes: `claude mcp add devflow --scope user -- node "$PWD/dist/index.js"`. In JSON
configs, write the path normally inside the `args` string; no extra escaping is needed.

**I changed the code, but nothing changed**

Hosts start the server once, when a session starts. Run `npm run build`, then start a new Claude Code
session, restart Claude Desktop, or switch the server off and on (VS Code, Inspector). For Claude
Desktop, also rebuild and reinstall the bundle: `npm run bundle`.

### Claude Code

**`/plugin install` says the plugin was not found in the marketplace**

Your copy of the marketplace listing is stale. Refresh it:
`claude plugin marketplace update devflow-mcp`.

**The plugin installed, but `claude mcp list` has no DevFlow entry**

The plugin's server is listed as `plugin:devflow:devflow`, not `devflow`. If it is missing
altogether, run `claude plugin list` to check the plugin is `✔ enabled`, then start a new session.

**The plugin is installed and I also added DevFlow with `claude mcp add`**

You will see two servers and two sets of the same tools. Keep one: either
`claude plugin uninstall devflow@devflow-mcp` or `claude mcp remove devflow`.

**DevFlow works in one folder but not in others**

`claude mcp add` without `--scope` saves the server for the current folder only. Add it for all your
projects:

```bash
claude mcp remove devflow
claude mcp add devflow --scope user -- node "/full/path/to/devflow/dist/index.js"
```

(The plugin is installed for every folder already, so this only applies to a server you added
yourself.)

**`claude mcp add` says `devflow` already exists**

Run `claude mcp remove devflow` (it finds the scope the server was saved in), then add it again.

**DevFlow is connected, but Claude doesn't use it, or the slash commands are missing**

- Servers load when a session starts: run `/exit` and start `claude` again.
- Slash commands have a prefix: type `/devflow:review-pr`, not `/review-pr`. Type `/devflow` to
  list them. See [Slash commands](#slash-commands).
- Mention DevFlow in the question if Claude reaches for something else: _"Using devflow, how risky
  is …?"_

**Claude asks permission for every tool call**

Choose "Yes, and don't ask again" once per tool, or allow all DevFlow tools in
`~/.claude/settings.json`. Every DevFlow tool is read-only:

```json
{ "permissions": { "allow": ["mcp__plugin_devflow_devflow", "mcp__devflow"] } }
```

The first line covers the plugin, the second a server you added yourself; keeping both is harmless.

### Claude Desktop

**Double-clicking `devflow.mcpb` does nothing, or the file opens as a zip**

Update Claude Desktop to the latest version. Then open **Settings → Extensions** and drag the file
onto that window.

**The extension is enabled, but DevFlow says "No GitHub token found"**

Claude Desktop doesn't see your shell's variables. Sign in with `gh auth login`, or open
**Settings → Extensions → DevFlow** and paste a token into the token field.

### Using DevFlow

**`[NOT_FOUND]` for a PR or repository**

- Check the link or the `owner/repo#123` reference.
- Private repository: the signed-in account must have access to it. Open the PR in a browser while
  signed in as the same account.
- For release notes, check that the tag or branch exists (`v1.2.0`, not `1.2.0`), or use a date such
  as `2026-10-01`.

**`[FORBIDDEN]` for an organisation's repositories**

- The organisation may require **SSO**. For the GitHub CLI, run `gh auth refresh` and approve SSO for
  the organisation when asked. For a personal token, open it under **GitHub → Settings → Developer
  settings** and click **Configure SSO → Authorize** for the organisation.
- With a fine-grained token, the organisation may need to approve it, and it must include read
  access to _Pull requests_, _Contents_, _Commit statuses_, _Checks_ and _Metadata_ for that
  repository.

**`[RATE_LIMITED]`**

GitHub limits how many requests you can make. The message says how long to wait (often about a
minute). It usually happens after many searches in a row, for example several release notes or
stand-ups in quick succession.

**My review queue is empty, or a PR is missing from it**

The queue lists open PRs where **you, or a team you belong to,** are a requested reviewer. GitHub
removes a PR from it once you submit a review. You can still review any PR by its link.

**CI status says it is unavailable**

The PR's details and review still work. CI results need read access to _Checks_ and _Commit
statuses_. Fine-grained tokens often lack these.

### GitHub Enterprise and company networks

**GitHub Enterprise Server**

Set `GITHUB_API_URL`, for example `https://github.example.com/api/v3`, and sign in to that host with
the GitHub CLI: `gh auth login --hostname github.example.com`. DevFlow asks `gh` for that host's
token automatically.

**`self-signed certificate` or `unable to get local issuer certificate`**

Your company network inspects HTTPS traffic with its own certificate. Ask IT for the certificate
file (`.pem`) and add it to the server's environment:
`NODE_EXTRA_CA_CERTS=/path/to/company-ca.pem`.

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

**Plugin commands** (Claude Code plugin only): `/devflow:review-pr`, `/devflow:standup` and
`/devflow:release-notes`, which run the same tasks under a shorter name.

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
claude mcp add devflow --scope user --env GITHUB_TOKEN=github_pat_... -- node "/full/path/to/devflow/dist/index.js"
```

In Claude Desktop, paste it into the token field when installing. With the Claude Code plugin, run
`/plugin configure devflow@devflow-mcp` and paste it there; it is stored in your system keychain,
not in a settings file.

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
