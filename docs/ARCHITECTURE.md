# HCO architecture

HCO is a durable execution layer between Hermes Agent and Claude Code.

```text
Hermes Agent
    │
    │ MCP tools
    ▼
HCO
    ├── execution state
    ├── provider profiles
    ├── workspace records
    ├── artifacts
    └── health and statistics
    │
    │ controlled child process
    ▼
Claude Code
```

## Responsibilities

### Hermes

Hermes plans work, decides what should happen next, submits tasks, reviews results, and communicates with the user.

### HCO

HCO owns the handoff and execution record. It validates requests, persists state, launches Claude Code through an adapter, captures process attempts and artifacts, and exposes status and recovery operations through MCP and CLI surfaces.

### Claude Code

Claude Code performs repository work inside the boundaries supplied by HCO.

## Durable execution

The v2 execution contract supports:

- submit
- start
- status
- wait
- cancel
- result retrieval
- continuation
- artifact retrieval

Typical successful flow:

```text
accepted → queued → running → completed
```

Other terminal or recoverable states include failure, cancellation, timeout, and `awaiting_input`.

Execution state and events are stored in SQLite. Process attempts record launch and completion information so a failed child process does not erase the execution history.

## Provider lifecycle

Provider profiles reference environment variables rather than storing raw credentials in SQLite.

```text
register → validate → discover models → recommend mappings → activate
```

Provider state transitions are audited. Anthropic-compatible operation is implemented. OpenAI and custom provider adapters remain extension points.

## Workspaces

Workspaces bind repository identity, provider selection, and execution context. They make resume behavior inspectable and reduce accidental cross-repository or cross-provider collisions.

## Artifacts

HCO can persist Claude output and generated files as bounded artifacts.

Current limits:

- 64 KiB inline content
- 256 KiB event chunks
- 10 MiB per artifact
- 100 MiB per execution

## Observability

HCO exposes health checks, compatibility checks, execution statistics, queue information, provider status, workspace status, and job inspection.

`hco_doctor` checks areas such as:

- runtime and Claude Code availability
- SQLite health
- provider connectivity and model discovery
- MCP compatibility
- repository permissions
- execution adapter
- queue health
- acceptance readiness

## MCP tool groups

All MCP tools use the `hco_` prefix.

### Execution

```text
execution_submit
execution_start
execution_status
execution_wait
execution_cancel
execution_result
execution_artifact
execution_continue
```

### Providers

```text
provider_register
provider_validate
provider_models
provider_mapping_recommend
provider_activate
provider_status
provider_list
provider_rollback
```

### Workspaces

```text
workspace_resume
workspace_list
workspace_status
```

### Operations

```text
health
compatibility
statistics
doctor
status
list_jobs
inspect_job
list_milestones
```

Legacy session and task tools remain available with deprecation warnings.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `HCO_DATA_DIR` | `./data` | SQLite database and HCO state directory |
| `ANTHROPIC_API_KEY` | none | Provider validation and Claude Code credential |
| `ANTHROPIC_BASE_URL` | Anthropic endpoint | Anthropic-compatible provider endpoint |
| `HCO_ACCEPTANCE` | `0` | Set to `1` for real Claude acceptance tests |
| `HCO_ADAPTER` | `fake` | Use `spawn` for real Claude Code execution |

Maximum concurrent Claude jobs defaults to `1`.

## Source layout

```text
src/
  contract/     Stable schemas and interfaces
  state/        SQLite migrations and repositories
  provider/     Provider lifecycle and adapters
  workspace/    Workspace isolation and persistence
  execution/    Durable execution engine
  setup/        Guided setup wizard
  statistics/   Operational metrics
  doctor/       Health checks
  mcp/          MCP server and tool handlers
tests/
  acceptance/   Opt-in real Claude Code tests
```

## Compatibility

Legacy v1 session and task tools delegate into the newer execution engine and emit deprecation warnings. The production execution, provider, workspace, artifact, and MCP contracts should remain stable unless a documented migration is introduced.
