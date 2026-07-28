# HCO 1.x to 2.0 Migration Guide

## Overview

HCO 2.0.0 introduces a new execution architecture. This guide covers migrating
from the legacy `claude_sessions` + `ClaudeLauncher` model to the new
`ExecutionService` + `ClaudeCodeAdapter` model.

## Breaking Changes

### Architecture

| 1.x                                             | 2.0.0                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| MCP handler → DB + ClaudeLauncher → SpawnRunner | MCP handler → ExecutionService → ExecutionRepository → ClaudeCodeAdapter → ProcessRunner |
| `claude_sessions` table                         | `executions` table (authoritative) + `claude_sessions` (frozen)                          |
| `hco_session_start`                             | `hco_execution_submit` + `hco_execution_start`                                           |
| `hco_session_status`                            | `hco_execution_status`                                                                   |
| `hco_session_wait`                              | `hco_execution_wait`                                                                     |
| `hco_session_stop`                              | `hco_execution_cancel`                                                                   |
| `hco_task_start`                                | `hco_execution_submit`                                                                   |
| Jobs table (daemon)                             | ExecutionService (canonical path)                                                        |

### Tool Deprecation Timeline

| Tool                  | Status                      | Replacement                                    |
| --------------------- | --------------------------- | ---------------------------------------------- |
| `hco_session_start`   | Deprecated (stderr warning) | `hco_execution_submit` + `hco_execution_start` |
| `hco_session_list`    | Deprecated                  | `hco_execution_status`                         |
| `hco_session_status`  | Deprecated                  | `hco_execution_status`                         |
| `hco_session_wait`    | Deprecated                  | `hco_execution_wait`                           |
| `hco_session_stop`    | Deprecated                  | `hco_execution_cancel`                         |
| `hco_session_archive` | Deprecated                  | Terminal states auto-recorded                  |
| `hco_task_start`      | Deprecated                  | `hco_execution_submit`                         |
| `hco_status`          | Available                   | `hco_health`                                   |
| `hco_list_jobs`       | Available                   | `hco_execution_status` (per execution)         |
| `hco_inspect_job`     | Available                   | `hco_execution_result`                         |
| `hco_list_milestones` | Available                   | No direct replacement                          |

## Database Migration

HCO 2.0.0 automatically applies migrations v7-v10 on startup:

- v7: `executions` + `execution_events` tables
- v8: execution queue (worker_id, lease_until)
- v9: process_attempts table
- v10: artifacts table with chunked BLOB storage

Legacy tables are not modified. The `claude_sessions` table remains for
historical data but is no longer the source of truth.

## Migrating Legacy Data

To migrate existing jobs to the execution model:

```bash
node dist/migrate/migrate-v1-to-v2.js --data-dir /var/lib/hco --dry-run
```

Review the output, then run without `--dry-run`:

```bash
node dist/migrate/migrate-v1-to-v2.js --data-dir /var/lib/hco
```

Only non-terminal legacy jobs (`pending`, `running`, `paused`) are migrated.
Existing `claude_sessions` are mapped to `ProcessAttempt` records where possible.

## Hermes Integration Changes

### Old (1.x)

```json
{
  "method": "tools/call",
  "params": {
    "name": "hco_session_start",
    "arguments": {
      "owner": "org",
      "repo": "project",
      "repo_path": "/path/to/repo",
      "prompt": "Fix the bug in auth"
    }
  }
}
```

### New (2.0.0)

```json
{
  "method": "tools/call",
  "params": {
    "name": "hco_execution_submit",
    "arguments": {
      "request_json": "{\"brief\":{\"original_request\":\"Fix the bug in auth\",\"objective\":\"Fix auth bug\",\"constraints\":[],\"acceptance_criteria\":[],\"requested_validation\":[]},\"claude_config\":{},\"repository\":{\"owner\":\"org\",\"repo\":\"project\",\"path\":\"/path/to/repo\"},\"policy_ref\":\"default\"}",
      "profile_json": "{\"profile_id\":\"default\",\"claude_defaults\":{\"default_timeout_ms\":300000,\"session_dir\":\"/tmp/hco\"},\"repository_allowlist\":[{\"owner\":\"org\",\"repo\":\"project\"}]}",
      "policy_json": "{\"repository_boundary\":{\"owner\":\"org\",\"repo\":\"project\",\"local_path\":\"/path/to/repo\"},\"timeout_ceiling_ms\":600000,\"max_concurrency\":4,\"approval_required\":false}"
    }
  }
}
```

Then:

```json
{
  "name": "hco_execution_start",
  "arguments": { "execution_id": "req-<id>" }
}
```

## Rollback Instructions

If you need to revert to 1.x behavior:

1. Stop all HCO processes
2. The database schema is forward-compatible — legacy tables are unchanged
3. Revert to HCO 1.0.0 binary
4. Legacy tools and daemon continue to function as before
5. New `executions` table data is preserved but unused by 1.x

## Recovery Notes

### Process Reattachment

`SpawnAdapter.attach()` returns null — live process reattachment after a server
restart is not implemented. Recovery behavior:

- Expired `running` leases → requeued to `queued`
- Expired `awaiting_input` leases → failed
- Expired `queued` leases (never started) → failed
- No orphaned PIDs are signaled (no process handle available after restart)

### Retry

Retry is explicit: submit a new execution request with the same parameters.
Each attempt gets a new ordered `ProcessAttempt` record. The old attempt record
is preserved.

## Configuration

HCO 2.0.0 configuration is backward-compatible with 1.x. New sections:

- `executionProfiles` (optional)
- `providerProfiles` (optional)

See README.md for current configuration examples.
