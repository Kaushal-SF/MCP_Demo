# Progress Log: DevFlow MCP

Progress for the yearly goal **"MCP – AI-Powered Development"**, tracked milestone by milestone.
Each milestone ends with verification, an update to this file, and a git commit.

## Goal → milestone map

| Sub-goal                                            | Covered by                                                                                                             | Status                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1. Understand MCP fundamentals & architecture       | [ARCHITECTURE.md](ARCHITECTURE.md), [Flow.md](Flow.md), [Decisions.md](Decisions.md), learning notes in each milestone | 🟡 In progress              |
| 2. Practical MCP server implementation & deployment | Milestones 1–5 below                                                                                                   | 🟡 In progress              |
| 3. Integrate MCP with real workflow                 | Daily use in Claude Code / VS Code after M2; feedback round                                                            | 🟢 Ready to start (M2 done) |
| 4. Reinforcement & validation                       | Security review, evals, metrics, demo                                                                                  | ⚪ Not started              |

## Milestones (Sub-goal 2)

| #   | Milestone                                                                                                                                                                   | Status               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| M1  | Scaffold, core infrastructure, stdio transport, 3 read-only tools, tests, CI, docs                                                                                          | ✅ Done (2026-10-15) |
| M2  | Resources (review checklists, repo guidelines), prompts (`review-pr`, `standup-summary`, `release-notes`), `generate_release_notes` tool, argument completions, MCP logging | ✅ Done (2026-10-21) |
| M3  | `post_review_comment` write tool behind `DEVFLOW_ENABLE_WRITE`, with elicitation-based confirmation                                                                         | ⏭ Next               |
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
  (layers, request lifecycle, testing strategy), this log, CHANGELOG, LICENSE.
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

## Docs & code-clarity pass (2026-10-16)

Requested after M1 review: record _why_, not just _what_, and make execution easy to follow.

- **[Decisions.md](Decisions.md):** 24 decision records (context → options → decision → why →
  trade-offs → revisit when), with an index and rules for adding or superseding entries. It
  replaces the short decisions table that used to live in ARCHITECTURE.md.
- **[Flow.md](Flow.md):** startup, handshake, the shared `tools/call` pipeline, a trace for each
  tool, 10 error paths, shutdown, test wiring, API calls per tool, and a caller/callee function
  index. All 7 Mermaid diagrams were validated with the Mermaid parser.
- **Explicit comments:** 48 _why_-comments added across 18 source files. They explain ordering,
  limits, caching, weights, error choices and N+1 trade-offs, and cite Decisions.md IDs where
  relevant. A misleading comment about Octokit logging to stdout was corrected (it logs to
  stderr; we silence it for structure, not safety).
- **Verification:** lint, typecheck and format clean; 102/102 tests passing. No behaviour changes.

---

## M2: Resources, prompts, release notes, logging ✅

**Date:** 2026-10-21 · **Version:** 0.2.0

### What was built

- **3 new tools** (6 in total):
  - `get_pr_diff`: unified-diff patches for chosen paths or globs within a character budget.
    Generated files are skipped unless named, and anything left out is listed with a reason.
    _Added beyond the plan:_ without it `/review-pr` could see which files changed but not the
    code (Decisions D25).
  - `get_my_activity`: PRs merged, in progress and reviewed over N days, plus pending review
    requests. _Added beyond the plan:_ the stand-up prompt needed a data source (D26).
  - `generate_release_notes`: tag, branch, SHA or date range; groups by conventional-commit
    type, then labels; breaking changes first; contributors; ready-to-paste Markdown (D29).
- **2 resource templates:**
  - `devflow://checklists/{name}`: 4 bundled Markdown checklists (`general`, `react`, `node`,
    `security`), listed, autocompleted, and replaceable with `DEVFLOW_CHECKLISTS_DIR` (D27).
  - `devflow://repos/{owner}/{repo}/guidelines`: CONTRIBUTING plus PR template, found by probing
    9 paths in parallel (D33).
- **3 prompts:** `/review-pr` (embeds the chosen checklist), `/standup-summary`, `/release-notes`.
  They orchestrate tools rather than pre-fetching data (D30).
- **Argument completion:** `/review-pr`'s `pr` suggests the PRs waiting for your review (cached
  60 s, D31); checklists, repos and days also autocomplete.
- **MCP logging bridge:** log lines reach the host as `notifications/message`, at `warning` by
  default and following `logging/setLevel`, with stack traces stripped (D28).
- **Plumbing:** `ServerContext` replaces `ToolContext`. `runRequest()` gives resources and prompts
  consistent JSON-RPC errors (D32). The GitHub client gained `getCommit`, `getFileText`,
  `searchPullRequests` and optional patches.
- **Docs:** Decisions D25–D34; Flow.md rewritten (18 sections, 15 validated diagrams, including the
  full `/review-pr` journey); ARCHITECTURE, README (with a _Try it_ section and the real clone URL),
  CHANGELOG, `.env.example`, `checklists/README.md`.

### Verification results

| Check                                                      | Result                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| lint / typecheck / format                                  | ✅ clean                                                                                                           |
| `npm test`                                                 | ✅ 155 tests in 8 files (up from 102)                                                                              |
| Coverage                                                   | ✅ 98.7% lines, 86.7% branches                                                                                     |
| Build + `--version`                                        | ✅ `devflow-mcp 0.2.0`                                                                                             |
| Live smoke (`npm run smoke`): all 6 tools                  | ✅ all OK against real GitHub                                                                                      |
| Live: resources                                            | ✅ 4 checklists listed; `react` read; `typescript-sdk` guidelines found (`CONTRIBUTING.md`, truncated at 8k chars) |
| Live: `/review-pr` prompt + `pr` completion                | ✅ text + embedded resource; completion offered the 4 real pending reviews                                         |
| Live: release notes, tag range `v2.2.0 → v2.3.0`           | ✅ 30 PRs, refs resolved to commit dates, grouped by scope and type                                                |
| Path-traversal attempt `devflow://checklists/..%2Fsecrets` | ✅ rejected with -32602 before touching the file system                                                            |

### A bug the live test caught (and what changed because of it)

The first live smoke run failed on `list_review_queue`: the real SDK client rejected the output with
_"must NOT have additional properties"_.

- **Cause:** `searchReviewRequests` was rebuilt on the richer general search, and the review queue
  spread `...item` into its output, adding 4 undeclared fields.
- **Why the server didn't catch it:** the SDK's server-side check ignores unknown keys, but the
  published JSON Schema has `additionalProperties: false`, and clients enforce that.
- **Why the tests didn't catch it:**
  1. The fake client still returned the old, narrow shape.
  2. The SDK client only validates output for tools it has _listed_, and the integration test never
     called `tools/list`.
- **Fixes:**
  1. The review queue copies fields explicitly.
  2. `runTool()` now parses every result through the tool's output schema, so undeclared fields are
     impossible (D34).
  3. The fake mirrors the real client.
  4. Integration tests call `tools/list` first, like a real host.
  5. There are regression tests for both stripping and the `[INTERNAL]` error on a broken result.

### Learnings (Sub-goal 1)

- **Resources vs tools vs prompts** in practice: tools are for live data the model fetches;
  resources are for reference text someone attaches; prompts are user-chosen playbooks. Picking the
  right primitive made each feature simpler.
- **Prompt arguments are always strings.** Numbers (like `days`) must be parsed and validated in
  the callback.
- **Resource templates:** a `list` callback makes concrete instances show up in `resources/list`,
  and `complete` powers variable completion. The SDK enables `completions` automatically.
- **Logging:** until a host calls `logging/setLevel`, the SDK forwards _everything_, and it keeps
  the chosen level private. Owning that handler was the clean way to have a sensible default.
- **Schema strictness differs by side.** zod on the server ignores extra keys; the JSON Schema
  clients use does not. Always test the way a real host behaves.
- The GitHub search `merged:A..B` range and second-precision timestamps work well for release
  windows; milliseconds break the qualifier.

### Observations to act on later

- **Bot authors** (e.g. `claude[bot]`) appear in release-note lines but are excluded from
  Contributors. Revisit if teams want to credit bots or hide their PRs.
- **"Reviewed"** in `get_my_activity` is approximate (D26).
- **Risk heuristic tuning** from M1 (docs/scripts counted as production code) is still open. It's
  best done with real team PRs in Sub-goal 3.

### How to try it

```bash
npm ci && npm run build
GITHUB_TOKEN=$(gh auth token) npm run smoke -- owner/repo#123 v1.0.0
claude mcp add devflow --env GITHUB_TOKEN=$(gh auth token) -- node "$PWD/dist/index.js"
# then in Claude Code: /review-pr  (pick a PR from the suggestions)
```

---

## Next up: M3 (planned)

- [ ] `post_review_comment` tool, disabled unless `DEVFLOW_ENABLE_WRITE=true`, annotated as non-read-only
- [ ] Confirmation through MCP elicitation (with a safe fallback for hosts without elicitation)
- [ ] Least-privilege token guidance for write access; audit logging of every write
- [ ] Wire it into `/review-pr` as an optional final step ("post this comment?")
- [ ] Tests, smoke coverage (against a sandbox repo), docs and this log
