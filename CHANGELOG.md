# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-28

Published as a Claude Code plugin. See Decisions.md D39–D40.

### Added

- **Claude Code plugin marketplace.** The repository is now a marketplace
  (`.claude-plugin/marketplace.json`) holding one plugin, `plugins/devflow/`. Install it with
  `/plugin install devflow --marketplace Kaushal-SF/devflow-mcp` — no clone and no build, because
  the plugin carries the bundled server.
- **Plugin commands** `/devflow:review-pr`, `/devflow:standup` and `/devflow:release-notes`, which
  run the existing tasks under a shorter name than the MCP prompts allow.
- `npm run plugin` restages the plugin's server from the current build, and `npm run verify:plugin`
  fails if the committed copy is out of date. CI runs the second.

### Changed

- **The repository moved to `Kaushal-SF/devflow-mcp`** (from `MCP_Demo`). GitHub redirects the old
  URL, so existing clones keep working.
- The README leads with the plugin install for Claude Code; other hosts still install from source.

## [1.0.0] - 2026-10-21

First complete release: simple to install, simple to demo. See Decisions.md D35–D38.

### Added

- Zero-config sign-in: without `GITHUB_TOKEN`, DevFlow uses the GitHub CLI login (`gh auth token`).
- One-click Claude Desktop installer (`npm run bundle` → `build/devflow.mcpb`).
- [DEMO.md](DEMO.md): a 5-minute demo script with preparation, fixes and common questions.

### Changed

- **Package renamed to `devflow-pr-mcp`** (the name `devflow-mcp` is taken on npm). The command is
  still `devflow-mcp`, and the server name is unchanged.
- The build is one self-contained file with every dependency bundled, so the package has no
  runtime dependencies and `npx` starts it without installing anything.
- `GITHUB_TOKEN` is optional.
- README rewritten around a two-minute install, with a **Test it** section (public-PR checks with
  expected results), per-host slash-command names, and troubleshooting.
- Scope: read-only and local by design. The planned write tool and remote HTTP deployment were
  dropped (D35).

### Removed

- The `--transport` option and `DEVFLOW_TRANSPORT` (stdio is the only transport).

### Fixed

- GitHub's secondary rate limit was reported as `[FORBIDDEN]` ("the token may lack the required
  permission"); it is now `[RATE_LIMITED]` with how long to wait. (Found by the live smoke test.)
- An invalid `DEVFLOW_LOG_LEVEL` now names the variable in the startup error.

## [0.2.0] - 2026-10-21

### Added

- `get_pr_diff` tool: unified-diff patches for chosen paths or globs within a character budget.
- `get_my_activity` tool: PRs merged, in progress and reviewed over the last N days, plus pending reviews.
- `generate_release_notes` tool: PRs merged between tags, branches, SHAs or dates, grouped by type,
  with breaking changes, contributors and ready-to-paste Markdown.
- Resources: `devflow://checklists/{name}` (bundled `general`, `react`, `node`, `security`
  checklists, replaceable via `DEVFLOW_CHECKLISTS_DIR`) and `devflow://repos/{owner}/{repo}/guidelines`.
- Prompts: `/review-pr`, `/standup-summary`, `/release-notes`, with argument completion (the `pr`
  argument suggests your pending reviews).
- Server logs are forwarded to hosts as MCP log notifications (default `warning`, honours
  `logging/setLevel`).

### Changed

- Every tool result is now parsed through its output schema before sending, so undeclared fields
  are dropped and broken results become `[INTERNAL]` errors.
- The live smoke script exercises every tool, resource, prompt and completion, and exits non-zero
  on any failure.

### Fixed

- `list_review_queue` could include fields not declared in its output schema, which strict MCP
  clients reject. (Found by the live smoke test before release.)

## [0.1.0] - 2026-10-15

### Added

- `get_pr_context` tool: PR metadata, changed files, CI check summary and linked issues in one call.
- `analyze_pr_risk` tool: explainable 0–100 risk score from deterministic heuristics.
- `list_review_queue` tool: paginated, oldest-first list of PRs awaiting your review, with size labels.
- stdio transport, zod-validated configuration, stderr JSON logging, actionable GitHub error mapping.
- GitHub Enterprise Server support via `GITHUB_API_URL`.
- Unit, msw-backed adapter, and in-memory MCP integration tests; live `npm run smoke` script; CI workflow.
