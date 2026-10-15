# Progress Log: DevFlow MCP

Progress for the yearly goal **"MCP – AI-Powered Development"**, tracked milestone by milestone.
Each milestone ends with verification, an update to this file, and a git commit.

## Goal → milestone map

| Sub-goal                                            | Covered by                                                                         | Status         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------- |
| 1. Understand MCP fundamentals & architecture       | Design work + [ARCHITECTURE.md](ARCHITECTURE.md), learning notes in each milestone | 🟡 In progress |
| 2. Practical MCP server implementation & deployment | Milestones 1–5 below                                                               | 🟡 In progress |
| 3. Integrate MCP with real workflow                 | Daily use in Claude Code / VS Code after M2; feedback round                        | ⚪ Not started |
| 4. Reinforcement & validation                       | Security review, evals, metrics, demo                                              | ⚪ Not started |

## Milestones (Sub-goal 2)

| #   | Milestone                                                                                                                                                                   | Status               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| M1  | Scaffold, core infrastructure, stdio transport, 3 read-only tools, tests, CI, docs                                                                                          | ✅ Done (2026-10-15) |
| M2  | Resources (review checklists, repo guidelines), prompts (`review-pr`, `standup-summary`, `release-notes`), `generate_release_notes` tool, argument completions, MCP logging | ⏭ Next               |
| M3  | `post_review_comment` write tool behind `DEVFLOW_ENABLE_WRITE`, with elicitation-based confirmation                                                                         | ⚪ Planned           |
| M4  | Streamable HTTP transport + OAuth 2.1 resource server, Docker image, cloud deployment, `/healthz`                                                                           | ⚪ Planned           |
| M5  | Release engineering: Changesets, npm publish, v1.0.0, MCP registry listing                                                                                                  | ⚪ Planned           |

> Scope change (2026-10-15): **Jira integration deferred** by decision; GitHub only for now. The
> `GitHubClient` port leaves room for a `TrackerAdapter` (Jira/Linear) later.

---

## M1: Foundation + first read-only tools ✅

**Date:** 2026-10-15 · **Version:** 0.1.0

### What was built

- **Project setup:** TypeScript (strict + `noUncheckedIndexedAccess`), ESLint (`strictTypeChecked`,
  `no-console`), Prettier, Vitest + v8 coverage, tsup bundling to an executable `dist/index.js`,
  GitHub Actions CI (Node 22 & 24).
- **Core:** zod-validated env config, pino JSON logging to stderr with token redaction,
  `DevflowError` with GitHub HTTP → actionable error mapping (401/403/404/422/429/rate-limit),
  `runTool()` wrapper (structured output + `isError` handling), PR-reference parser (URL or
  `owner/repo#n`, GHES-compatible), dependency-free glob matcher, opaque pagination cursors.
- **GitHub adapter:** `GitHubClient` interface + `OctokitGitHubClient` (PR, paginated files,
  merged Checks API + commit-status CI summary, review-request search, cached login).
- **Tools:**
  - `get_pr_context`: PR metadata, files, CI summary, linked issues; description truncated at 4k chars.
  - `analyze_pr_risk`: 12 explained signals, score 0–100, level, stats, focus files.
  - `list_review_queue`: oldest-first queue with age + XS–XL size, paginated.
- **Server:** identity + title, `instructions` for the model (including the untrusted-content
  warning), `logging` capability, graceful shutdown on SIGINT/SIGTERM/stdin close.
- **Docs:** README (setup for Claude Code / Desktop / VS Code, config, security), ARCHITECTURE
  (layers, request lifecycle, 12 key decisions, testing strategy), this log, CHANGELOG, LICENSE.
- **Tooling:** `npm run smoke` (live stdio end-to-end check), `npm run inspect` (MCP Inspector).

### Verification results

| Check                                                                            | Result                                                                                              |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run lint` / `typecheck` / `format:check`                                    | ✅ clean                                                                                            |
| `npm test`                                                                       | ✅ 102 tests, 6 files                                                                               |
| Coverage                                                                         | ✅ 98.2% lines, 87.5% branches (thresholds 80/70)                                                   |
| `npm run build` + `node dist/index.js --version`                                 | ✅ `devflow-mcp 0.1.0`                                                                              |
| Missing token                                                                    | ✅ readable config error, exit code 1                                                               |
| Live smoke vs `modelcontextprotocol/typescript-sdk#2968` (22 files, ~3.9k lines) | ✅ all 3 tools OK; risk **70/high** (LARGE_CHANGE, MANY_FILES, NO_TEST_CHANGES, DEPENDENCY_CHANGES) |
| Live CI summary vs `…#3005`                                                      | ✅ 14 passed + 5 skipped, matches the PR's "14 checks pass"; `Fixes #3004` detected                 |
| Live error path (`…#999999`)                                                     | ✅ `[NOT_FOUND]` tool error with guidance, not a crash                                              |
| Live `list_review_queue`                                                         | ✅ returned 4 real pending review requests, with age and size                                       |

### Learnings (counts toward Sub-goal 1)

- **Spec version:** SDK 1.32.1 speaks protocol `2025-11-25` and still negotiates down to `2024-11-05`.
- **Use `registerTool`, not `tool()`:** `server.tool()` is deprecated. `registerTool` takes
  `inputSchema` + `outputSchema` + `annotations` in one config object.
- **The SDK enforces `outputSchema`:** a successful result without matching `structuredContent`
  is rejected. That's a useful guarantee, and it's why the drift checks exist.
- **Thrown errors in tools** are auto-wrapped by the SDK as `isError` results, but with the raw
  message. Our `runTool()` controls the message so internals don't leak.
- **stdio discipline:** anything on stdout that isn't JSON-RPC breaks the session. Octokit's
  default logger is silenced and CLI messages go to stderr.
- **Upcoming:** the TypeScript SDK has a v2 in progress (a v1→v2 migration guide appeared in the
  very PR used for the smoke test). Plan a migration milestone once v2 is stable.

### Observations to act on later

- **Heuristic tuning (Sub-goal 3):** in the live test, `docs/.vitepress/*.ts` and `scripts/*.ts`
  counted as "production code without tests". Consider treating `docs/`, `scripts/` and `examples/`
  as non-production, or making the classification configurable. Calibrate on real team PRs first.
- **Review-queue age** uses PR creation date, not when the review was requested (the search API
  doesn't expose that). That's acceptable for now; a timeline-API lookup could make it exact.
- **Stale review requests:** the live queue had PRs waiting 141–239 days. A `staleOnly` /
  `olderThanDays` filter could be a useful addition.

### How to try it

```bash
npm ci && npm run build
GITHUB_TOKEN=$(gh auth token) npm run smoke -- owner/repo#123
claude mcp add devflow --env GITHUB_TOKEN=$(gh auth token) -- node "$PWD/dist/index.js"
```

---

## Next up: M2 (planned)

- [ ] Resource template `devflow://checklists/{name}` serving bundled Markdown checklists (react, node, security, general)
- [ ] Resource template `devflow://repos/{owner}/{repo}/guidelines` (CONTRIBUTING.md + PR template)
- [ ] `generate_release_notes` tool: merged PRs between two tags/dates, grouped by conventional-commit type/label
- [ ] Prompts: `review-pr`, `release-notes`, `standup-summary`, with argument completions
- [ ] Bridge server logs to MCP `notifications/message` (respecting `logging/setLevel`)
- [ ] Tests + smoke coverage for all of the above; update docs and this log
