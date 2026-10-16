# Architecture

> **Documentation map:** this file covers _structure_ (layers, folders, testing).
> [Flow.md](Flow.md) traces _execution_ through files and functions.
> [Decisions.md](Decisions.md) records _why_ each choice was made.

## Overview

```
 MCP host (Claude Code / Desktop / VS Code)
        │  JSON-RPC 2.0 over stdio   (Streamable HTTP planned, Milestone 3)
        ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ transports/      stdio.ts: process wiring, graceful shutdown │
 ├──────────────────────────────────────────────────────────────┤
 │ server.ts        McpServer: identity, instructions,          │
 │                  capabilities, registers tools               │
 ├──────────────────────────────────────────────────────────────┤
 │ tools/           one file per tool: input/output schemas,    │
 │                  annotations, LLM-facing description         │
 │                  → calls a service inside runTool()          │
 ├──────────────────────────────────────────────────────────────┤
 │ services/        business logic, no MCP knowledge            │
 │                  pr-context · risk-analyzer · review-queue   │
 ├──────────────────────────────────────────────────────────────┤
 │ clients/         GitHubClient interface (port) +             │
 │                  OctokitGitHubClient (adapter)               │
 └──────────────────────────────────────────────────────────────┘
        │  HTTPS (REST)
        ▼
     GitHub API
```

Dependencies point **downwards only**. Services depend on the `GitHubClient` _interface_, so tests
inject `FakeGitHubClient` and a future GitLab or Jira adapter can be added without touching
services or tools.

## Directory layout

| Path                    | Responsibility                                                                    |
| ----------------------- | --------------------------------------------------------------------------------- |
| `src/index.ts`          | CLI entry: parse flags, load config, build dependencies, start transport          |
| `src/config.ts`         | zod-validated env config; fails fast with a readable message                      |
| `src/server.ts`         | `createServer(ctx)`: transport-agnostic server factory                            |
| `src/transports/`       | stdio now; HTTP later                                                             |
| `src/tools/`            | MCP tool registrations + `schemas.ts` (input/output schemas, drift checks)        |
| `src/services/`         | Pure-ish logic: context gathering, risk heuristics, review queue                  |
| `src/clients/github.ts` | Domain types, `GitHubClient` port, Octokit adapter, HTTP error mapping            |
| `src/lib/`              | Cross-cutting: errors, logger, tool-result wrapper, PR-ref parsing, glob, cursors |
| `test/unit/`            | Services, lib, and the Octokit adapter (against msw-mocked HTTP)                  |
| `test/integration/`     | Real MCP `Client` ↔ server over `InMemoryTransport`                               |
| `scripts/smoke.ts`      | Live end-to-end check: spawns `dist/index.js` over stdio and calls each tool      |

## Request lifecycle (`tools/call`)

Summary below; the step-by-step trace with diagrams for every tool and error path is in
[Flow.md](Flow.md).

1. The host sends `tools/call` with `{ name, arguments }`.
2. The SDK validates `arguments` against the tool's zod input schema. Invalid input becomes an
   `isError` result before our code runs.
3. The tool handler parses the PR reference and calls a service inside `runTool()`.
4. The service calls `GitHubClient`. The Octokit adapter maps raw API JSON to domain types and
   HTTP failures to `DevflowError`s (`NOT_FOUND`, `RATE_LIMITED`, …) with actionable messages.
5. `runTool()` returns `structuredContent` plus the same JSON as text. The SDK validates
   `structuredContent` against the published `outputSchema`.
6. On failure, `runTool()` returns `isError: true` with `[CODE] message`. Unknown errors become a
   generic `[INTERNAL]` message, with full details logged to stderr.

## Key decisions

Every significant choice, with the alternatives considered, the reasoning and the trade-offs, is
recorded in **[Decisions.md](Decisions.md)** (D1–D24). Highlights:

- Few task-shaped tools instead of API wrappers (D4)
- Structured output with drift-checked schemas (D6, D7)
- Failures as `isError` results with codes (D8)
- Ports & adapters for GitHub (D9)
- Deterministic risk heuristics (D12)
- Untrusted-content handling (D13)
- stderr-only logging (D14)

## Testing strategy

| Layer          | How                                        | What it proves                                                     |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| lib / services | Vitest + `FakeGitHubClient`                | Business rules, edge cases, pagination, graceful degradation       |
| GitHub adapter | Vitest + **msw** mocking `api.github.com`  | Real Octokit requests, response mapping, error mapping, pagination |
| MCP contract   | Real SDK `Client` over `InMemoryTransport` | Registration, schemas, annotations, output validation, error shape |
| Live           | `npm run smoke` (stdio, real GitHub)       | The built artifact works end-to-end like a real host would use it  |
| Manual         | `npm run inspect` (MCP Inspector)          | Visual check of tools, schemas and responses                       |

Coverage thresholds (enforced in CI): lines/functions/statements 80%, branches 70%.
