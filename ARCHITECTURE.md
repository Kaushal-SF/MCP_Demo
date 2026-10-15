# Architecture

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

| #   | Decision                                                                       | Why                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | TypeScript + official `@modelcontextprotocol/sdk` (v1.32, spec `2025-11-25`)   | Most mature SDK, first to get spec features, easy npm distribution.                                                                                                              |
| D2  | Few, task-shaped tools instead of thin API wrappers                            | `get_pr_context` does in one call what would take 3–4 raw API tools. That means fewer round-trips, fewer tokens and less room for the model to go wrong.                         |
| D3  | Every tool has an `outputSchema` and returns `structuredContent` + JSON text   | Spec-recommended: typed results for capable hosts, and the serialized JSON fallback for older ones.                                                                              |
| D4  | Domain types ≠ GitHub API types; compile-time drift checks against zod schemas | Tool outputs stay small and stable even if the GitHub API changes; `SchemaDriftChecks` in `tools/schemas.ts` breaks the build if a domain type and its published schema diverge. |
| D5  | Tool errors are results (`isError`), not JSON-RPC errors                       | Per spec: lets the model see the problem and self-correct (e.g. fix a malformed PR URL). Protocol errors are reserved for protocol problems.                                     |
| D6  | Logs → stderr (pino, JSON), `no-console` lint rule                             | In stdio mode stdout _is_ the protocol stream. A stray `console.log` would corrupt it.                                                                                           |
| D7  | CI status is best-effort in `get_pr_context`                                   | A token without _Checks_ permission should still get PR and file context; the gap is reported in `checksError`.                                                                  |
| D8  | Risk analysis is deterministic heuristics, not an LLM call                     | Fast, free, explainable and testable. The host's model does the judgement; we supply facts and signals.                                                                          |
| D9  | Opaque base64url cursors carrying page + page size                             | Spec recommends opaque cursors. Storing page size prevents skipped or duplicated items if `limit` changes between calls.                                                         |
| D10 | Untrusted-content hygiene: instructions + field descriptions + body truncation | PR text is attacker-controllable. We cannot stop prompt injection server-side, but we label the data clearly and keep it bounded.                                                |
| D11 | Ports & adapters (`GitHubClient` interface)                                    | Testability (fake client) and room for future trackers (Jira/Linear deferred by choice).                                                                                         |
| D12 | Node ≥ 22                                                                      | Node 20 reached end-of-life in April 2026.                                                                                                                                       |

## Testing strategy

| Layer          | How                                        | What it proves                                                     |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| lib / services | Vitest + `FakeGitHubClient`                | Business rules, edge cases, pagination, graceful degradation       |
| GitHub adapter | Vitest + **msw** mocking `api.github.com`  | Real Octokit requests, response mapping, error mapping, pagination |
| MCP contract   | Real SDK `Client` over `InMemoryTransport` | Registration, schemas, annotations, output validation, error shape |
| Live           | `npm run smoke` (stdio, real GitHub)       | The built artifact works end-to-end like a real host would use it  |
| Manual         | `npm run inspect` (MCP Inspector)          | Visual check of tools, schemas and responses                       |

Coverage thresholds (enforced in CI): lines/functions/statements 80%, branches 70%.
