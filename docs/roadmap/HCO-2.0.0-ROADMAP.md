# HCO 2.0.0 Roadmap

**Hermes Claude Operator — MCP Server for Controlled Claude Code Execution**

Repository: https://github.com/nzkbuild/hco-mcp
Current version: 1.0.0
Target version: 2.0.0

---

## Binding Architectural Decisions

These decisions are finalized and supersede any previous guidance:

| # | Decision | Detail |
|---|----------|--------|
| 1 | Idempotency key | Optional field. Hermes provides it when it knows the logical task identity. HCO generates a random unique key when absent. Do NOT deduplicate using a deterministic hash of prompt content. |
| 2 | Provider profiles | Reference environment variables or external secret sources. Raw API keys and provider secrets must NOT be stored in SQLite or passed through MCP. |
| 3 | Fake Claude adapter | Required for deterministic tests in Phase 1–3, but NOT sufficient for the HCO 2.0.0 release gate. Real Claude Code acceptance tests remain mandatory. |
| 4 | Legacy jobs and daemon | Remain temporarily for migration compatibility. Freeze new development against the legacy job model. The daemon must eventually consume the canonical `ExecutionService`. |
| 5 | `claude_sessions` coexistence | Existing data may coexist during migration, but new `executions` become the authoritative source of truth. Do NOT maintain two independent active execution systems. |
| 6 | Runtime stack | Node.js 22+, ESM, better-sqlite3, SQLite WAL. Stdio is the initial required MCP transport, but domain architecture must NOT be coupled to stdio-only assumptions. |
| 7 | Artifact size limits | Replace the single 256 KiB cap with four separate limits: inline MCP response limit, event chunk limit, individual artifact limit, total per-execution artifact limit. Large output must be persisted and referenced. Defaults must be configurable and conservative. |
| 8 | `awaiting_input` | Support in domain model and fake-adapter tests. Real Claude Code support requires a structured or versioned adapter signal. Stderr pattern matching may exist only as an explicitly documented fallback, not the primary mechanism. |
| 9 | `hco_task_start` | Deprecated. Route through a compatibility boundary alongside `hco_session_start`. Do not add new features to either. |
| 10 | Telegram | Move outside HCO execution core under an optional integration boundary, or remove if unused. |

---

## Current-State Assessment (HCO 1.0.0)

### Aligned

| Component | Location | Notes |
|-----------|----------|-------|
| SQLite persistence with WAL, migrations, FK pragmas | `src/state/db.ts` | Migrations v1–v6, append-only triggers, schema version tracking |
| `claude_sessions` state machine | `src/claude/session.ts` | `start → running → exited/failed/stopped → archived`, validated transitions |
| Append-only `session_events` table | `src/state/db.ts` (v4) | UPDATE/DELETE triggers enforce immutability |
| `ProcessRunner` interface + `SpawnRunner` | `src/claude/runner.ts` | Output capture to files, timeout vs abort distinction, stream durability |
| Repo path validation | `src/claude/launcher.ts` | Absolute path, exists, is directory, rejects symlink traversal, resolves realpath |
| Environment filtering | `src/claude/launcher.ts` | Only whitelisted env keys reach child process |
| Secret sanitization | `src/mcp/errors.ts` | Regex-based redaction of API keys, tokens, bearer auth |
| Bounded input validation (Zod) | `src/mcp/server.ts`, `src/jobs/service.ts` | Max lengths, JSON-serializability checks |
| Lease-based job claiming | `src/jobs/service.ts` | `claimJob`/`releaseExpiredJobs`/`renewJobLease` with worker ownership |
| Config schema | `src/config/schema.ts` | Allowlist, authority policy, Claude bridge config |
| Safe file read with traversal protection | `src/repos/files.ts` | Rejects `..`, symlinks, path escapes, enforces byte caps |

### Partially Aligned

| Component | Issue | Fix direction |
|-----------|-------|---------------|
| MCP tool handlers | `handleSessionStart()` creates DB records and spawns processes directly — no intermediate execution service | Insert an `ExecutionService` layer between MCP handlers and Claude adapter |
| `claude_sessions` table | Close to the `Execution` concept but mixed with process-attempt concerns (pid, output_path) | New `executions` table becomes authoritative; `claude_sessions` frozen for migration |
| `hco_session_start` input | Takes `{owner, repo, repo_path, prompt}` only — no structured brief, no config profile, no validation request | Introduce `ExecutionRequest` with separate brief, config, and policy sections |
| `session_events` table | Append-only but scoped to Claude session lifecycle, not full execution lifecycle | New `execution_events` table for execution lifecycle; existing `session_events` frozen |
| Job daemon (`src/daemon/main.ts`) | Uses job queue as parallel execution path; independent from MCP session start | Freeze legacy daemon; new daemon consumes `ExecutionService` |
| `hco_task_start` tool | Duplicates `hco_session_start` exactly | Route through compatibility boundary; deprecate alongside `hco_session_start` |
| Session continuation | `checkpoint_path` column exists but no MCP tool for resume | Add `hco_execution_continue` tool in Phase 3 with proper continuation contract |
| Config profiles | Single `claude` config section; no named profiles | Add `execution_profiles` and `provider_profiles` to config |

### Misplaced

| Component | Location | Should be |
|-----------|----------|-----------|
| Telegram report formatting | `src/validation/telegram.ts` | Move to `src/integrations/telegram.ts` under optional integration boundary, or remove if unused |
| MCP client connection tracking | `sessions` table (migration v1) | Keep but rename to `mcp_connections` to avoid collision with Claude sessions |
| CLI report wrapper | `src/reporting/cli.ts` | Merge into CLI directly or remove (one-line passthrough) |

### Missing

| Capability | Priority |
|------------|----------|
| `ExecutionRequest` — structured Hermes brief with Claude config | Phase 1 (2.0-A1) |
| `ClaudeConfiguration v1` — separate contract for Claude setup | Phase 1 (2.0-A1) |
| `Execution` entity — durable unit tracked through MCP | Phase 1 (2.0-A2) |
| `ExecutionProfile` — named Claude defaults + allowed overrides | Phase 1 (2.0-A2) |
| `PolicySnapshot` — recorded policy state at submission time | Phase 1 (2.0-A2) |
| `ExecutionResult` — structured terminal result | Phase 1 (2.0-A1) |
| `Artifact` — versioned bounded output storage with multi-tier limits | Phase 2 |
| Execution service layer (decouples MCP from Claude adapter) | Phase 1 (2.0-A3) |
| `awaiting_input` handling with structured adapter signal | Phase 2 |
| Provider profile system (env var references, no DB-stored secrets) | Phase 4 |
| Real MCP protocol tests (stdio transport, init, tools/list, tool calls) | Phase 1 (2.0-A3) |
| Post-restart cancellation recovery | Phase 2 |
| Validation execution (Hermes-requested lint/test/build post-Claude) | Phase 4 |

### Should Be Removed or Isolated

| Item | Disposition |
|------|------------|
| `hco_task_start` tool | Route through compatibility boundary with `hco_session_start`; freeze new development; deprecate |
| `hco_inspect_job`, `hco_list_jobs`, `hco_list_milestones` (H0-era read-only tools) | Deprecate after Phase 3 execution tools land; keep for HCO 1.0.0 compat |
| Jobs table + daemon worker as primary execution path | Freeze; daemon will eventually consume `ExecutionService` |
| `src/validation/telegram.ts` | Move to `src/integrations/telegram.ts` under optional integration boundary, or remove if unused |
| `src/reporting/cli.ts` | Remove (one-line passthrough to `formatTelegramReport`) |

---

## How HCO 1.0.0 Currently Routes an MCP Call to Claude Code

```
MCP Client (Hermes)
  │
  ▼
StdioServerTransport
  │
  ▼
McpServer (11 registered tools)
  │
  ├─ hco_status            → reads DB directly
  ├─ hco_list_jobs         → reads DB directly
  ├─ hco_inspect_job       → reads DB directly
  ├─ hco_list_milestones   → reads DB directly
  ├─ hco_session_list      → calls listSessions(db)
  ├─ hco_session_status    → calls getSession(db) + getSessionEvents(db)
  ├─ hco_session_wait      → calls launcher.wait()
  ├─ hco_session_stop      → calls launcher.abort()
  ├─ hco_session_archive   → calls launcher.archive()
  ├─ hco_session_start     → calls launcher.launch() ─┐
  └─ hco_task_start        → calls launcher.launch() ─┤
                                                       ▼
                                              ClaudeLauncher
                                                ├─ isRepoAllowed()
                                                ├─ validateRepoPath()
                                                ├─ createSession(db)
                                                ├─ appendSessionEvent(db)
                                                ├─ transitionToRunning(db)
                                                ├─ SpawnRunner.run()
                                                │    └─ spawn('claude', ['-p', prompt], {cwd, env, timeout})
                                                └─ onExit callback
                                                     ├─ setSessionOutputs(db)
                                                     ├─ transitionToExited/Failed(db)
                                                     └─ appendSessionEvent(db)
```

**Key architectural leak:** MCP handler → DB write + process spawn in a single call chain. No execution service, no request persistence before launch, no decoupling.

---

## Architecture Conflicts

1. **Terminology collision: "session"** — `sessions` table (MCP client connections) vs `claude_sessions` table (Claude Code processes). Both are called "sessions" in tools and handlers.

2. **Two execution paths**: Daemon uses `jobs` table + `JobWorker` polling loop; MCP uses `claude_sessions` + direct `ClaudeLauncher`. These are disconnected — a job created via `createJob()` won't be picked up by an MCP call, and an `hco_session_start` call doesn't create a job record.

3. **No request immutability**: `hco_session_start` takes `{owner, repo, repo_path, prompt}` but stores only session metadata. The Hermes brief is treated as a launch argument, not a persisted contract.

4. **Global mutable state**: `ServerState` singleton (`let state: ServerState`) holds db and launcher references. MCP handlers mutate this directly.

5. **Optional launcher**: The MCP server can start without a launcher (`launcher: undefined`), making write tools return `LAUNCHER_UNAVAILABLE`. The server should either always have a launcher or fail fast at startup.

6. **No stdio discipline enforcement**: `src/cli/main.ts` and `src/daemon/main.ts` write to `console.log()` directly. If the MCP server were to accidentally write to stdout, it would corrupt the stdio transport. No guard prevents this.

---

## Reusable Foundations

| Foundation | Reuse Strategy |
|------------|---------------|
| SQLite + WAL + migration system (`src/state/db.ts`) | Keep; add v7 migration for new domain tables |
| `ClaudeSession` state machine (`src/claude/session.ts`) | Evolve into `Execution` state machine; keep valid-transition pattern |
| `session_events` append-only pattern | Keep pattern; new `execution_events` table uses same trigger-based immutability |
| `SpawnRunner` + `ProcessRunner` interface | Keep as `ClaudeCodeAdapter` implementation |
| `validateRepoPath()` | Keep; call from execution service, not MCP handler |
| Environment filtering (`filterEnv`) | Keep; extend to support provider profiles |
| Secret sanitization (`sanitize()`) | Keep; apply to execution results, artifacts, and MCP responses |
| Zod input validation patterns | Keep; extend to `ExecutionRequest`, `ClaudeConfiguration`, `ExecutionProfile` schemas |
| Lease-based claiming (`claimJob`, `releaseExpiredJobs`, `renewJobLease`) | Adapt for execution queue ownership |
| Config schema (`HcoConfig`) | Extend with `executionProfiles` and `providerProfiles` sections |
| `AppContext` pattern (`src/core/context.ts`) | Keep; add execution service and repository to context |

---

## Target Architecture

Current (HCO 1.0.0):

```
MCP handler
→ DB
→ ClaudeLauncher
→ SpawnRunner
```

Target (HCO 2.0.0):

```
MCP handler
→ ExecutionService
→ ExecutionRepository
→ durable queue
→ worker
→ ClaudeCodeAdapter
→ ProcessRunner
```

The MCP submission call must not remain synchronously attached to the full Claude Code process lifetime.

---

## Canonical Domain Model

```
ExecutionRequest
        │
        ▼
Execution
        │
        ▼
ClaudeSession
        │
        ▼
ProcessAttempt
```

Supporting domain objects:

- `ExecutionProfile` — named Claude defaults + allowed overrides
- `ClaudeConfiguration` — per-request Claude setup, separate from the engineering brief
- `PolicySnapshot` — exact allowlist, authority, and concurrency state at submission time
- `ExecutionEvent` — append-only lifecycle record
- `Artifact` — bounded output, logs, validation output, or metadata with multi-tier size limits
- `ExecutionResult` — compact terminal result returned to Hermes

Artifact size limits (four separate tiers):

| Tier | Purpose | Default | Configurable |
|------|---------|---------|-------------|
| Inline MCP response limit | Maximum JSON payload returned directly in MCP tool response | 64 KiB | Yes |
| Event chunk limit | Maximum single `ExecutionEvent` payload | 256 KiB | Yes |
| Individual artifact limit | Maximum single artifact file on disk | 10 MiB | Yes |
| Total per-execution limit | Maximum sum of all artifacts for one execution | 100 MiB | Yes |

Large output must be persisted and referenced via artifact keys. Truncation beyond the total per-execution limit appends a truncation marker.

---

## Phase 1: Execution Contract and Submission

Phase 1 is split into three atomic milestones. Each produces exactly one commit.

### Milestone 2.0-A1: Execution Contract v1

**One responsibility:** Define the Zod schemas, TypeScript types, and validation logic for every contract object. No database. No MCP tool. No Claude adapter. No process launch.

**Scope:**

- `ExecutionRequest v1`:
  ```text
  {
    brief: {
      original_request: string,
      objective: string,
      context: string,
      constraints: string[],
      acceptance_criteria: string[],
      requested_validation: string[],
    },
    claude_config: {
      profile?: string,
      overrides?: {
        model?: string,
        thinking_effort?: string,
        skills?: string[],
        permission_mode?: string,
      },
    },
    repository: {
      owner: string,
      repo: string,
      path: string,
    },
    policy_ref: string,
    idempotency_key?: string,
    schema_version: number,
  }
  ```
- `ClaudeConfiguration v1` (extracted from `ExecutionRequest.claude_config` as a standalone contract):
  ```text
  {
    profile?: string,
    overrides?: {
      model?: string,
      thinking_effort?: string,
      skills?: string[],
      permission_mode?: string,
    },
  }
  ```
- `ExecutionResult v1`:
  ```text
  {
    execution_id: string,
    status: 'completed' | 'failed' | 'cancelled' | 'timed_out',
    claude_session_id: string,
    summary: {
      exit_code: number | null,
      duration_ms: number,
      artifacts: [{ key: string, artifact_id: string, content_type: string, byte_length: number }],
    },
    validation_results?: [{ profile: string, passed: boolean, command_results: [...] }],
    error?: { code: string, message: string },
    submitted_at: string,
    started_at: string | null,
    finished_at: string,
  }
  ```
- `ExecutionProfile v1` (config-level, not per-request):
  ```text
  {
    name: string,
    claude: {
      binary_path: string,
      allowed_env: string[],
      default_model?: string,
      default_thinking_effort?: string,
      default_timeout_ms: number,
      session_dir: string,
    },
    allowed_overrides: string[],
    repository_allowlist: [{ owner: string, repo: string }],
    max_prompt_bytes: number,
    max_execution_time_ms: number,
  }
  ```
- `PolicySnapshot v1` — captures the exact allowlist, authority, and concurrency state at submission time
- `schema_version` field on `ExecutionRequest` with contract-version validation
- Stable bounded validation errors for every schema (field-level messages, no stack traces)

**Idempotency key design (binding decision #1):**
- `idempotency_key` is optional on `ExecutionRequest`
- When Hermes provides it, HCO uses it for deduplication
- When absent, HCO generates a random unique key (e.g., UUID v4)
- Do NOT compute a deterministic hash from prompt content

**Files likely affected:**

- `src/contract/execution-request.ts` (new)
- `src/contract/claude-configuration.ts` (new)
- `src/contract/execution-result.ts` (new)
- `src/contract/execution-profile.ts` (new)
- `src/contract/policy-snapshot.ts` (new)
- `src/contract/version.ts` (new — schema_version validation)
- `src/contract/errors.ts` (new — bounded validation error types)
- `tests/contract-execution-request.test.ts` (new)
- `tests/contract-claude-configuration.test.ts` (new)
- `tests/contract-execution-result.test.ts` (new)
- `tests/contract-execution-profile.test.ts` (new)
- `tests/contract-policy-snapshot.test.ts` (new)
- `tests/contract-version.test.ts` (new)

**Non-goals:**
- No database migration
- No MCP tool registration
- No Claude adapter
- No process launch
- No filesystem I/O outside of test fixtures

**Required tests:**

1. `ExecutionRequest` schema rejects missing required fields
2. `ExecutionRequest` schema rejects oversized strings
3. `ExecutionRequest` schema rejects invalid enum values
4. `ExecutionRequest` schema accepts minimum valid request
5. `ExecutionRequest` schema accepts full request with all optional fields
6. `ExecutionRequest` with absent `idempotency_key` validates successfully
7. `ExecutionRequest` with present `idempotency_key` validates successfully
8. `ClaudeConfiguration` schema rejects overrides not in a known set
9. `ClaudeConfiguration` schema accepts valid overrides
10. `ExecutionResult` schema round-trips: serialize → deserialize → compare
11. `ExecutionProfile` schema rejects overrides outside `allowed_overrides`
12. `ExecutionProfile` schema accepts valid configuration
13. `PolicySnapshot` captures all policy fields at construction time
14. `schema_version` rejects unsupported version numbers
15. All validation errors are stable strings (no `[object Object]`, no stack traces)
16. Contracts serialize to and deserialize from JSON predictably

**Exit condition:**

Valid contracts round-trip predictably and malformed contracts fail with stable errors. `npm test && npm run build` passes all contract tests.

**Commit:**

```
feat(execution): define Execution Contract v1
```

---

### Milestone 2.0-A2: Immutable Execution Persistence

**One responsibility:** Store execution requests durably with idempotency guarantees. No Claude process launch. No MCP tool wiring. No validation execution.

**Scope:**

- Database migration v7:
  - `executions` table: stores immutable request payload, status, policy snapshot reference
  - `execution_events` table: append-only lifecycle events (same trigger pattern as `session_events`)
  - Unique constraint on `idempotency_key`
- `ExecutionRepository`:
  - `createExecution(request: ExecutionRequest, profile: ExecutionProfile, policy: PolicySnapshot): Execution`
  - `getExecution(id: string): Execution | null`
  - `listExecutions(filter): Execution[]`
  - `getExecutionByIdempotencyKey(key: string): Execution | null`
- Idempotency logic:
  - If `idempotency_key` is provided and matches an existing execution with identical request content, return the existing execution
  - If `idempotency_key` is provided and matches an existing execution with different content, reject with a stable error
  - If `idempotency_key` is absent, generate a random UUID v4 and store it
- `PolicySnapshot` serialization: the snapshot stored alongside the execution at insertion time
- Immutable payload: the serialized `ExecutionRequest` is stored as-is; retrieval must return it byte-for-byte or structurally unchanged

**Files likely affected:**

- `src/state/db.ts` (migration v7)
- `src/state/execution-repository.ts` (new)
- `src/state/idempotency.ts` (new — key generation)
- `tests/execution-repository.test.ts` (new)
- `tests/execution-persistence.test.ts` (new)
- `tests/state-migration-v7.test.ts` (new)

**Non-goals:**
- No MCP tool
- No Claude process launch
- No validation execution
- No state machine transitions beyond `accepted`

**Required tests:**

1. `createExecution()` persists an execution and returns it with status `accepted`
2. Retrieved execution matches submitted `ExecutionRequest` structurally
3. `idempotency_key` is auto-generated when absent (UUID format)
4. Duplicate `idempotency_key` with identical content returns the existing execution (idempotent)
5. Duplicate `idempotency_key` with different content throws a stable `ConflictingExecutionError`
6. `getExecution()` returns null for unknown ID
7. `listExecutions()` filters by status
8. `PolicySnapshot` stored at insertion time matches config state at that moment
9. Migration v7 applies cleanly on top of v6 database
10. Migration v7 is idempotent (run twice, no error)
11. `execution_events` table rejects UPDATE and DELETE via triggers
12. Existing HCO 1.0.0 tables are not affected by migration v7

**Exit condition:**

An execution request can be inserted, retrieved byte-for-byte or structurally unchanged, and deduplicated using an explicit `idempotency_key`. `npm test && npm run build` passes all persistence tests.

**Commit:**

```
feat(execution): persist immutable execution requests
```

---

### Milestone 2.0-A3: MCP Submission Boundary

**One responsibility:** Wire the execution submission through real MCP transport with a decoupled handler-to-service architecture. No Claude process launch.

**Scope:**

- `ExecutionService.submit(request: ExecutionRequest): Execution`
  - Delegates to `ExecutionRepository`
  - Does NOT launch Claude Code
  - Returns the persisted execution
- `hco_execution_submit` MCP tool:
  - Registered via `server.registerTool()`
  - Input: `ExecutionRequest` JSON
  - Output: `{ execution_id, status, accepted_at }`
  - Handler calls `ExecutionService.submit()`, does NOT call `ClaudeLauncher` directly
- Actual MCP protocol tests:
  1. Start HCO MCP server as a child process
  2. Complete MCP initialization handshake
  3. Call `tools/list` and verify `hco_execution_submit` is registered with correct input schema
  4. Invoke `hco_execution_submit` with a valid `ExecutionRequest` and verify structured response
  5. Invoke `hco_execution_submit` with a malformed request and verify bounded error
  6. Verify `execution_id` in the response matches the persisted execution
  7. Verify the execution status is `accepted`
  8. Verify stdout contains only JSON-RPC messages (no banners, no logs)
- Expected flow:
  ```text
  MCP handler
  → ExecutionService.submit()
  → ExecutionRepository.createExecution()
  → structured response
  ```

**Files likely affected:**

- `src/execution/service.ts` (new — `submit()` only in this milestone)
- `src/mcp/server.ts` (add `hco_execution_submit` handler; no removal of existing tools)
- `src/mcp/logging.ts` (new — stderr logger, stdout purity guard)
- `src/index.ts` (wire execution service into context)
- `src/core/context.ts` (extend `AppContext` with execution repository)
- `tests/mcp-submit.test.ts` (new — real MCP protocol tests)
- `tests/mcp-stdio-discipline.test.ts` (new)
- `tests/execution-service-submit.test.ts` (new)

**Non-goals:**
- No Claude process launch
- No state machine transitions beyond `accepted`
- No `hco_execution_status`, `hco_execution_wait`, or other execution tools
- No removal or deprecation of existing HCO 1.0.0 tools
- No `ClaudeCodeAdapter` (still uses `ClaudeLauncher` for legacy tools only)

**Required tests:**

1. `ExecutionService.submit()` returns a persisted execution with status `accepted`
2. `ExecutionService.submit()` does not spawn any process
3. Real MCP: `tools/list` returns `hco_execution_submit` in the tool list
4. Real MCP: `hco_execution_submit` with valid input returns `{ execution_id, status: "accepted", accepted_at }`
5. Real MCP: `hco_execution_submit` with missing required fields returns `{ error: { code, message } }`
6. Real MCP: `hco_execution_submit` with oversized input returns `{ error: { code, message } }`
7. Real MCP: duplicate `idempotency_key` with same content returns the existing execution
8. Real MCP: duplicate `idempotency_key` with different content returns a stable conflict error
9. Real MCP: stdout contains ONLY JSON-RPC messages
10. Real MCP: stderr contains diagnostic output (no secrets)
11. Handler does not reference `ClaudeLauncher`
12. Existing HCO 1.0.0 tools continue to function

**Exit condition:**

```
MCP initialize
→ tools/list
→ hco_execution_submit
→ execution persisted
→ execution_id and accepted status returned
→ stdout pure MCP protocol
```

`npm test && npm run build` passes all MCP submission tests.

**Commit:**

```
feat(mcp): expose durable execution submission
```

---

## Phase 2: Durable Runtime

**One responsibility:** Build the execution state machine, queue, Claude Code adapter, and lifecycle management so a persisted execution survives restarts, cancellations, and timeouts.

Phase 2 milestones will be detailed after Phase 1 is complete. The outline below captures the scope commitments.

### Scope (summary)

- Define `Execution` state machine:
  ```text
  accepted → queued → running → completed
                            ├→ failed
                            ├→ cancelled
                            ├→ timed_out
                            └→ awaiting_input
  ```
  Any terminal state permits one transition to `archived`.
- Implement `ExecutionService` (extended from 2.0-A3):
  - `start(executionId: string): Execution`
  - `cancel(executionId: string, reason: string): Execution`
  - `getStatus(executionId: string): Execution`
  - `wait(executionId: string, timeoutMs?: number): Execution`
  - `getResult(executionId: string): ExecutionResult`
  - `continue(executionId: string, prompt: string): Execution`
- Implement `ClaudeCodeAdapter` (refactors `ClaudeLauncher`):
  - `launch(execution: Execution, profile: ExecutionProfile): ProcessAttempt`
  - `attach(executionId: string): ProcessAttempt | null` (restart recovery)
  - `abort(executionId: string): void`
- Implement `ProcessAttempt` entity:
  - Fields: `id`, `execution_id`, `pid`, `started_at`, `finished_at`, `exit_code`, `timed_out`, `aborted`
  - Separate from `Execution` — one execution can have multiple attempts
- Implement execution queue with lease ownership (adapt from `src/jobs/service.ts`)
- Implement timeout enforcement from `ExecutionProfile.max_execution_time_ms`
- Implement restart recovery (expired leases → `failed`, do NOT kill orphaned PIDs)
- Implement `awaiting_input`:
  - Support in domain model and fake-adapter tests
  - Real Claude Code detection requires a structured or versioned adapter signal
  - Stderr pattern matching is an explicitly documented fallback only
- Implement artifact storage with four-tier size limits (binding decision #7)
- Prevent duplicate billable execution via `idempotency_key` + `ProcessAttempt` tracking

### Dependencies

- Phase 1 (2.0-A1, 2.0-A2, 2.0-A3)
- HCO 1.0.0: `SpawnRunner`, `ClaudeSession` CRUD, lease claiming logic

### Non-Goals (Phase 2)

- Do not add MCP tools (Phase 3)
- Do not implement provider profiles (Phase 4)
- Do not modify the legacy daemon/jobs system
- Do not implement validation execution post-Claude (Phase 4)
- Do not handle Hermes integration format (Phase 4)

---

## Phase 3: MCP Execution API

**One responsibility:** Expose the execution lifecycle through stable, bounded MCP tools with real MCP protocol tests.

Phase 3 milestones will be detailed after Phase 2 is complete.

### Scope (summary)

Define and register 7 MCP tools:

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `hco_execution_submit` | Submit an execution request | `ExecutionRequest` JSON | `{ execution_id, status, accepted_at }` |
| `hco_execution_status` | Get current execution state | `{ execution_id }` | Execution status + latest event |
| `hco_execution_wait` | Block until terminal state | `{ execution_id, timeout_ms? }` | `ExecutionResult` |
| `hco_execution_continue` | Resume a completed/failed execution | `{ execution_id, continuation_prompt }` | `{ execution_id, status }` |
| `hco_execution_cancel` | Cancel a running or queued execution | `{ execution_id, reason? }` | `{ execution_id, status }` |
| `hco_execution_result` | Get structured terminal result | `{ execution_id }` | `ExecutionResult` |
| `hco_execution_artifact` | Retrieve a named artifact | `{ execution_id, artifact_key }` | `{ artifact_id, content_type, data?, truncated? }` |

Key design rules:
- All input schemas via Zod with max lengths and enum validation
- All responses are `{ data: T }` or `{ error: { code, message } }`
- Large output stored as artifacts, referenced by key, never inlined
- Artifact responses respect the four-tier size limits (binding decision #7)
- Inline MCP responses are capped; larger content requires artifact retrieval

### Stdio Discipline

- stdout = MCP protocol ONLY
- stderr = diagnostic logs
- No `console.log()` in MCP server path
- Startup guard validates stdout hasn't been written to before MCP connect

### Deprecation Strategy

- `hco_task_start` and `hco_session_start` routed through compatibility boundary, emit deprecation warning to stderr
- `hco_session_list`, `hco_session_status`, `hco_session_wait`, `hco_session_stop`, `hco_session_archive` deprecated
- `hco_status`, `hco_list_jobs`, `hco_inspect_job`, `hco_list_milestones` remain for read-only legacy access

### Non-Goals (Phase 3)

- No provider profile resolution (Phase 4)
- No Hermes handoff format (Phase 4)
- No modification of legacy daemon or CLI tools
- No removal of deprecated tools

---

## Phase 4: Hermes Integration and Release

**One responsibility:** Define the Hermes-to-HCO contract, provider profiles, validation execution, compatibility strategy, and release gate.

Phase 4 milestones will be detailed after Phase 3 is complete.

### Scope (summary)

- Hermes-to-HCO handoff format (versioned JSON, `hermes_trace_id` for correlation)
- Provider profiles (env var references only, per binding decision #2):
  ```text
  {
    provider_profiles: {
      "toche-builder": {
        type: "anthropic",
        api_key_env: "ANTHROPIC_API_KEY_TOCHE",
        base_url_env: "ANTHROPIC_BASE_URL_TOCHE",
      },
    }
  }
  ```
- Profile resolution: `profile` on `ClaudeConfiguration` maps to `ExecutionProfile` + `ProviderProfile`
- Override validation against `ExecutionProfile.allowed_overrides`
- Approval boundaries via `PolicySnapshot.authority.mode` (`locked` / `interactive` / `auto`)
- Post-Claude validation execution (`quick`/`standard`/`strict`)
- Health and compatibility tools (`hco_health`, `hco_compatibility`)
- HCO 1.0.0 state migration script (dry-run mode)
- Real Claude Code acceptance tests (mandatory for release gate, per binding decision #3)
- Telegram logic moved to `src/integrations/telegram.ts` or removed (binding decision #10)

### Non-Goals (Phase 4)

- Do not build a Hermes Agent
- Do not implement cost tracking or billing
- Do not implement multi-tenant isolation
- Do not build a web UI or dashboard
- Do not publish to npm (package remains `private: true`)

---

## MCP Testing Requirements (All Phases)

Every phase that touches MCP MUST include:

1. Start the actual HCO MCP server as a child process
2. Complete MCP initialization handshake
3. Call `tools/list` and verify the real registered tool surface
4. Invoke representative tools through MCP
5. Verify structured responses match documented schema
6. Verify malformed requests produce stable bounded errors
7. Verify execution IDs persist across calls
8. Verify large output is returned through artifact references
9. Verify no normal logs corrupt MCP stdio

Stdio discipline rule:
- stdout = MCP protocol ONLY
- stderr = diagnostics
- No `console.log()` or banners on stdout in the MCP server path

---

## Responsibility Boundaries

### Hermes Owns
- User intent, prompt refinement, architecture, task decomposition
- Project memory, acceptance criteria, Claude configuration selection
- Result review, retry/continuation decisions, deciding whether work is complete

### HCO Owns
- MCP server behavior, schema validation, durable execution
- Policy enforcement, repository boundaries, provider/secret profile activation
- Claude Code process and session lifecycle, output capture, artifacts
- Recovery, validation execution, compact structured results

### Claude Code Owns
- Repository inspection, implementation, file editing, commands, tests
- Debugging, local engineering decisions

### HCO Must NOT Become
- A prompt improver, planner, architecture agent, code reviewer
- A semantic retry engine, project-memory system, repository indexing system
- A Telegram conversation system, autonomous GitHub merger, deployment orchestrator

---

## First Implementation Target

**Milestone 2.0-A1: Execution Contract v1** — Zod schemas, TypeScript types, contract-version validation, stable bounded errors. No database. No MCP. No Claude.

Followed immediately by **2.0-A2** (immutable persistence) and **2.0-A3** (MCP submission boundary with real protocol tests).

---

## Atomic Milestone Summary (Phase 1)

| Milestone | Commit | Responsibility | DB? | MCP? | Claude? |
|-----------|--------|---------------|-----|------|---------|
| 2.0-A1 | `feat(execution): define Execution Contract v1` | Zod schemas, types, contract-version validation, stable errors | No | No | No |
| 2.0-A2 | `feat(execution): persist immutable execution requests` | Migration v7, `ExecutionRepository`, idempotency | Yes | No | No |
| 2.0-A3 | `feat(mcp): expose durable execution submission` | `ExecutionService.submit()`, `hco_execution_submit`, real MCP protocol tests | Yes | Yes | No |
