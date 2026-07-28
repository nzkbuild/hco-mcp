# HCO 2.0.0 Release Notes

## Overview

HCO 2.0.0 is a major architectural release. It introduces the execution contract,
durable execution persistence, a decoupled execution service, ProcessAttempt
tracking, artifact storage, and a full set of MCP execution lifecycle tools.

## What's New

### Durable Execution Pipeline

The core of 2.0.0 is the execution pipeline:

```
ExecutionRequest → ExecutionService → ExecutionRepository → queue
                    → worker → ClaudeCodeAdapter → ProcessRunner
```

MCP handlers no longer directly spawn Claude processes. Every execution is
persisted, tracked through a validated state machine, and recoverable.

### ProcessAttempt Tracking

Every real process launch records:

- Attempt number (supports retry)
- PID
- Start and finish timestamps
- Exit code
- Timeout/cancellation status

Failed launches, timeouts, and cancellations all leave terminal attempt records.
Multiple `awaiting_input` cycles use a single attempt.

### Artifact System

Four-tier size enforcement:

1. Inline MCP response (64 KiB)
2. Event chunk (256 KiB)
3. Individual artifact (10 MiB)
4. Total per execution (100 MiB)

Artifacts are stored as chunked BLOBs and retrievable via `hco_execution_artifact`
with offset/limit pagination.

### Post-Claude Validation

Three profiles:

- `quick`: `npm run build`
- `standard`: build + test
- `strict`: build + test + lint + format + diff-check

Validation runs automatically on successful (exit_code=0) completions when
configured in the execution profile.

### Provider Profile System

Provider credentials are referenced via environment variables only:

```json
{
  "profile_id": "production",
  "provider": "anthropic",
  "api_key_env": "ANTHROPIC_API_KEY",
  "base_url_env": "ANTHROPIC_BASE_URL"
}
```

No API keys or secrets are stored in SQLite or passed through MCP.

## Breaking Changes from 1.x

1. The `ExecutionService` layer replaces direct `ClaudeLauncher` calls in MCP handlers.
2. Legacy tools (`hco_session_*`, `hco_task_*`) are deprecated and emit stderr warnings.
3. The job daemon (`jobs` table) is frozen; use `ExecutionService` for all new work.
4. Legacy `claude_sessions` table coexists but is no longer the execution authority.

## Migration

Run the migration tool with dry-run first:

```bash
node dist/migrate/migrate-v1-to-v2.js --data-dir /var/lib/hco --dry-run
```

Then remove `--dry-run` to execute. Only non-terminal legacy jobs are migrated.

## Compatibility

- Node.js >= 22 required
- Existing SQLite databases are migrated in-place (v7-v10)
- Legacy MCP tools remain registered and functional
- Legacy daemon continues to operate (frozen)

## Known Limitations

- `SpawnAdapter.attach()` returns null — restart reattachment not implemented. Restart reconciliation marks expired-lease executions safely and permits explicit retry.
- `awaiting_input` detection uses structured adapter signals; real Claude Code stderr pattern matching is a documented fallback, not the primary mechanism.
- Artifact limits are not runtime-configurable (hardcoded constants).
- No multi-tenant isolation (planned for 2.1.0).
- No cost tracking or billing (planned for 2.1.0).
- Acceptance tests require the `claude` CLI binary and `ANTHROPIC_API_KEY`.

## Acceptance Testing

Real Claude Code acceptance tests are opt-in:

```bash
HCO_ACCEPTANCE=1 HCO_ADAPTER=spawn npm run test:acceptance
```

These tests:

1. Start HCO MCP server as child process
2. Complete MCP handshake
3. Submit an execution request
4. Start/run/wait for Claude Code to complete real work
5. Verify repository state changes
6. Verify no secrets leak in responses
7. Test timeout behavior with short deadlines
