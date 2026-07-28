<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/assets/HCO.png">
    <img alt="HCO logo" src="branding/assets/HCO.png" width="128" height="128">
  </picture>
</p>

<h1 align="center">Hermes Code Operator</h1>

<p align="center">
  <strong>The durable execution backbone for AI coding agents</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hco-mcp"><img alt="npm" src="https://img.shields.io/npm/v/hco-mcp?color=6366f1&label=npm"></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22.0.0-6da13f?logo=node.js&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-5c6ac4"></a>
  <a href="https://github.com/nzkbuild/hco-mcp/actions"><img alt="Build" src="https://img.shields.io/badge/build-passing-22c55e"></a>
</p>

## What is HCO?

HCO sits between your Hermes planning agent and Claude Code, giving every code session a durable record, policy guardrails, and a structured lifecycle. Hermes submits work. HCO executes it safely and remembers everything.

- **Durable** -- every execution request, its result, and every artifact are persisted in SQLite, even across crashes
- **Idempotent** -- resubmit the same request without side effects; HCO recognizes duplicates and returns the existing result
- **Observable** -- built-in statistics, queue health, and a doctor check framework so nothing goes dark
- **Multi-provider** -- register and validate Anthropic, OpenAI, or custom providers with role-based model mapping
- **Workspace isolation** -- bind executions to repos and providers, so concurrent work stays cleanly separated

## Quick start for Hermes

Add this to your Hermes agent configuration:

```json
{
  "mcpServers": {
    "hco": {
      "command": "npx",
      "args": ["-y", "hco-mcp"],
      "env": {
        "HCO_DATA_DIR": "/var/lib/hco",
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

That is it. HCO starts alongside Hermes and exposes its full tool set over the MCP protocol. No separate daemon, no network ports.

### Install globally (optional)

```bash
npm install -g hco-mcp
```

Then reference `hco` directly in your Hermes config instead of `npx -y hco-mcp`.

## How it works

```
Hermes              HCO                       Claude Code
  │                  │                            │
  ├─ submit ────────►│                            │
  │                  ├─ validate ──┐              │
  │                  │             └─ persist     │
  │                  │                            │
  ├─ start ─────────►│                            │
  │                  ├─ spawn claude ────────────►│
  │                  │                            ├─ coding
  │                  │◄── stdout / artifacts ─────┤
  │                  │                            │
  ├─ wait ──────────►│                            │
  │◄── result ───────┤                            │
  │                  │                            │
  ├─ artifact ──────►│                            │
  │◄── file ─────────┤                            │
```

Every step is recorded. Every artifact is stored. Every failure mode has a recovery path.

## Features

### Execution engine

Submit, start, wait, cancel, continue, and retrieve results through a clean state machine. Executions progress through `accepted > queued > running > completed`, with `failed`, `cancelled`, and `timed_out` terminal states. The `awaiting_input` state lets the agent pause for human input and resume mid-session.

### Provider management

```json
// Register a provider
hco_provider_register
{
  "profile_id": "my-anthropic",
  "provider": "anthropic",
  "api_key_env": "ANTHROPIC_API_KEY"
}

// Validate, discover models, get mapping recommendations
hco_provider_validate    -> validated
hco_provider_models      -> [{ model_id, display_name, capabilities }]
hco_provider_mapping_recommend -> [{ hco_role: "sonnet", provider_model_id: "claude-sonnet-5" }]

// Activate with confirmed mappings
hco_provider_activate   -> active
```

Providers follow a `registered > validated > active > failed` state machine with full event auditing. Anthropic is fully supported. OpenAI and custom providers have stub adapters ready for implementation.

### Workspaces

Bind each repository and provider combination to an isolated workspace. Resume is idempotent -- calling it twice returns the same workspace. Associating executions with workspaces keeps concurrent agent sessions cleanly separated.

### Statistics and health

`hco_statistics` returns execution counts, success rates, queue depth, and timeline data. `hco_doctor` runs 15 systematic health checks covering Node version, Claude binary, SQLite, disk space, provider connectivity, auth, model discovery, streaming support, MCP protocol, repo permissions, execution adapter, queue health, environment, and acceptance readiness. Each check reports `healthy`, `degraded`, or `unhealthy` with diagnostic messages.

### Artifact storage

Files produced during execution are stored as artifacts. Retrieve them by ID. Limits are enforced: 64 KiB inline responses, 256 KiB event chunks, 10 MiB per individual artifact, 100 MiB total per execution.

### Legacy compatibility

HCO 2.x maintains backward compatibility with v1 session-based tools. Deprecated tools emit warnings to stderr and delegate to the v2 execution engine internally.

## All 31 MCP tools

### Execution (v2)
`hco_execution_submit`, `hco_execution_start`, `hco_execution_status`, `hco_execution_wait`, `hco_execution_cancel`, `hco_execution_result`, `hco_execution_artifact`, `hco_execution_continue`

### Providers
`hco_provider_register`, `hco_provider_validate`, `hco_provider_models`, `hco_provider_mapping_recommend`, `hco_provider_activate`, `hco_provider_status`, `hco_provider_list`, `hco_provider_rollback`

### Workspaces
`hco_workspace_resume`, `hco_workspace_list`, `hco_workspace_status`

### Operations
`hco_health`, `hco_compatibility`, `hco_statistics`, `hco_doctor`, `hco_status`, `hco_list_jobs`, `hco_inspect_job`, `hco_list_milestones`

### Legacy
`hco_session_start`, `hco_session_list`, `hco_session_status`, `hco_session_wait`, `hco_session_stop`, `hco_session_archive`, `hco_task_start`

## Developing HCO

```bash
git clone https://github.com/nzkbuild/hco-mcp.git
cd hco-mcp
npm install
npm run build
npm test
```

### Requirements

- Node.js >= 22
- Claude Code CLI (`claude`) on PATH (for spawn adapter and acceptance tests)

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `HCO_DATA_DIR` | `./data` | SQLite database directory |
| `ANTHROPIC_API_KEY` | -- | API key for Anthropic provider validation |
| `HCO_ACCEPTANCE` | `0` | Set to `1` to enable acceptance tests |
| `HCO_ADAPTER` | `fake` | `spawn` for real Claude Code, `fake` for tests |

### Project structure

```
src/
  contract/     Zod schemas and interfaces
  state/        SQLite migrations and repositories
  provider/     Adapter pattern for LLM providers
  workspace/    Workspace isolation service
  execution/    Core execution engine
  statistics/   Aggregated operational metrics
  doctor/       Systematic health check framework
  mcp/          MCP server, tool handlers, transport
tests/
  acceptance/   Real Claude Code integration tests
```

## License

MIT
