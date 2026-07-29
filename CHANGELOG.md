# Changelog

## 2.1.2

### Added

- **Guided setup wizard** (`hco setup`): progressive linear onboarding that walks a first-time
  user through connecting HCO to Hermes and Claude Code — local preflight, provider
  configuration, and integration.
- **Setup CLI commands**: `hco setup`, `hco setup --status`, `hco setup --continue`,
  `hco setup --repair`, `hco setup --reset`.
- **Credential lifecycle**: API keys stored only in `/root/.config/hermes/hco.env` (mode 0600,
  directory 0700), referenced via `${ANTHROPIC_API_KEY}` interpolation in Hermes YAML; never
  written to SQLite, setup state, logs, or environment output.
- **Systemd EnvironmentFile drop-in**: automatic installation of
  `/root/.config/systemd/user/hermes-gateway.service.d/hco-env.conf` so Hermes loads
  provider credentials at startup.
- **Provider validation during setup**: temporary process-env injection for single-shot
  credential validation, restored after — no persistent env changes.
- **Model discovery and mapping**: automatic model list, sorted selection
  (sonnet/haiku/opus/fable), mapping recommendation and activation.
- **Repository allowlist integration**: optional allowlist configuration with path validation
  during the integration stage.
- **Hermes MCP YAML management**: reads/writes `/root/.hermes/config.yaml` under
  `mcp_servers.hco`, backs up before write, restores on failure, preserves unrelated keys.
- **Setup state persistence**: `setup-state.json` tracks stage progression (local, provider,
  integration), resume points, and terminal failures.
- **Secret sanitization**: `src/setup/redact.ts` extends the existing MCP `sanitize()` with
  env-file patterns — API keys, base URLs, and generic KEY/SECRET/TOKEN/PASSWORD assignments
  are redacted from all setup output.
- **Setup test suites**: 35 new tests covering state, redaction, Hermes YAML/env/drop-in,
  provider registration, local preflight, secrets, CLI status, integration, and external module
  validation.

### Security

- **No secrets in state**: setup-state.json, SQLite, YAML config, logs, and error messages
  never contain raw API keys.
- **Protected env file**: `hco.env` is 0600 with 0700 parent directory, verified via
  `verifySecretFilePermissions()`.
- **Safe Hermes YAML**: only `${ANTHROPIC_API_KEY}` and `${ANTHROPIC_BASE_URL}` variable
  references are written — never raw values.

---


### Fixed

- **Missing shebangs**: `hco` and `hco-daemon` binaries lacked `#!/usr/bin/env node`,
  causing shell syntax errors on Linux installs.
- **Version mismatch**: CLI and daemon hardcoded `2.0.0` while `package.json` read `2.1.0`.
- **Unsafe concurrency default**: `maxConcurrency` defaulted to 4; changed to 1 for
  safe first-time use.
- **Missing Claude diagnostics**: `MissingClaudeError` now provides a clear message with
  install link when the `claude` binary is absent.
- **Runner stream durability**: `pendingStreams` tracking ensures both stdout and stderr
  finalize before delivering results.

### Added

- **`--version` / `-v` flag** on the CLI.
- **Centralized version**: `src/core/version.ts` reads from `package.json` at runtime
  — single source of truth for CLI, daemon, and MCP server.
- **npm-pack acceptance test** (13 tests): validates the tarball as users receive it —
  entrypoints, shebangs, install, CLI commands, SQLite creation.
- **MCP stdio smoke test** (6 tests): full JSON-RPC handshake, tool listing, execution
  submit/status/cancel lifecycle over stdio transport.
- **`.npmignore`**: excludes `src/`, `tests/`, and git metadata from the published tarball.

### Changed

- **README**: rewritten setup section with step-by-step install, verify, configure, and
  connect instructions.
- **Identity**: "Hermes Code Operator" → "Hermes Claude Operator" across all docs.

---

## 2.1.0

### Added

- **Execution Contract v1**: `ExecutionRequest`, `ClaudeConfiguration`, `ExecutionResult`,
  `ExecutionProfile`, `PolicySnapshot` — stable Zod schemas with bounded validation.
- **Immutable execution persistence**: `executions` and `execution_events` tables
  (migrations v7-v10) with append-only event log and idempotency guarantees.
- **State machine**: validated transitions from `accepted` through `queued`, `running`,
  terminal states, and `awaiting_input`.
- **ExecutionService**: decouples MCP handlers from process launch. Supports `submit`,
  `start`, `getStatus`, `getResult`, `wait`, `cancel`, `continue`.
- **ClaudeCodeAdapter**: abstract interface with `FakeClaudeCodeAdapter` (tests) and
  `SpawnAdapter` (real Claude Code).
- **ProcessAttempt persistence**: every real launch records start, end, exit code, pid,
  and outcome in the database.
- **Execution queue**: FIFO with lease-based claiming, timeout enforcement, and
  expired-lease recovery.
- **ArtifactStorage**: four-tier size enforcement (inline, chunk, per-artifact,
  per-execution) with chunked BLOB storage.
- **7 execution MCP tools**: `hco_execution_submit`, `start`, `status`, `wait`, `cancel`,
  `result`, `continue`, `artifact`.
- **Provider profiles**: env-var references only, no DB-stored secrets. Anthropic
  provider adapter.
- **Post-Claude validation**: `quick`/`standard`/`strict` profiles running
  build/test/lint/format/diff-check.
- **Workspace management**: isolated workspace persistence with `WorkspaceRepository`
  and `WorkspaceService`, plus MCP workspace operations with execution binding.
- **Health check framework**: systematic `hco_health` diagnostic tool.
- **Execution statistics**: aggregate stats for operational intelligence.

### Changed

- **Legacy tools deprecated**: `hco_session_*`, `hco_task_*`, `hco_status`, `hco_list_jobs`,
  `hco_inspect_job`, `hco_list_milestones` emit deprecation warnings.
- **Architecture**: MCP handlers no longer directly spawn Claude processes. Execution
  flows through `ExecutionService → ExecutionRepository → ClaudeCodeAdapter`.

---

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
