# Progress Log: DevFlow MCP

Progress for the yearly goal **"MCP – AI-Powered Development"**, tracked milestone by milestone.
Each milestone ends with verification, an update to this file, and a git commit.

## Goal → milestone map

| Sub-goal                                            | Covered by                                                                                                             | Status                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1. Understand MCP fundamentals & architecture       | [ARCHITECTURE.md](ARCHITECTURE.md), [Flow.md](Flow.md), [Decisions.md](Decisions.md), learning notes in each milestone | 🟡 In progress                      |
| 2. Practical MCP server implementation & deployment | M1–M3 below: v1.0.0, packaged for npm and Claude Desktop                                                               | ✅ Done (publishing is one command) |
| 3. Integrate MCP with real workflow                 | Daily use on real PRs, a real release, stand-ups; teammates install it                                                 | 🟢 Ready to start                   |
| 4. Reinforcement & validation                       | Present with DEMO.md; short write-up of time saved and feedback                                                        | ⚪ After Sub-goal 3                 |

## Milestones (Sub-goal 2)

| #      | Milestone                                                                                                                                                                   | Status                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| M1     | Scaffold, core infrastructure, stdio transport, 3 read-only tools, tests, CI, docs                                                                                          | ✅ Done (2026-10-15)        |
| M2     | Resources (review checklists, repo guidelines), prompts (`review-pr`, `standup-summary`, `release-notes`), `generate_release_notes` tool, argument completions, MCP logging | ✅ Done (2026-10-21)        |
| M3     | Simplify and ship v1.0: zero-config sign-in, single-file build, Claude Desktop installer, demo script                                                                       | ✅ Done (2026-10-21)        |
| M4     | Publish v1.1: Claude Code plugin marketplace, `/devflow:*` commands, repo renamed to `devflow-mcp`                                                                          | ✅ Done (2026-10-28)        |
| ~~M4~~ | ~~Streamable HTTP + OAuth, Docker, cloud deployment~~                                                                                                                       | ❌ Dropped (D35)            |
| ~~M5~~ | ~~Changesets, registry listing~~; npm publish kept as a one-command step                                                                                                    | ❌ Dropped / folded into M3 |

> Scope change (2026-10-15): **Jira integration deferred** by decision; GitHub only for now. The
> `GitHubClient` port leaves room for a `TrackerAdapter` (Jira/Linear) later.
>
> Scope change (2026-10-21): the owner asked for **"one simple and complete application"** that is
> easy to present and that others can use with minimal effort. The write tool (old M3) and the
> remote deployment (old M4) were dropped; the effort went into installation instead. See
> [Decisions.md D35](Decisions.md#d35-a-simple-local-read-only-v1).

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

## M3: Simplify and ship v1.0 ✅

**Date:** 2026-10-21 · **Version:** 1.0.0

### Why this milestone changed

After M2 the remaining plan (write tool, OAuth server, Docker, cloud hosting, release tooling) added
features and setup steps, while the owner's goal is a product that is easy to present and adopt.
This milestone removes setup instead of adding features. The full reasoning is in D35.

### What was built

- **Zero-config sign-in (D36):** `GITHUB_TOKEN` is optional; DevFlow falls back to
  `gh auth token`, trying the PATH and the usual install locations (desktop apps start servers with
  a minimal PATH). If both are missing, the startup error names both fixes.
- **One self-contained file (D37):** tsup bundles every dependency into `dist/index.js` (1.7 MB).
  The npm package has no runtime dependencies, so `npx` starts it without installing anything.
- **Claude Desktop installer (D38):** `manifest.json` + `npm run bundle` → `build/devflow.mcpb`
  (316 kB). Double-click to install; an optional token field, blank by default.
- **Package renamed to `devflow-pr-mcp`:** `devflow-mcp` is taken on npm by an unrelated project.
- **Simplified code:** removed the `--transport` flag and `DEVFLOW_TRANSPORT`.
- **Docs:** README rewritten around a two-minute install for each host; new [DEMO.md](DEMO.md)
  (5-minute script, preparation, troubleshooting, common questions); Decisions D35–D38 (D3 and D5
  marked superseded); Flow.md startup and error paths; ARCHITECTURE build-and-delivery section;
  CHANGELOG 1.0.0.

### Verification results

| Check                                                   | Result                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| lint / typecheck / format                               | ✅ clean                                                                 |
| `npm test`                                              | ✅ 162 tests (up from 155): token resolution, secondary rate limit       |
| Coverage                                                | ✅ 97.5% lines, 86.5% branches                                           |
| Bundled file run alone (no `node_modules` beside it)    | ✅ handshake, checklist read, live `get_my_activity`                     |
| Live smoke **without `GITHUB_TOKEN`** (token from `gh`) | ✅ all 6 tools, both resources, prompt and completion                    |
| `npm pack` → `npx` from an empty folder                 | ✅ starts in 1.3 s; 9 files, 317 kB                                      |
| `.mcpb` manifest validation and unpacked contents       | ✅ valid; 9 files, layout correct                                        |
| Bad config / no login                                   | ✅ clear startup messages naming the variable or the two ways to sign in |

### Tested in a real host (2026-10-22)

DevFlow was loaded into real Claude Code sessions (`claude -p --mcp-config … --strict-mcp-config`,
so the user's own setup was untouched), and the README's test steps were run exactly as written:

| Step                                                                     | Result                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| _"How risky is modelcontextprotocol/typescript-sdk#2968?"_               | ✅ Claude chose `get_pr_context` + `analyze_pr_risk`; 70/100 with files to read first           |
| `/mcp__devflow__review-pr modelcontextprotocol/typescript-sdk#2968 node` | ✅ context → risk → diff → checklist resource; a full review with specific, line-level findings |
| `/mcp__devflow__standup-summary 3`                                       | ✅ Yesterday / Today / Blockers from the real review queue                                      |
| _"Show me the react review checklist from devflow"_                      | ✅ resource read, 21 items                                                                      |

What it changed in the docs:

- **Slash-command names were wrong.** Hosts prefix MCP prompts: Claude Code uses
  `/mcp__devflow__review-pr`, VS Code `/mcp.devflow.review-pr`, Claude Desktop the **+** menu. The
  README and DEMO.md said `/review-pr`. Fixed, with a per-host table.
- **The suggested first check proved nothing for many users.** _"What's in my review queue?"_ is
  empty for anyone with no pending reviews. The README now has a **Test it** section using a public
  PR with the expected result, plus connection checks per host, the MCP Inspector, and a
  troubleshooting table.
- The README install now shows both paths side by side for each host: from npm (after publishing)
  and from source (works today).

### Bugs found and fixed

- **Secondary rate limit misreported (found by the live smoke test).** A burst of searches tripped
  GitHub's secondary limit (403 with `retry-after`, quota still above zero). DevFlow reported
  `[FORBIDDEN] … the token may lack the required permission`, which would send a user to check token
  settings for nothing. Now `[RATE_LIMITED] … Wait 60 seconds`, with a regression test.
- **Invalid `DEVFLOW_LOG_LEVEL` didn't name the variable** (found by a new unit test).

### Learnings (Sub-goal 1)

- **MCP Bundles (`.mcpb`)** are the Claude Desktop install format: a zip with `manifest.json`, the
  server, and `user_config` fields that Desktop shows as a settings form and passes as env vars.
- **Desktop apps don't inherit your shell.** A server started by Claude Desktop sees a minimal PATH
  and none of your shell's variables, so anything found through the shell (like `gh`, or a
  `GH_TOKEN` exported in `.zshrc`) must be looked up explicitly or configured.
- **The MCP Inspector strips the environment too** (2026-10-23, reported by the owner): it passes
  only `HOME`, `PATH`, `USER`, `SHELL`, `TERM` and `LOGNAME` to a stdio server, so a `GH_TOKEN` from
  the shell never arrived and DevFlow correctly refused to start. `npm run inspect` now forwards
  `GITHUB_TOKEN`/`GH_TOKEN` with the Inspector's `-e` option and pins Inspector 2.12.0; the README
  explains it. A real `gh auth login` avoids the issue in every host.
- **Bundling a stdio server** is the norm for fast `npx` starts; CommonJS dependencies inside an ES
  module bundle need a `require` provided through `createRequire`.

### Notes for the demo machine

- On this laptop the GitHub CLI is **not** signed in; `gh` works in the terminal only because the
  shell exports `GH_TOKEN`. Claude Code started from the terminal inherits it, so it works. Claude
  Desktop does not; run `gh auth login` once, or paste a token into the install dialog.
- `npm audit` reports one low-severity issue in esbuild (dev-server file read on Windows). It is a
  build-time tool pinned by tsup, its dev server is never used, and it does not ship in the package.

---

## M4 — Publish as a Claude Code plugin (2026-10-28)

### What was built

- **The repository is now a plugin marketplace.** `.claude-plugin/marketplace.json` lists one
  plugin, `plugins/devflow/`, so anyone can run
  `/plugin install devflow --marketplace Kaushal-SF/devflow-mcp`. No clone, no build, no npm
  account: the plugin carries the bundled server under `plugins/devflow/server/` (D39).
- **Three plugin commands** (D40): `/devflow:review-pr`, `/devflow:standup`,
  `/devflow:release-notes`. Through a plugin, Claude Code names an MCP prompt after its server, so
  `review-pr` would otherwise have been `/mcp__plugin_devflow_devflow__review-pr`.
- **`npm run plugin`** restages the server and validates the marketplace; **`npm run verify:plugin`**
  fails when the committed copy is stale, and CI runs it.
- **The repository was renamed** `MCP_Demo` → `devflow-mcp`, and every URL in the docs followed.

### Verification

| Check                                                     | Result                                             |
| --------------------------------------------------------- | -------------------------------------------------- |
| `claude plugin validate .`                                | ✅ Validation passed                               |
| `claude plugin marketplace add` + `claude plugin install` | ✅ Installed as `devflow@devflow-mcp` (user scope) |
| `claude mcp list`                                         | ✅ `plugin:devflow:devflow` Connected              |
| Real query, no token configured                           | ✅ risk 70 / high — the `gh` login was picked up   |
| `/devflow:standup 7` in a real session                    | ✅ Yesterday / Today / Blockers, no invented work  |
| lint, format, typecheck, 162 tests                        | ✅ all pass                                        |

### Learnings

- **A plugin is delivered by cloning the marketplace repository**, so anything the server needs has
  to be committed. With DevFlow not on npm, that meant committing the 1.7 MB bundle — hence the
  staleness check, which is the real risk of a committed build artifact.
- **MCP prompt names are not controllable from a plugin.** The server prefix
  (`plugin:<plugin>:<server>`) is baked into the slash command, which is why D40 adds commands.
- **An unset optional `userConfig` value does not reach the server as a literal placeholder.**
  DevFlow's blank-means-unset handling (written for Claude Desktop) covered it unchanged.
- **`claude plugin marketplace add .` is rejected**; the source must be `owner/repo`, a URL, or a
  path with a `./` or absolute prefix.

---

## What's left

The application is complete. What remains is release and real use:

**To release (needs the owner):**

- [x] Push the commits to `Kaushal-SF/devflow-mcp` (repo renamed from `MCP_Demo` on 2026-10-28).
- [x] Publish as a Claude Code plugin marketplace (D39). Anyone can now run
      `/plugin install devflow --marketplace Kaushal-SF/devflow-mcp`.
- [ ] `npm login`, then `npm publish` (makes `npx -y devflow-pr-mcp` work for everyone). Deferred
      deliberately: an npm name cannot be released again after 72 hours.
- [ ] Official MCP Registry listing — needs the npm publish first, and the registry is still in
      preview.
- [ ] Attach `build/devflow.mcpb` to a GitHub release, so Desktop users can download it.

**Sub-goal 3: integrate with the real workflow (2–4 weeks of use):**

- [ ] Use `/devflow:review-pr` on real trainee PRs for two weeks; note time per review before and
      after.
- [ ] Use `/devflow:release-notes` for one real release and `/devflow:standup` daily.
- [ ] Have 2–3 teammates install it; collect feedback.
- [ ] Tune the risk score with real PRs (it counts `docs/` and `scripts/` as production code today).

**Sub-goal 4: reinforcement and validation:**

- [ ] Present it with [DEMO.md](DEMO.md).
- [ ] Short write-up: time saved, adoption, what users asked for.
