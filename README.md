# DevFlow MCP

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants the pull-request context a
reviewer normally gathers by hand: PR details, changed files, CI status, linked issues, and a
risk assessment that says where to look first.

Works with any MCP host: Claude Code, Claude Desktop, VS Code (Copilot agent mode), Cursor, and others.

> **Status:** v0.1 (Milestone 1). Read-only GitHub tools over stdio. See [PROGRESS.md](PROGRESS.md)
> for the roadmap and what's coming next.

## Why

Reviewing a PR well means opening the PR, the diff, the CI page, the linked issue and the team
checklist, then deciding how careful to be. DevFlow lets your assistant do that legwork in one
step, so you can ask:

- _"What should I review next?"_
- _"Summarise acme/web#42 and tell me where the risk is."_
- _"Is this PR safe to merge? What's failing in CI?"_

## Tools

| Tool                | What it does                                                                                             | Side effects |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| `get_pr_context`    | PR metadata, description, changed files with line counts, CI check summary, issues it closes             | Read-only    |
| `analyze_pr_risk`   | 0–100 risk score with explained signals (size, missing tests, sensitive paths, deps, CI) + reading order | Read-only    |
| `list_review_queue` | Open PRs awaiting your review, oldest first, with age and size label (XS–XL); paginated                  | Read-only    |

Every tool publishes an input **and** output JSON Schema, returns `structuredContent`, and carries
annotations (`readOnlyHint`, `openWorldHint`, …) so hosts can auto-approve safe calls.

PRs can be referenced as `https://github.com/owner/repo/pull/123` or `owner/repo#123`.

## Quick start

**Requirements:** Node.js 22+ and a GitHub token.

1. **Create a token.** A [fine-grained PAT](https://github.com/settings/personal-access-tokens) with
   **read-only** access to _Pull requests_, _Contents_, _Commit statuses_, _Checks_ and _Metadata_ on
   the repositories you review. (A classic token with `repo` scope also works.) If you use the GitHub
   CLI, `gh auth token` prints one.

2. **Build** (until the package is published to npm):

   ```bash
   git clone <this repo> devflow-mcp && cd devflow-mcp
   npm ci && npm run build
   ```

3. **Add it to your MCP host.**

   **Claude Code**

   ```bash
   claude mcp add devflow --env GITHUB_TOKEN=$(gh auth token) -- node /absolute/path/to/devflow-mcp/dist/index.js
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

| Variable                  | Required | Default                  | Description                                                                |
| ------------------------- | -------- | ------------------------ | -------------------------------------------------------------------------- |
| `GITHUB_TOKEN`            | yes      | —                        | GitHub token used for all API calls                                        |
| `GITHUB_API_URL`          | no       | `https://api.github.com` | GitHub Enterprise Server API URL, e.g. `https://github.example.com/api/v3` |
| `DEVFLOW_LOG_LEVEL`       | no       | `info`                   | `trace` `debug` `info` `warn` `error` `fatal` `silent`. Logs go to stderr. |
| `DEVFLOW_SENSITIVE_PATHS` | no       | —                        | Extra comma-separated globs `analyze_pr_risk` treats as sensitive          |

## Security

- **Read-only by design** in this version: no tool can modify GitHub.
- **Least privilege:** use a fine-grained, read-only token scoped to the repos you need.
- **Secrets stay in env vars:** never in files or logs (the logger redacts token fields).
- **Untrusted content:** PR titles, descriptions and file names are written by PR authors. Tool
  descriptions and server instructions tell the model to treat them as data, not instructions
  (prompt-injection awareness). Descriptions are also truncated to 4,000 characters.
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
GITHUB_TOKEN=$(gh auth token) npm run smoke -- owner/repo#123   # live end-to-end check
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the code is organised and why.

## License

[MIT](LICENSE)
