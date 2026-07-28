# Changelog

## 2.0.0

### Breaking Changes

- **New execution model**: `ExecutionRequest`, `Execution`, `ExecutionResult` replace the legacy `claude_sessions` + `ClaudeLauncher` model.
- **Legacy tools deprecated**: `hco_session_*`, `hco_task_*`, `hco_status`, `hco_list_jobs`, `hco_inspect_job`, `hco_list_milestones` emit deprecation warnings. New execution tools replace them.
- **Two execution paths unified**: The legacy daemon (`jobs` table) is frozen; all execution flows through `ExecutionService`.
- **Architecture changed**: MCP handlers no longer directly spawn Claude processes. Execution flows through `ExecutionService → ExecutionRepository → ClaudeCodeAdapter`.

### Added

- **Execution Contract v1**: `ExecutionRequest`, `ClaudeConfiguration`, `ExecutionResult`, `ExecutionProfile`, `PolicySnapshot` — stable Zod schemas with bounded validation.
- **Immutable execution persistence**: `executions` and `execution_events` tables (migrations v7-v10) with append-only event log and idempotency guarantees.
- **State machine**: Validated transitions from `accepted` through `queued`, `running`, terminal states (`completed`, `failed`, `cancelled`, `timed_out`), and `awaiting_input`.
- **ExecutionService**: decouples MCP handlers from process launch. Supports `submit`, `start`, `getStatus`, `getResult`, `wait`, `cancel`, `continue`.
- **ClaudeCodeAdapter**: abstract interface with `FakeClaudeCodeAdapter` (tests) and `SpawnAdapter` (real Claude Code).
- **ProcessAttempt persistence**: Every real launch records start, end, exit code, pid, and outcome in the database.
- **Execution queue**: FIFO queue with lease-based claiming, timeout enforcement, and expired-lease recovery.
- **ArtifactStorage**: Four-tier size enforcement (inline, chunk, per-artifact, per-execution) with chunked BLOB storage.
- **7 execution MCP tools**: `hco_execution_submit`, `start`, `status`, `wait`, `cancel`, `result`, `continue`.
- **hco_execution_artifact**: Bounded artifact retrieval with offset/limit, UTF-8 boundary safety, and content-type awareness.
- **Provider profiles**: Env-var references only, no DB-stored secrets.
- **Post-Claude validation**: `quick`/`standard`/`strict` profiles running build/test/lint/format/diff-check.
- **Real MCP protocol tests**: stdio transport, `tools/list`, tool invocations, structured error responses.
- **Real Claude Code acceptance tests**: Opt-in via `HCO_ACCEPTANCE=1 HCO_ADAPTER=spawn`.
- **Health and compatibility tools**: `hco_health` and `hco_compatibility`.
- **Legacy migration**: `migrate-v1-to-v2` with dry-run mode.
- **awaiting_input support**: Domain model + fake adapter + continue flow.
- **Telegram integration**: Isolated to `src/integrations/telegram.ts`.

### Changed

- **Telegram formatter**: Moved from `src/validation/telegram.ts` to `src/integrations/telegram.ts`.
- **CLI report formatter**: Removed (one-line passthrough; callers use telegram formatter directly).
- **Database migrations**: Reordered for correct numeric sequence (v5 before v6).

### Fixed

- **ProcessAttempt records**: Previously created/finished only in migration code; now wired into `ExecutionService.start()` and `onExit`.
- **Test coverage**: Added direct tests for `isValidTransition` and `setSessionCheckpointPath`.
- **Architecture leak**: `ClaudeLauncher` → MCP handler coupling; replaced by `ExecutionService` layer.

---

## 1.0.0

Initial release. Legacy daemon with job queue, `ClaudeLauncher`,
`claude_sessions` table, basic MCP session tools.
