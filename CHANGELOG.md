# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-15

### Added

- `get_pr_context` tool: PR metadata, changed files, CI check summary and linked issues in one call.
- `analyze_pr_risk` tool: explainable 0–100 risk score from deterministic heuristics.
- `list_review_queue` tool: paginated, oldest-first list of PRs awaiting your review, with size labels.
- stdio transport, zod-validated configuration, stderr JSON logging, actionable GitHub error mapping.
- GitHub Enterprise Server support via `GITHUB_API_URL`.
- Unit, msw-backed adapter, and in-memory MCP integration tests; live `npm run smoke` script; CI workflow.
