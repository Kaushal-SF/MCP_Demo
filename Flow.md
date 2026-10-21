# Flow

How execution moves through DevFlow MCP, from process start to a tool result, resource or prompt
and back, file by file and function by function.

- **Why** things are built this way: [Decisions.md](Decisions.md) (cited as D1–D34).
- **How the code is organised** (layers, folders): [ARCHITECTURE.md](ARCHITECTURE.md).

**Reading the diagrams:** `file.ts › function()` names the code that runs. Boxes marked _SDK_ are
inside `@modelcontextprotocol/sdk`, not our code. Diagrams use Mermaid, which renders on GitHub
and in VS Code's Markdown preview.

## Contents

1. [Startup](#1-startup)
2. [Handshake and discovery](#2-handshake-and-discovery)
3. [The shared `tools/call` pipeline](#3-the-shared-toolscall-pipeline)
4. [`get_pr_context`](#4-get_pr_context)
5. [`analyze_pr_risk`](#5-analyze_pr_risk)
6. [`get_pr_diff`](#6-get_pr_diff)
7. [`list_review_queue`](#7-list_review_queue)
8. [`get_my_activity`](#8-get_my_activity)
9. [`generate_release_notes`](#9-generate_release_notes)
10. [Resources: list and read](#10-resources-list-and-read)
11. [Prompts, and the `/review-pr` journey end to end](#11-prompts-and-the-review-pr-journey-end-to-end)
12. [Argument completion](#12-argument-completion)
13. [Logging to the host](#13-logging-to-the-host)
14. [Error paths](#14-error-paths)
15. [Shutdown](#15-shutdown)
16. [Test and tooling flows](#16-test-and-tooling-flows)
17. [GitHub API calls per operation](#17-github-api-calls-per-operation)
18. [Function index](#18-function-index)

---

## 1. Startup

The MCP host (Claude Code, Claude Desktop, VS Code) starts `dist/index.js` as a child process
(directly, through `npx devflow-pr-mcp`, or from the Claude Desktop bundle). `GITHUB_TOKEN` in its
environment is optional; without it the GitHub CLI login is used.

```mermaid
flowchart TD
    A["index.ts › main()"] --> B["parseArgs: --help / --version"]
    B -->|"--help or --version"| B1["print to stderr, return (exit 0)"]
    B --> C["config.ts › loadConfig()"]
    C -->|invalid env| C1["throw ConfigError → main().catch → stderr message, exit 1"]
    C --> L0["lib/mcp-log-bridge.ts › new McpLogBridge()  (not yet attached, silent)"]
    L0 --> D["lib/logger.ts › createLogger(level, bridge.sink)  (pino → stderr + bridge)"]
    D --> T["config.ts › resolveGitHubToken(): GITHUB_TOKEN, else gh auth token"]
    T -->|"no token anywhere"| T1["throw ConfigError → stderr: how to sign in, exit 1"]
    T --> E["clients/github.ts › new OctokitGitHubClient(token, apiUrl, userAgent)"]
    E --> CS["services/checklists.ts › new ChecklistStore(DEVFLOW_CHECKLISTS_DIR or bundled folder)<br/>bundled folder found via lib/package-root.ts › findPackageRoot()"]
    CS --> SG["services/suggestions.ts › new ReviewQueueSuggestions(github, logger)"]
    SG --> F["server.ts › createServer(ServerContext)"]
    F --> F1["new McpServer(identity, instructions, capabilities: logging)"]
    F1 --> F2["register 6 tools → tools/*.ts"]
    F2 --> F3["register 2 resource templates → resources/*.ts"]
    F3 --> F4["register 3 prompts → prompts/*.ts"]
    F4 --> AT["bridge.attach(server): takes over logging/setLevel"]
    AT --> G["transports/stdio.ts › startStdio(server, logger)"]
    G --> G1["register SIGINT / SIGTERM / stdin-end handlers"]
    G1 --> G2["server.connect(new StdioServerTransport())"]
    G2 --> H(["log 'ready on stdio', wait for JSON-RPC on stdin"])
```

| Step | Where                                      | What happens                                                                                      | Why                                                                                         |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1    | `src/index.ts › main()`                    | Parses CLI flags. `--help` and `--version` print to **stderr** and return.                        | stdout is reserved for the protocol (D14)                                                   |
| 2    | `src/config.ts › loadConfig()`             | zod validates `process.env` into a typed `Config`. All problems are reported at once.             | Fail fast, before a host thinks we're healthy (D15)                                         |
| 3    | `src/lib/mcp-log-bridge.ts`, `logger.ts`   | The bridge is created first so the logger can hand it every line. It stays silent until attached. | Logs reach both stderr and, later, the host (D28)                                           |
| 3b   | `src/config.ts › resolveGitHubToken()`     | Uses `GITHUB_TOKEN`, else runs `gh auth token` (PATH, then known install paths). Logs the source. | Zero-config setup for anyone signed in to the GitHub CLI (D36)                              |
| 4    | `src/clients/github.ts › constructor`      | Builds the Octokit instance. **No network call yet.**                                             | Startup stays fast and offline. A bad token surfaces on the first call as `[UNAUTHORIZED]`. |
| 5    | `ChecklistStore`, `ReviewQueueSuggestions` | Points the store at a folder (no files read yet); the suggestions cache starts empty.             | Checklists are read lazily, so edits apply live (D27)                                       |
| 6    | `src/server.ts › createServer()`           | Creates `McpServer`, then registers 6 tools, 2 resource templates and 3 prompts.                  | Transport-agnostic factory, reused by tests (D19)                                           |
| 7    | `bridge.attach(server)`                    | Replaces the SDK's `logging/setLevel` handler with ours.                                          | We need to know the host's chosen level (D28)                                               |
| 8    | `src/transports/stdio.ts › startStdio()`   | Installs shutdown handlers, then `server.connect()` starts reading stdin.                         | Handlers first, so a signal during startup is still handled                                 |

`index.ts` is the **composition root**: the only place that creates concrete classes. Every
registration receives its dependencies through one `ServerContext` object (`src/context.ts`).

## 2. Handshake and discovery

All of this happens inside the SDK, driven by what `createServer()` registered.

```mermaid
sequenceDiagram
    autonumber
    participant Host as MCP host
    participant SDK as McpServer (SDK)
    participant Ours as Our registrations
    Host->>SDK: initialize {protocolVersion, capabilities, clientInfo}
    SDK-->>Host: serverInfo, instructions, capabilities {tools, resources, prompts, completions, logging}
    Host->>SDK: notifications/initialized
    Host->>SDK: tools/list
    SDK-->>Host: 6 tools with input/output JSON Schema, annotations, descriptions
    Host->>SDK: resources/list
    SDK->>Ours: checklist template › list() → ChecklistStore.list() reads checklists/*.md
    SDK-->>Host: devflow://checklists/general, node, react, security
    Host->>SDK: resources/templates/list
    SDK-->>Host: devflow://checklists/{name}, devflow://repos/{owner}/{repo}/guidelines
    Host->>SDK: prompts/list
    SDK-->>Host: review-pr, standup-summary, release-notes (with their arguments)
    Note over Host: Tools go to the model. Prompts become slash-commands.<br/>Resources can be attached by the user.
```

- **Capabilities** `tools`, `resources`, `prompts` and `completions` are added automatically by the
  SDK as things are registered; only `logging` is declared by hand.
- **Version negotiation:** the SDK answers with `2025-11-25` or the newest version the host also
  supports (back to `2024-11-05`).
- **`instructions`** (`src/server.ts › INSTRUCTIONS`) tell the model which tool to use when, and to
  treat author-written text and code as untrusted (D13).
- **Schemas:** the zod shapes in `src/tools/*.ts` and `src/tools/schemas.ts` become JSON Schema.
  The `.describe()` texts become the field descriptions the model reads.

## 3. The shared `tools/call` pipeline

Every tool call follows the same path. The tool-specific part is only the box in the middle.

```mermaid
sequenceDiagram
    autonumber
    participant Host as MCP host
    participant SDK as McpServer (SDK)
    participant H as Tool handler<br/>tools/*.ts
    participant RT as lib/tool-result.ts<br/>runTool()
    participant S as services/*.ts
    participant C as clients/github.ts<br/>OctokitGitHubClient
    participant GH as GitHub REST API
    Host->>SDK: tools/call {name, arguments}
    SDK->>SDK: find tool by name, validate arguments with zod (applies defaults)
    SDK->>H: handler(parsedArgs, extra)
    H->>RT: runTool(logger, toolName, outputSchema, body)
    RT->>S: body(): parse refs, call service
    S->>C: GitHubClient methods
    C->>GH: HTTPS requests (Octokit)
    GH-->>C: JSON
    C-->>S: domain types (PullRequestInfo, ChangedFile, CheckSummary…)
    S-->>RT: result object
    RT->>RT: outputSchema.parse(result) drops undeclared fields (D34)
    RT-->>H: {structuredContent, content:[{type:text, text: JSON}]}
    H-->>SDK: CallToolResult
    SDK->>SDK: validate structuredContent against outputSchema
    SDK-->>Host: result (strict clients re-validate with additionalProperties false)
```

| Stage             | Code                                             | Responsibility                                                                                                 |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Input validation  | SDK (`McpServer.validateToolInput`)              | Rejects bad arguments before our code runs; fills defaults (`maxFiles = 100`, `limit = 10`, `days = 1`)        |
| Handler           | `src/tools/<tool>.ts`, arrow fn in `register*()` | Converts strings to typed refs (`parsePullRequestRef`, `parseRepoRef`), calls the service, shapes output (D24) |
| Outcome wrapper   | `src/lib/tool-result.ts › runTool()`             | Parses output through the schema (D34), times and logs the call, builds success or `isError` results (D6, D8)  |
| Business logic    | `src/services/*.ts`                              | Orchestrates client calls, applies rules; knows nothing about MCP                                              |
| External I/O      | `src/clients/github.ts › OctokitGitHubClient`    | HTTP, pagination, mapping raw JSON to domain types and HTTP errors to `DevflowError` (D7, D8, D10)             |
| Output validation | SDK (`McpServer.validateToolOutput`)             | Second check that `structuredContent` matches the published `outputSchema` (skipped for `isError` results)     |

## 4. `get_pr_context`

**Entry:** `src/tools/get-pr-context.ts › registerGetPrContext` handler · **Arguments:** `pr`, `maxFiles` (1–300, default 100)

```mermaid
flowchart TD
    A["handler({pr, maxFiles})"] --> B["runTool(logger, 'get_pr_context', PrContextOutputSchema, body)"]
    B --> C["lib/pr-ref.ts › parsePullRequestRef(pr)"]
    C -->|"URL or owner/repo#n"| D["services/pr-context.ts › getPrContext(github, ref, {maxFiles})"]
    C -->|"no match"| X["throw DevflowError INVALID_INPUT"]
    D --> E["github.getPullRequest(ref)<br/>GET /repos/{o}/{r}/pulls/{n}"]
    E --> F{{"in parallel (Promise.all)"}}
    F --> G["github.listPullRequestFiles(ref, maxFiles)<br/>GET …/pulls/{n}/files (paged by 100, stops at maxFiles)"]
    F --> H["github.getCheckSummary(ref, pr.headSha)"]
    H --> H1["GET …/commits/{sha}/check-runs (paginated)"]
    H --> H2["GET …/commits/{sha}/status"]
    H1 & H2 --> H3["merge into one CheckSummary<br/>(passed / failed / pending / other)"]
    H3 -->|"on error"| H4["checks = null, checksError = message (best-effort, D11)"]
    G & H3 & H4 --> I["lib/issue-refs.ts › extractLinkedIssues(pr.body)"]
    I --> J["PrContext {pr, files, filesTruncated, checks, checksError?, linkedIssues}"]
    J --> K["handler: truncate pr.body to MAX_BODY_CHARS (4000), set bodyTruncated (D13, D24)"]
    K --> L["runTool → schema parse → structuredContent + JSON text"]
```

**Ordering detail:** `getPullRequest` must finish first because the CI lookup needs `pr.headSha`.
Files and CI are independent, so they run concurrently. CI failures are caught _inside_ the
`Promise.all` (via `.then(ok, fail)`) so they can't discard the file list.

## 5. `analyze_pr_risk`

**Entry:** `src/tools/analyze-pr-risk.ts › registerAnalyzePrRisk` handler · **Arguments:** `pr`

```mermaid
flowchart TD
    A["handler({pr})"] --> B["runTool(logger, 'analyze_pr_risk', AnalyzePrRiskOutputSchema, body)"]
    B --> C["parsePullRequestRef(pr)"]
    C --> D["getPrContext(github, ref, {maxFiles: 1000})<br/>(identical path to § 4)"]
    D --> E["services/risk-analyzer.ts › analyzeRisk(context, {extraSensitivePaths})"]
    E --> F["classify every file<br/>services/file-classifier.ts › isSourceFile / isTestFile / isGenerated / isManifest / isLockfile"]
    F --> G["evaluate signals, in this order:<br/>LARGE_CHANGE · MANY_FILES · LARGE_FILE_CHANGES · NO_TEST_CHANGES ·<br/>SENSITIVE_PATHS · DEPENDENCY_CHANGES / LOCKFILE_WITHOUT_MANIFEST ·<br/>MISSING_DESCRIPTION · CI_FAILING / CI_PENDING · DRAFT · PARTIAL_FILE_LIST"]
    G --> G1["SENSITIVE_PATHS uses lib/glob.ts › createPathMatcher(DEFAULT_SENSITIVE_PATHS + extra)<br/>→ globToRegExp() per pattern"]
    G --> H["score = min(100, Σ weights) → level (≥50 high, ≥20 medium, else low)"]
    H --> I["focusFiles = top 5 source files by lines changed"]
    I --> J["handler returns {pr: {ref, url, title}, risk}"]
    J --> K["runTool → schema parse → structuredContent + JSON text"]
```

`analyzeRisk()` is **pure**: no I/O, no clock, no randomness, so the same input always gives the
same report (D12). All network work happens in the shared `getPrContext()` step. Its `focusFiles`
are designed to be passed straight to `get_pr_diff` (§ 6).

## 6. `get_pr_diff`

**Entry:** `src/tools/get-pr-diff.ts › registerGetPrDiff` handler · **Arguments:** `pr`, `paths?` (≤ 50 paths or globs), `maxChars` (1,000–80,000, default 20,000)

```mermaid
flowchart TD
    A["handler({pr, paths, maxChars})"] --> B["runTool(logger, 'get_pr_diff', PrDiffOutputSchema, body)"]
    B --> C["parsePullRequestRef(pr)"]
    C --> D["services/pr-diff.ts › getPrDiff(github, ref, {paths, maxChars})"]
    D --> E["github.listPullRequestFiles(ref, 3000, {includePatch: true})<br/>GET …/pulls/{n}/files (paged by 100)"]
    E --> F{"paths given?"}
    F -->|no| G["all files, in GitHub's order"]
    F -->|yes| G2["files matching any path/glob (createPathMatcher)<br/>+ unmatchedPaths for patterns that hit nothing"]
    G & G2 --> H{{"for each selected file"}}
    H -->|"generated, and not requested by path"| O1["omitted: generated"]
    H -->|"no patch (binary / too large)"| O2["omitted: no-patch"]
    H -->|"fits in remaining budget"| P1["include whole patch"]
    H -->|"doesn't fit, ≥ 400 chars left"| P2["include truncated patch, patchTruncated = true"]
    H -->|"doesn't fit, < 400 chars left"| O3["omitted: budget"]
    P1 & P2 & O1 & O2 & O3 --> R["PrDiff {files, omitted, totalChars, unmatchedPaths} + pr ref"]
    R --> K["runTool → schema parse → structuredContent + JSON text"]
```

Everything the model did _not_ get is listed with a reason, so it can ask again with a larger
budget or narrower paths (D25).

## 7. `list_review_queue`

**Entry:** `src/tools/list-review-queue.ts › registerListReviewQueue` handler · **Arguments:** `repo?`, `limit` (1–30, default 10), `cursor?`

```mermaid
flowchart TD
    A["handler({repo, limit, cursor})"] --> B["runTool(logger, 'list_review_queue', ReviewQueueOutputSchema, body)"]
    B --> C["repo ? lib/pr-ref.ts › parseRepoRef(repo)"]
    C --> D["services/review-queue.ts › listReviewQueue(github, {limit, repo, cursor})"]
    D --> E["lib/pagination.ts › decodeCursor(cursor, limit)<br/>→ {page, perPage}, the cursor's perPage wins (D16)"]
    E --> F["github.getAuthenticatedLogin()<br/>GET /user, cached as a promise for the process lifetime"]
    F --> G["github.searchReviewRequests({login, repo, page, perPage})<br/>→ searchPullRequests: is:pr is:open archived:false review-requested:{login} [repo:o/r]<br/>sort=created, order=asc"]
    G --> H{{"for each item, in parallel"}}
    H --> H0["copy the 7 ReviewRequestItem fields explicitly (no spread, D34)"]
    H0 --> I["ageDays = floor((now − createdAt) / 1 day)"]
    H0 --> J["github.getPullRequest(item.ref) → additions, deletions, changedFiles"]
    J -->|ok| K["size = {label: sizeLabel(additions + deletions), …}"]
    J -->|error| K2["item without size (never fail the whole queue, D17)"]
    K & K2 --> L["hasMore = page was full AND seen < min(totalCount, 1000)"]
    L -->|yes| M["nextCursor = encodeCursor({page + 1, perPage})"]
    L --> N["ReviewQueue {reviewer, totalCount, items, nextCursor?}"]
    M --> N
    N --> O["runTool → schema parse → structuredContent + JSON text"]
```

**Pagination round-trip:** the model passes `nextCursor` back as `cursor` and the flow repeats
from `decodeCursor`. The 1000-item cap exists because GitHub search refuses pages past 1000 results.

## 8. `get_my_activity`

**Entry:** `src/tools/get-my-activity.ts › registerGetMyActivity` handler · **Arguments:** `days` (1–31, default 1), `user?`, `repo?`

```mermaid
flowchart TD
    A["handler({days, user, repo})"] --> B["runTool(logger, 'get_my_activity', ActivityOutputSchema, body)"]
    B --> C["services/activity.ts › getActivity(github, {days, user, repo, perList: 20})"]
    C --> D["user ?? github.getAuthenticatedLogin()"]
    D --> E["since = now − days, as a second-precision UTC timestamp"]
    E --> F{{"4 searches in parallel"}}
    F --> S1["merged: is:pr author:U merged:>=since"]
    F --> S2["inProgress: is:pr author:U is:open updated:>=since"]
    F --> S3["reviewed: is:pr reviewed-by:U -author:U updated:>=since"]
    F --> S4["pending: searchReviewRequests(perPage 1) → totalCount only"]
    S1 & S2 & S3 & S4 --> R["Activity {user, since, days, merged, inProgress, reviewed, pendingReviewRequests}"]
    R --> K["runTool → schema parse → structuredContent + JSON text"]
```

All four searches carry the optional `repo:` qualifier. "Reviewed" is an approximation; see D26.

## 9. `generate_release_notes`

**Entry:** `src/tools/generate-release-notes.ts › registerGenerateReleaseNotes` handler · **Arguments:** `repo`, `from`, `to?`, `base?`, `limit` (1–300, default 100)

```mermaid
flowchart TD
    A["handler({repo, from, to, base, limit})"] --> B["runTool(logger, 'generate_release_notes', ReleaseNotesOutputSchema, body)"]
    B --> C["parseRepoRef(repo)"]
    C --> D["services/release-notes.ts › generateReleaseNotes(github, options)"]
    D --> E{{"resolve both bounds in parallel"}}
    E --> E1{"looks like a date?"}
    E1 -->|yes| E2["new Date(input), INVALID_INPUT if invalid"]
    E1 -->|"no: tag / branch / SHA"| E3["github.getCommit(repo, ref)<br/>GET /repos/{o}/{r}/commits/{ref} → committer date<br/>422 → NOT_FOUND"]
    E --> T["to omitted → now"]
    E2 & E3 & T --> V{"from earlier than to?"}
    V -->|no| X["INVALID_INPUT"]
    V -->|yes| Q["qualifiers: is:pr is:merged repo:o/r merged:(from+1s)..to [base:b]"]
    Q --> P["page through github.searchPullRequests until limit or no more (≤ 300)"]
    P --> S["sort by mergedAt ascending"]
    S --> CL["classify(pr) per PR:<br/>conventional prefix → labels → dependency bot → other<br/>breaking = '!' or breaking label"]
    CL --> G["group into SECTIONS order, collect breakingChanges, contributors (no bots)"]
    G --> M["renderReleaseNotes() → markdown"]
    M --> K["runTool → schema parse → structuredContent + JSON text"]
```

The window starts one second after `from` because the commit `from` points at belongs to the
previous release (D29).

## 10. Resources: list and read

Resources are **read**, not called: the host (or the user) asks for a URI and gets its content.
Failures surface as JSON-RPC errors via `runRequest()` (D32), not as `isError` results.

```mermaid
sequenceDiagram
    autonumber
    participant Host as MCP host
    participant SDK as McpServer (SDK)
    participant R as resources/*.ts
    participant RR as lib/request-result.ts<br/>runRequest()
    participant S as services/*.ts
    Host->>SDK: resources/read {uri}
    SDK->>SDK: exact match? no → match URI against each template
    alt devflow://checklists/{name}
        SDK->>R: read callback (uri, {name})
        R->>RR: runRequest(logger, resource 'checklist', body)
        RR->>S: ChecklistStore.read(name)
        S->>S: name must match [a-z0-9-] (blocks ../ traversal), then readFile(dir/name.md)
    else devflow://repos/{owner}/{repo}/guidelines
        SDK->>R: read callback (uri, {owner, repo})
        R->>RR: runRequest(logger, resource 'repo-guidelines', body)
        RR->>S: parseRepoRef(owner/repo), then getRepoGuidelines(github, repo)
        S->>S: 9 × github.getFileText() in parallel, first hit per kind wins, 404 → null (D33)
        S-->>R: renderGuidelines() → one Markdown document
    else no template matches
        SDK-->>Host: error -32602 "Resource … not found"
    end
    RR-->>SDK: {contents: [{uri, mimeType: text/markdown, text}]}
    SDK-->>Host: result, or error -32602 / -32603 with "[CODE] message"
```

**Listing:** `resources/list` calls the checklist template's `list` callback, which reads the
folder each time. The guidelines template has no `list` callback because "all repositories" is not
a finite, useful list.

## 11. Prompts, and the `/review-pr` journey end to end

A prompt turns a user's slash-command into messages for the model (D30). `prompts/get` runs our
callback inside `runRequest()`. It validates the arguments, then returns instructions; only the
static checklist is embedded.

```mermaid
flowchart TD
    A["prompts/get {name: review-pr, arguments: {pr, checklist?}}"] --> B["SDK validates arguments against argsSchema"]
    B --> C["prompts/review-pr.ts callback → runRequest(logger, prompt 'review-pr', body)"]
    C --> D["parsePullRequestRef(pr): fail now on a typo, not three tool calls later"]
    D --> E["ChecklistStore.read(checklist ?? 'general')"]
    E --> F["messages[0]: text instructions naming get_pr_context → analyze_pr_risk →<br/>get_pr_diff(focusFiles) → apply checklist → optional guidelines resource,<br/>plus the required reply sections and the untrusted-content warning"]
    E --> G["messages[1]: embedded resource {uri: devflow://checklists/name, text}"]
    F & G --> H["GetPromptResult {description, messages}"]
```

`/standup-summary` (`prompts/standup-summary.ts`) validates `days` (prompt arguments are always
strings) and points the model at `get_my_activity` and `list_review_queue`.
`/release-notes` (`prompts/release-notes.ts`) validates `repo` and points it at
`generate_release_notes`.

**The whole `/review-pr` journey**, which is what a demo shows:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Host as MCP host + model
    participant DF as DevFlow server
    participant GH as GitHub
    User->>Host: types /review-pr, picks a PR from the completion list (§ 12)
    Host->>DF: prompts/get review-pr {pr, checklist}
    DF-->>Host: instructions + embedded checklist
    Host->>DF: tools/call get_pr_context
    DF->>GH: PR, files, check runs, statuses
    DF-->>Host: PR context
    Host->>DF: tools/call analyze_pr_risk
    DF->>GH: same data (fresh)
    DF-->>Host: score, signals, focusFiles
    Host->>DF: tools/call get_pr_diff {paths: focusFiles}
    DF->>GH: files with patches
    DF-->>Host: budgeted patches
    opt project rules
        Host->>DF: resources/read devflow://repos/o/r/guidelines
        DF-->>Host: CONTRIBUTING + PR template
    end
    Host-->>User: Summary · Risk · Findings · Checklist · Suggested review comment
```

## 12. Argument completion

Hosts call `completion/complete` as the user types a prompt argument or a resource-template
variable. The SDK routes it to the completer attached with `completable()` or a template's `complete`.

| Ref                                    | Argument    | Completer                                                           | Data source                     |
| -------------------------------------- | ----------- | ------------------------------------------------------------------- | ------------------------------- |
| prompt `review-pr`                     | `pr`        | `ctx.suggestions.suggest(value)`, substring match on `owner/repo#n` | Review queue, cached 60 s (D31) |
| prompt `review-pr`                     | `checklist` | checklist names starting with `value`                               | `ChecklistStore.list()`         |
| prompt `release-notes`                 | `repo`      | unique `owner/repo` from the suggestions, substring match           | Review queue, cached 60 s       |
| prompt `standup-summary`               | `days`      | `1`, `3`, `7` starting with `value`                                 | static                          |
| template `devflow://checklists/{name}` | `name`      | checklist names starting with `value`                               | `ChecklistStore.list()`         |

```mermaid
flowchart LR
    K["keystroke"] --> S["ReviewQueueSuggestions.suggest(prefix)"]
    S --> C{"cache fresh (< 60 s)?"}
    C -->|yes| F["filter cached refs"]
    C -->|no| IF{"request already in flight?"}
    IF -->|yes| W["await the same promise"]
    IF -->|no| R["getAuthenticatedLogin → searchReviewRequests(perPage 20)"]
    R -->|ok| SV["store refs + expiry"]
    R -->|error| E["log at debug, return []"]
    W & SV --> F
    F --> O["≤ 20 values"]
```

## 13. Logging to the host

Every log line goes to stderr; the bridge also offers it to the host as `notifications/message` (D28).

```mermaid
flowchart TD
    A["logger.info/warn/error(…) anywhere"] --> B["pino: level filter (DEVFLOW_LOG_LEVEL), redaction of token fields"]
    B --> C["destination.write(line)"]
    C --> D["stderr (always)"]
    C --> E["McpLogBridge.sink(line)"]
    E --> F{"attached and connected?"}
    F -->|no| Z["drop"]
    F -->|yes| G["JSON.parse, map pino level → MCP level<br/>(30 info · 40 warning · 50 error · 60 critical)"]
    G --> H{"≥ host level?<br/>(default warning, until logging/setLevel)"}
    H -->|no| Z
    H -->|yes| I["drop level/time/pid/hostname/name, reduce err to {type, message}"]
    I --> J["server.sendLoggingMessage({level, logger: devflow-mcp, data}), errors swallowed"]
    S["host: logging/setLevel {level}"] --> T["bridge handler sets minLevel"]
    T -.-> H
```

Two independent filters apply: `DEVFLOW_LOG_LEVEL` decides what is logged at all, and the host's
level decides what is forwarded to it.

## 14. Error paths

Where each kind of failure starts, and what the host sees in the end.

| #   | Trigger                                         | Raised at                                                                          | Becomes                                                            | Host sees                                                                   |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| E1  | Invalid env var, or no token and no `gh` login  | `loadConfig()` or `resolveGitHubToken()` → `ConfigError`                           | `main().catch` prints the message to stderr, `exit(1)`             | Server failed to start; message in the host's MCP logs says how to sign in  |
| E2  | Unknown tool name                               | SDK                                                                                | SDK tool error                                                     | `isError: true`, "Tool X not found"                                         |
| E3  | Tool arguments violate input schema             | SDK `validateToolInput`                                                            | SDK tool error                                                     | `isError: true`, "Input validation error: …"                                |
| E4  | Malformed PR/repo string, cursor or date        | `pr-ref.ts` / `pagination.ts` / `release-notes.ts` → `DevflowError(INVALID_INPUT)` | `runTool` catch                                                    | `isError: true`, `[INVALID_INPUT] …`                                        |
| E5  | GitHub 401/403/404/422/429/5xx                  | Octokit → `errors.ts › mapGitHubError()` in each client method                     | `DevflowError` with code → `runTool` catch                         | `isError: true`, e.g. `[NOT_FOUND] Could not find … Check …`                |
| E6  | Rate limited (quota, 429, or secondary limit)   | `mapGitHubError()` reads `x-ratelimit-*`, `retry-after` and the message            | `DevflowError(RATE_LIMITED)` with the reset time or wait           | `isError: true`, `[RATE_LIMITED] … resets at …` / `… Wait 60 seconds …`     |
| E7  | Unknown tag/branch/SHA in release notes         | `getCommit()`: 422 → `DevflowError(NOT_FOUND)`                                     | `runTool` catch                                                    | `isError: true`, `[NOT_FOUND] "v9" is not a tag, branch or commit in o/r.`  |
| E8  | CI lookup fails                                 | `getCheckSummary()`                                                                | Caught in `getPrContext()`, **not** an error                       | Success, with `checks: null` and `checksError` explaining why (D11)         |
| E9  | One PR's size lookup fails in the queue         | `getPullRequest()` inside `listReviewQueue()`                                      | Caught per item, **not** an error                                  | Success; that item has no `size` (D17)                                      |
| E10 | A guideline file is missing                     | `getFileText()`: 404 → `null`                                                      | **not** an error                                                   | Success; that section says "Not found" (D33)                                |
| E11 | Result has undeclared fields                    | service / client                                                                   | `runTool` › `outputSchema.parse` drops them                        | Success, with only the declared fields (D34)                                |
| E12 | Result lacks a required field                   | service / client bug                                                               | `outputSchema.parse` throws → `runTool` catch                      | `isError: true`, `[INTERNAL] …` (D34)                                       |
| E13 | Bug / unexpected exception in a tool            | anywhere                                                                           | `runTool` catch → `logger.error` with stack                        | `isError: true`, `[INTERNAL] Unexpected internal error…` (no internals, D8) |
| E14 | Bad resource URI or unknown checklist           | SDK (no template match) or `ChecklistStore.read()`                                 | `runRequest` → `McpError(-32602)`                                  | JSON-RPC error -32602, `[NOT_FOUND] No checklist named "x". Available: …`   |
| E15 | Bad prompt argument (PR ref, days, checklist)   | prompt callback → `DevflowError(INVALID_INPUT / NOT_FOUND)`                        | `runRequest` → `McpError(-32602)`                                  | JSON-RPC error -32602, `[INVALID_INPUT] …`                                  |
| E16 | Resource/prompt failure on GitHub or a bug      | services / client                                                                  | `runRequest` → `McpError(-32603)`, generic text for unknown errors | JSON-RPC error -32603, `[CODE] …` or `[INTERNAL] …`                         |
| E17 | Completion lookup fails                         | `ReviewQueueSuggestions.fetch()`                                                   | Caught, logged at debug                                            | Empty suggestion list (D31)                                                 |
| E18 | Log notification fails (e.g. host disconnected) | `sendLoggingMessage()`                                                             | Promise rejection swallowed                                        | Nothing; avoids log loops (D28)                                             |

Every tool failure goes through `runTool()`, and every resource or prompt failure through
`runRequest()`, so the `[CODE] message` format and the `warn`/`error` log fields are the same everywhere.

## 15. Shutdown

```mermaid
flowchart LR
    A["SIGINT / SIGTERM"] --> C["transports/stdio.ts › shutdown(reason)"]
    B["stdin 'end' (host closed the pipe)"] --> C
    C --> D["logger.info('shutting down')"]
    D --> E["server.close() → closes the transport"]
    E --> F["process.exit(0)"]
    A2["second SIGINT during shutdown"] -.->|"handler was once(), default Node behaviour"| G["immediate termination"]
```

## 16. Test and tooling flows

The same production code runs under different wiring.

**Integration tests** (`test/integration/server.test.ts`)

```
FakeGitHubClient (test/helpers/fixtures.ts)       ─┐
createLogger('debug', bridge.sink, quiet stderr)  │
ChecklistStore(<repo>/checklists)                 ├─► createServer(ctx) ─► bridge.attach ─► server.connect
ReviewQueueSuggestions(fake, logger)              │                                             ▲
extraSensitivePaths: []                           ─┘          InMemoryTransport.createLinkedPair()
new Client() ─► connect ─► tools/list (like a real host, D34) ─► callTool / readResource /
                getPrompt / complete / setLoggingLevel  ── §§ 2–14 ──┘
```

This exercises everything in §§ 2–14 except `OctokitGitHubClient` and the stdio transport. The
fake returns the same shapes as the real client; a narrower fake once hid a bug (D34).

**Adapter tests** (`test/unit/github-client.test.ts`): `new OctokitGitHubClient()` → real Octokit →
native `fetch` → **msw** `setupServer()` returns canned GitHub JSON. This covers the bottom box of § 3.

**Live smoke** (`scripts/smoke.ts`, `npm run smoke -- <pr> [release-from]`): the SDK `Client` with
`StdioClientTransport` spawns `node dist/index.js` (§ 1). It calls all 6 tools, reads both kinds of
resource, gets `/review-pr`, and asks for a completion, all against real GitHub. It is the only
flow that covers the built artifact and stdio together, and it exits non-zero if anything fails.

**MCP Inspector** (`npm run inspect`): a manual, visual run of everything above.

## 17. GitHub API calls per operation

| Operation                         | Requests                                                                                                                | Typical total |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| `get_pr_context`                  | `pulls.get` ×1 · `pulls.listFiles` ×⌈files/100⌉ · `checks.listForRef` ×⌈runs/100⌉ · `repos.getCombinedStatusForRef` ×1  | 4             |
| `analyze_pr_risk`                 | Same as `get_pr_context` (up to 1000 files, so up to 10 file pages)                                                     | 4             |
| `get_pr_diff`                     | `pulls.listFiles` ×⌈files/100⌉ (with patches)                                                                           | 1             |
| `list_review_queue`               | `users.getAuthenticated` ×1 (first call per process only) · `search.issuesAndPullRequests` ×1 · `pulls.get` ×N (N ≤ 30) | 2 + N         |
| `get_my_activity`                 | `users.getAuthenticated` ×1 (cached; skipped if `user` is given) · `search.issuesAndPullRequests` ×4                    | 4–5           |
| `generate_release_notes`          | `repos.getCommit` ×0–2 (0 for dates) · `search.issuesAndPullRequests` ×⌈PRs/100⌉ (≤ 3)                                  | 2–5           |
| read `devflow://checklists/…`     | none (local files)                                                                                                      | 0             |
| read `…/repos/{o}/{r}/guidelines` | `repos.getContent` ×9 in parallel (most return 404)                                                                     | 9             |
| `prompts/get` (any)               | none                                                                                                                    | 0             |
| completion of `pr` / `repo`       | `search.issuesAndPullRequests` ×1, at most once per 60 s                                                                | 0–1           |

Budget: 5,000 core requests/hour and 30 search requests/minute for an authenticated user.

## 18. Function index

Who calls what. Use it to find the impact of changing a function.

| Function                                                                    | File                                  | Called by                                                     | Calls                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                                                                      | `src/index.ts`                        | Node (process start)                                          | `loadConfig`, `resolveGitHubToken`, `McpLogBridge`, `createLogger`, `OctokitGitHubClient`, `ChecklistStore`, `ReviewQueueSuggestions`, `createServer`, `attach`, `startStdio` |
| `loadConfig`                                                                | `src/config.ts`                       | `main`, tests                                                 | zod `EnvSchema.safeParse`                                                                                                                                                     |
| `resolveGitHubToken`                                                        | `src/config.ts`                       | `main`, tests                                                 | `execFile('gh', ['auth', 'token'])` via the injectable `RunCommand`                                                                                                           |
| `createLogger` / `createSilentLogger`                                       | `src/lib/logger.ts`                   | `main`, tests                                                 | pino; the optional sink                                                                                                                                                       |
| `McpLogBridge.attach` / `.sink`                                             | `src/lib/mcp-log-bridge.ts`           | `main`, integration tests / pino destination                  | `server.server.setRequestHandler`, `sendLoggingMessage`                                                                                                                       |
| `findPackageRoot`                                                           | `src/lib/package-root.ts`             | `main`, tests                                                 | `existsSync`                                                                                                                                                                  |
| `createServer`                                                              | `src/server.ts`                       | `main`, integration tests                                     | `McpServer`, all 11 `register*` functions                                                                                                                                     |
| `startStdio`                                                                | `src/transports/stdio.ts`             | `main`                                                        | `StdioServerTransport`, `server.connect`, `server.close`                                                                                                                      |
| `registerGetPrContext`                                                      | `src/tools/get-pr-context.ts`         | `createServer`                                                | handler → `runTool`, `parsePullRequestRef`, `getPrContext`                                                                                                                    |
| `registerAnalyzePrRisk`                                                     | `src/tools/analyze-pr-risk.ts`        | `createServer`                                                | handler → `runTool`, `parsePullRequestRef`, `getPrContext`, `analyzeRisk`                                                                                                     |
| `registerGetPrDiff`                                                         | `src/tools/get-pr-diff.ts`            | `createServer`                                                | handler → `runTool`, `parsePullRequestRef`, `getPrDiff`                                                                                                                       |
| `registerListReviewQueue`                                                   | `src/tools/list-review-queue.ts`      | `createServer`                                                | handler → `runTool`, `parseRepoRef`, `listReviewQueue`                                                                                                                        |
| `registerGetMyActivity`                                                     | `src/tools/get-my-activity.ts`        | `createServer`                                                | handler → `runTool`, `parseRepoRef`, `getActivity`                                                                                                                            |
| `registerGenerateReleaseNotes`                                              | `src/tools/generate-release-notes.ts` | `createServer`                                                | handler → `runTool`, `parseRepoRef`, `generateReleaseNotes`                                                                                                                   |
| `registerChecklistResources`                                                | `src/resources/checklists.ts`         | `createServer`                                                | list/complete → `ChecklistStore.list`; read → `runRequest`, `ChecklistStore.read`                                                                                             |
| `registerRepoGuidelinesResource`                                            | `src/resources/repo-guidelines.ts`    | `createServer`                                                | read → `runRequest`, `parseRepoRef`, `getRepoGuidelines`, `renderGuidelines`                                                                                                  |
| `registerReviewPrPrompt`                                                    | `src/prompts/review-pr.ts`            | `createServer`                                                | `runRequest`, `parsePullRequestRef`, `ChecklistStore.read`; completers → `suggest`, `ChecklistStore.list`                                                                     |
| `registerStandupSummaryPrompt`                                              | `src/prompts/standup-summary.ts`      | `createServer`                                                | `runRequest`, `parseRepoRef`                                                                                                                                                  |
| `registerReleaseNotesPrompt`                                                | `src/prompts/release-notes.ts`        | `createServer`                                                | `runRequest`, `parseRepoRef`; completer → `suggest`                                                                                                                           |
| `runTool`                                                                   | `src/lib/tool-result.ts`              | all six tool handlers                                         | the tool body; `outputSchema.parse`; `logger.info/warn/error`                                                                                                                 |
| `runRequest` / `singleValue`                                                | `src/lib/request-result.ts`           | resource read callbacks, prompt callbacks                     | the body; `McpError`; `logger.info/warn/error`                                                                                                                                |
| `getPrContext`                                                              | `src/services/pr-context.ts`          | `get_pr_context`, `analyze_pr_risk` handlers                  | `getPullRequest`, `listPullRequestFiles`, `getCheckSummary`, `extractLinkedIssues`                                                                                            |
| `analyzeRisk`                                                               | `src/services/risk-analyzer.ts`       | `analyze_pr_risk` handler                                     | `is*` classifiers, `createPathMatcher`                                                                                                                                        |
| `getPrDiff`                                                                 | `src/services/pr-diff.ts`             | `get_pr_diff` handler                                         | `listPullRequestFiles({includePatch})`, `createPathMatcher`, `isGenerated`                                                                                                    |
| `listReviewQueue` / `sizeLabel`                                             | `src/services/review-queue.ts`        | `list_review_queue` handler                                   | `decodeCursor`, `getAuthenticatedLogin`, `searchReviewRequests`, `getPullRequest`, `encodeCursor`                                                                             |
| `getActivity`                                                               | `src/services/activity.ts`            | `get_my_activity` handler                                     | `getAuthenticatedLogin`, `searchPullRequests` ×3, `searchReviewRequests`                                                                                                      |
| `generateReleaseNotes` / `classify` / `renderReleaseNotes`                  | `src/services/release-notes.ts`       | `generate_release_notes` handler                              | `getCommit`, `searchPullRequests`                                                                                                                                             |
| `getRepoGuidelines` / `renderGuidelines`                                    | `src/services/repo-guidelines.ts`     | guidelines resource                                           | `getFileText` ×9                                                                                                                                                              |
| `ChecklistStore.list` / `.read`                                             | `src/services/checklists.ts`          | checklist resource, `review-pr` prompt, completers            | `readdir`, `readFile`                                                                                                                                                         |
| `ReviewQueueSuggestions.suggest`                                            | `src/services/suggestions.ts`         | `review-pr` and `release-notes` completers                    | `getAuthenticatedLogin`, `searchReviewRequests` (cached)                                                                                                                      |
| `isSourceFile` / `isTestFile` / `isGenerated` / `isManifest` / `isLockfile` | `src/services/file-classifier.ts`     | `analyzeRisk`, `getPrDiff` (`isGenerated`)                    | regexes and sets in the same file                                                                                                                                             |
| `getAuthenticatedLogin`                                                     | `src/clients/github.ts`               | `listReviewQueue`, `getActivity`, `ReviewQueueSuggestions`    | `GET /user` (cached), `mapGitHubError`                                                                                                                                        |
| `getPullRequest`                                                            | `src/clients/github.ts`               | `getPrContext`, `listReviewQueue`                             | `GET /repos/{o}/{r}/pulls/{n}`, `mapGitHubError`                                                                                                                              |
| `listPullRequestFiles`                                                      | `src/clients/github.ts`               | `getPrContext`, `getPrDiff`                                   | `GET …/pulls/{n}/files` (iterator), `mapGitHubError`                                                                                                                          |
| `getCheckSummary`                                                           | `src/clients/github.ts`               | `getPrContext`                                                | `GET …/check-runs`, `GET …/status`, `mapGitHubError`                                                                                                                          |
| `getCommit`                                                                 | `src/clients/github.ts`               | `generateReleaseNotes`                                        | `GET …/commits/{ref}`; 422 → `NOT_FOUND`                                                                                                                                      |
| `getFileText`                                                               | `src/clients/github.ts`               | `getRepoGuidelines`                                           | `GET …/contents/{path}`; 404 → `null`                                                                                                                                         |
| `searchPullRequests`                                                        | `src/clients/github.ts`               | `getActivity`, `generateReleaseNotes`, `searchReviewRequests` | `GET /search/issues`, `mapGitHubError`                                                                                                                                        |
| `searchReviewRequests`                                                      | `src/clients/github.ts`               | `listReviewQueue`, `getActivity`, `ReviewQueueSuggestions`    | `searchPullRequests`                                                                                                                                                          |
| `mapGitHubError`                                                            | `src/lib/errors.ts`                   | every `OctokitGitHubClient` method                            | creates `DevflowError`                                                                                                                                                        |
| `parsePullRequestRef` / `parseRepoRef`                                      | `src/lib/pr-ref.ts`                   | tool handlers, resource callbacks, prompt callbacks           | regexes; throws `DevflowError(INVALID_INPUT)`                                                                                                                                 |
| `formatPullRequestRef`                                                      | `src/lib/pr-ref.ts`                   | client error messages, `review-pr` prompt, suggestions        | none                                                                                                                                                                          |
| `extractLinkedIssues`                                                       | `src/lib/issue-refs.ts`               | `getPrContext`                                                | regex over the PR body                                                                                                                                                        |
| `encodeCursor` / `decodeCursor`                                             | `src/lib/pagination.ts`               | `listReviewQueue`                                             | base64url JSON                                                                                                                                                                |
| `createPathMatcher` / `globToRegExp`                                        | `src/lib/glob.ts`                     | `analyzeRisk`, `getPrDiff`                                    | none                                                                                                                                                                          |

> **Keep this file current:** when a milestone adds a tool, resource or prompt, add a section in
> the style of §§ 4–11, rows to §§ 14 and 17, and rows to § 18.
