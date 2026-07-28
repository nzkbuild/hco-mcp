# HCO — Hermes Code Operator

MCP control plane for safe, durable Claude Code execution.

HCO sits between Hermes (the planning agent) and Claude Code (the coding agent),
providing durable execution, policy enforcement, artifact management, and
structured lifecycle reporting.

## Architecture

```
Hermes → HCO (MCP Server) → Claude Code
            ├── SQLite (WAL)
            ├── ExecutionService
            ├── ArtifactStorage
            └── SpawnAdapter
```

## Requirements

- Node.js >= 22
- Claude Code CLI (`claude`)
- SQLite (bundled via better-sqlite3)

## Quick Start

```bash
npm install
npm run build
HCO_DATA_DIR=/var/lib/hco node dist/index.js
```

Configure via `hco.json` or environment variables:

```json
{
  "dataDir": "/var/lib/hco",
  "transport": "stdio",
  "allowlist": [{ "owner": "my-org", "repo": "my-project", "trustLevel": "trusted" }],
  "authority": { "mode": "interactive" },
  "claude": {
    "binaryPath": "claude",
    "allowedEnv": ["ANTHROPIC_API_KEY"],
    "sessionDir": "/tmp/hco-claude",
    "defaultTimeoutMs": 300000
  }
}
```

## MCP Tools

### Execution (v2)

| Tool                     | Purpose                                               |
| ------------------------ | ----------------------------------------------------- |
| `hco_execution_submit`   | Submit an execution request (durable, idempotent)     |
| `hco_execution_start`    | Start a submitted execution                           |
| `hco_execution_status`   | Get current execution state                           |
| `hco_execution_wait`     | Block until terminal state                            |
| `hco_execution_cancel`   | Cancel a running or queued execution                  |
| `hco_execution_result`   | Get structured ExecutionResult for terminal execution |
| `hco_execution_continue` | Resume an execution at awaiting_input                 |
| `hco_execution_artifact` | Retrieve stored artifact content by ID                |

### Operations

| Tool                | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `hco_health`        | System health: DB stats, execution counts, uptime |
| `hco_compatibility` | v1-to-v2 migration readiness check                |

### Legacy (deprecated)

`hco_session_start`, `hco_session_list`, `hco_session_status`,
`hco_session_wait`, `hco_session_stop`, `hco_session_archive`,
`hco_task_start`, `hco_status`, `hco_list_jobs`, `hco_inspect_job`,
`hco_list_milestones` — emit deprecation warnings to stderr.

## Execution Lifecycle

```
accepted → queued → running → completed
                     ├→ failed
                     ├→ cancelled
                     ├→ timed_out
                     └→ awaiting_input → running (continue)
```

## Artifact Limits

| Tier                | Limit   | Configurable |
| ------------------- | ------- | ------------ |
| Inline MCP response | 64 KiB  | No           |
| Event chunk         | 256 KiB | No           |
| Individual artifact | 10 MiB  | No           |
| Total per execution | 100 MiB | No           |

## Running Tests

```bash
# Full test suite (build + all tests)
npm test

# Acceptance tests (requires claude CLI and ANTHROPIC_API_KEY)
HCO_ACCEPTANCE=1 HCO_ADAPTER=spawn npx tsx --test tests/acceptance/real-claude.test.ts

# Format check
npm run format:check

# Lint
npm run lint
```

## License

MIT
