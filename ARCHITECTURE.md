# Architecture

> **Documentation map:** this file covers _structure_ (layers, folders, testing).
> [Flow.md](Flow.md) traces _execution_ through files and functions.
> [Decisions.md](Decisions.md) records _why_ each choice was made.

## Overview

```
 MCP host (Claude Code / Desktop / VS Code)
        │  JSON-RPC 2.0 over stdio   (local only, by design: Decisions.md D35)
        ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ transports/   stdio.ts: process wiring, graceful shutdown            │
 ├──────────────────────────────────────────────────────────────────────┤
 │ server.ts     McpServer: identity, instructions, capabilities;       │
 │               registers every tool, resource and prompt              │
 ├───────────────────────┬──────────────────────┬───────────────────────┤
 │ tools/  (6)           │ resources/  (2)      │ prompts/  (3)         │
 │ model-controlled      │ app/user-controlled  │ user-controlled       │
 │ actions; runTool()    │ reference material;  │ playbooks with arg    │
 │ → isError results     │ runRequest()         │ completion;           │
 │                       │ → JSON-RPC errors    │ runRequest()          │
 ├───────────────────────┴──────────────────────┴───────────────────────┤
 │ services/     business logic, no MCP knowledge                       │
 │   pr-context · risk-analyzer · pr-diff · review-queue · activity ·   │
 │   release-notes · repo-guidelines · checklists · suggestions         │
 ├──────────────────────────────────────────────────────────────────────┤
 │ clients/      GitHubClient interface (port) + OctokitGitHubClient    │
 └──────────────────────────────────────────────────────────────────────┘
        │  HTTPS (REST)                          checklists/*.md (local files)
        ▼
     GitHub API

 Cross-cutting (lib/): errors · logger + McpLogBridge (logs → notifications/message) ·
 tool-result · request-result · pr-ref · glob · pagination · package-root
```

Dependencies point **downwards only**. Services depend on the `GitHubClient` _interface_, so tests
inject `FakeGitHubClient` and a future GitLab or Jira adapter can be added without touching
services, tools, resources or prompts. Everything a registration needs arrives through one
`ServerContext` object (`src/context.ts`), built in `index.ts` or by tests.

**Which MCP primitive for what:**

| Primitive | Who decides to use it                   | DevFlow uses it for                                          |
| --------- | --------------------------------------- | ------------------------------------------------------------ |
| Tool      | The model, mid-conversation             | Fetching and analysing live GitHub data                      |
| Resource  | The user or host attaches it as context | Review checklists; a repo's contribution guidelines          |
| Prompt    | The user, typically as a slash-command  | `/review-pr`, `/standup-summary`, `/release-notes` playbooks |

## Directory layout

| Path                     | Responsibility                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `src/index.ts`           | Composition root: parse flags, load config, resolve the token, build dependencies, start stdio      |
| `src/config.ts`          | zod-validated env config; GitHub token from env or the `gh` CLI login (D36)                         |
| `src/context.ts`         | `ServerContext`: the dependency bundle passed to every registration                                 |
| `src/server.ts`          | `createServer(ctx)`: transport-agnostic server factory                                              |
| `src/transports/`        | stdio, the only transport (D35)                                                                     |
| `src/tools/`             | Tool registrations + `schemas.ts` (input/output schemas, compile-time drift checks)                 |
| `src/resources/`         | Resource-template registrations (checklists, repo guidelines)                                       |
| `src/prompts/`           | Prompt registrations with argument completion                                                       |
| `src/services/`          | Business logic: context, risk, diff, queue, activity, release notes, guidelines, checklists         |
| `src/clients/github.ts`  | Domain types, `GitHubClient` port, Octokit adapter, HTTP error mapping                              |
| `src/lib/`               | Cross-cutting helpers (see diagram)                                                                 |
| `checklists/`            | Bundled review checklists (Markdown); replaceable via `DEVFLOW_CHECKLISTS_DIR`                      |
| `test/unit/`             | Services, lib, log bridge, and the Octokit adapter (against msw-mocked HTTP)                        |
| `test/integration/`      | Real MCP `Client` ↔ server over `InMemoryTransport`: tools, resources, prompts, completion, logging |
| `scripts/smoke.ts`       | Live end-to-end check: spawns `dist/index.js` over stdio and exercises every capability             |
| `scripts/bundle.ts`      | Builds the Claude Desktop installer `build/devflow.mcpb` from `manifest.json` (D38)                 |
| `scripts/sync-plugin.ts` | Restages the Claude Code plugin under `plugins/devflow/server/` and validates it (D39)              |
| `.claude-plugin/`        | Marketplace manifest listing the plugins this repository publishes (D39)                            |
| `plugins/devflow/`       | The Claude Code plugin: manifest, `/devflow:*` commands (D40) and the bundled server                |
| `manifest.json`          | MCP Bundle manifest: how Claude Desktop starts DevFlow and which settings it asks for               |

## Request lifecycle (`tools/call`)

Summary below; the step-by-step trace with diagrams for every tool and error path is in
[Flow.md](Flow.md).

1. The host sends `tools/call` with `{ name, arguments }`.
2. The SDK validates `arguments` against the tool's zod input schema. Invalid input becomes an
   `isError` result before our code runs.
3. The tool handler parses the PR reference and calls a service inside `runTool()`.
4. The service calls `GitHubClient`. The Octokit adapter maps raw API JSON to domain types and
   HTTP failures to `DevflowError`s (`NOT_FOUND`, `RATE_LIMITED`, …) with actionable messages.
5. `runTool()` parses the result with the tool's output schema (dropping undeclared fields),
   then returns `structuredContent` plus the same JSON as text.
6. On failure, `runTool()` returns `isError: true` with `[CODE] message`. Unknown errors become a
   generic `[INTERNAL]` message, with full details logged to stderr.

## Key decisions

Every significant choice, with the alternatives considered, the reasoning and the trade-offs, is
recorded in **[Decisions.md](Decisions.md)** (D1–D38). Highlights:

- Few task-shaped tools instead of API wrappers (D4)
- Structured output with drift-checked schemas (D6, D7)
- Failures as `isError` results with codes (D8)
- Ports & adapters for GitHub (D9)
- Deterministic risk heuristics (D12)
- Untrusted-content handling (D13)
- stderr-only logging, bridged to MCP notifications at a host-chosen level (D14, D28)
- Prompts orchestrate tools rather than pre-fetching (D30)
- Every tool result is parsed through its own output schema before sending (D34)
- A simple, local, read-only v1 (D35), zero-config sign-in through the GitHub CLI (D36), one
  self-contained file (D37) and a one-click Claude Desktop installer (D38)

## Build and delivery

`npm run build` bundles the server and **all** its dependencies into one file, `dist/index.js`
(D37). The same file is used three ways:

| Channel        | How users get it                                               | Built by                      |
| -------------- | -------------------------------------------------------------- | ----------------------------- |
| Claude Code    | `/plugin install devflow --marketplace Kaushal-SF/devflow-mcp` | `npm run plugin` → `plugins/` |
| Claude Desktop | Double-click `devflow.mcpb`                                    | `npm run bundle` → `build/`   |
| From source    | `node /path/to/dist/index.js`                                  | `npm run build`               |
| npm            | `npx -y devflow-pr-mcp` (not published; see D39)               | `npm publish` runs the build  |

The Claude Code plugin is the published route (D39). Because a plugin is delivered by cloning this
repository, the plugin carries its own copy of the bundled server under `plugins/devflow/server/`,
which `npm run plugin` restages and CI checks for staleness.

## Testing strategy

| Layer          | How                                        | What it proves                                                     |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| lib / services | Vitest + `FakeGitHubClient`                | Business rules, edge cases, pagination, graceful degradation       |
| GitHub adapter | Vitest + **msw** mocking `api.github.com`  | Real Octokit requests, response mapping, error mapping, pagination |
| MCP contract   | Real SDK `Client` over `InMemoryTransport` | Registration, schemas, annotations, output validation, error shape |
| Live           | `npm run smoke` (stdio, real GitHub)       | The built artifact works end-to-end like a real host would use it  |
| Manual         | `npm run inspect` (MCP Inspector)          | Visual check of tools, schemas and responses                       |

Coverage thresholds (enforced in CI): lines/functions/statements 80%, branches 70%.
