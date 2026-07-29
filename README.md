<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/assets/HCO.png">
    <img alt="HCO logo" src="branding/assets/HCO.png" width="128" height="128">
  </picture>
</p>

<h1 align="center">Hermes Claude Operator</h1>

<p align="center">
  <strong>Give your AI agent a memory. And a seatbelt.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hco-mcp"><img alt="npm" src="https://img.shields.io/npm/v/hco-mcp?color=6366f1&label=npm"></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22.0.0-6da13f?logo=node.js&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-5c6ac4"></a>
  <a href="https://github.com/nzkbuild/hco-mcp/actions"><img alt="Build" src="https://img.shields.io/badge/build-passing-22c55e"></a>
</p>

## What HCO does

Hermes can plan and supervise work. Claude Code can edit a repository. HCO connects them through a durable, inspectable execution layer.

Instead of handing an important coding task directly to a temporary Claude process, Hermes submits it to HCO. HCO records the request, starts Claude Code, tracks the execution, stores its output and artifacts, and gives Hermes a reliable result to inspect.

```text
Hermes              HCO                       Claude Code
  │                  │                            │
  ├─ "build X" ─────►│                            │
  │                  ├─ records the request       │
  │                  ├─ starts Claude Code ──────►│
  │                  │                            ├─ works in the repository
  │                  │◄── output + artifacts ─────┤
  │◄── durable result ┤                            │
```

**Hermes thinks. Claude codes. HCO keeps the work from disappearing in between.**

## Why use it

- **Durable execution.** Jobs, state transitions, process attempts, output, and artifacts survive beyond one chat or process.
- **Independent providers.** Hermes and Claude Code can use separate provider credentials and budgets.
- **Recoverable failures.** A crashed process does not erase the execution history.
- **Visible operations.** Inspect status, queues, health checks, statistics, results, and stored artifacts.
- **Controlled repository access.** Real Claude jobs are limited to explicitly allowed repositories.
- **Safe defaults.** Concurrency starts at `1`, and the repository allowlist starts empty.

## Requirements

Before running the guided setup, install:

- Node.js 22 or newer
- Claude Code, available as `claude` on `PATH`
- Hermes Agent, including its gateway service and configuration

HCO 2.1.3's automatic Hermes integration is currently designed for a Linux user service managed by systemd. The current default paths target a root-owned Hermes installation. Other layouts may require manual configuration or code-level path overrides.

## Quick start

Install HCO globally, then start the guided setup:

```bash
npm install -g hco-mcp
hco setup
```

The wizard is progressive. It does not make you choose between a fake setup and a real setup at the beginning.

### Stage 1: local verification

HCO checks the local environment and database without contacting a provider:

- Node.js version
- installed HCO version
- Claude Code availability
- Hermes binary and configuration
- SQLite access
- HCO data directory
- basic local lifecycle health

After this stage, HCO is only **locally verified**. Real Claude execution is not configured yet.

When asked whether to configure real Claude execution, choosing No is safe. Continue later with:

```bash
hco setup --continue
```

### Stage 2: provider configuration

The wizard can then:

- collect the Anthropic-compatible API key using hidden terminal input
- collect an API base URL
- write a protected environment file
- install a systemd `EnvironmentFile` drop-in for the Hermes gateway
- register the `claude-primary` provider profile
- send one provider validation request after confirmation
- discover available models
- select and activate a model mapping

Provider validation and model discovery contact the configured endpoint. Provider usage, rate limits, or charges may apply.

The current default credential paths are:

```text
/root/.config/hermes/hco.env
/root/.config/systemd/user/hermes-gateway.service.d/hco-env.conf
```

The environment file is created with restricted permissions. Raw API keys are not written to HCO setup state, SQLite provider profiles, Hermes YAML, or normal setup output. Hermes YAML receives environment-variable references instead.

### Stage 3: Hermes integration

The integration stage can:

- validate and add one repository to HCO's in-memory allowlist configuration
- add or replace the `hco` MCP entry in Hermes YAML
- restart `hermes-gateway.service`
- verify basic HCO database, provider-table, and workspace-table access

The current default Hermes paths are:

```text
/root/.hermes/config.yaml
/usr/lib/node_modules/hco-mcp/dist/index.js
```

The wizard backs up the Hermes YAML before replacing the HCO entry and attempts to restore it if writing fails.

> **Current 2.1.3 limitation:** the optional “real Claude Code verification task” is not executed automatically yet. The wizard explains the test and records the choice, but directs you to submit a real execution through HCO after setup.

## Setup commands

```bash
hco setup              # start setup or offer to resume partial setup
hco setup --continue   # continue from the first incomplete stage
hco setup --status     # show setup state and stage progress
hco setup --repair     # inspect state and continue an incomplete stage
hco setup --reset      # delete HCO's setup-state file
```

Setup state progresses through:

```text
not_started
local_verified
provider_configured
ready
failed
```

Individual stages are tracked as `pending`, `complete`, `failed`, or `skipped`.

`hco setup --reset` currently removes only the setup-state file. It does not remove provider rows, credential files, the systemd drop-in, repository configuration, Hermes MCP configuration, job history, or artifacts.

## After setup

Check the installation and operational state:

```bash
hco --version
hco status
hco jobs
hco recover
hco setup --status
```

For MCP-side diagnostics, Hermes can call tools such as:

```text
hco_health
hco_doctor
hco_statistics
hco_provider_list
hco_workspace_list
```

A setup state of `ready` means all three wizard stages were marked complete. It does not mean the optional real Claude execution was run successfully, because that automatic verification remains a 2.1.3 limitation.

## Manual configuration

The guided wizard is recommended because provider registration, validation, model mapping, and Hermes MCP configuration are connected steps.

Manual installations must configure all of the following consistently:

1. HCO data directory
2. Claude Code provider environment
3. an HCO provider profile and active model mapping
4. repository allowlist configuration
5. Hermes MCP server entry
6. gateway environment loading
7. gateway restart

A minimal Hermes MCP entry is structurally similar to:

```yaml
mcp_servers:
  hco:
    command: node
    args:
      - /absolute/path/to/hco-mcp/dist/index.js
    env:
      HCO_DATA_DIR: /absolute/path/to/hco-data
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      ANTHROPIC_BASE_URL: ${ANTHROPIC_BASE_URL}
```

Do not place a raw provider key directly in Hermes YAML or commit it to a repository.

## Core capabilities

### Durable execution

The v2 execution contract supports submit, start, status, wait, cancel, result retrieval, continuation, and artifact retrieval. Executions move through validated states including:

```text
accepted → queued → running → completed
```

Failure, cancellation, timeout, and `awaiting_input` states have explicit recovery paths.

### Provider management

Provider profiles reference environment variables rather than storing raw credentials in SQLite.

```text
Register → Validate → Discover models → Recommend mappings → Activate
```

Each provider has an audited lifecycle such as:

```text
registered → validated → active
```

Anthropic-compatible operation is implemented. OpenAI and custom provider adapters remain extension points rather than complete drop-in implementations.

### Workspaces

HCO persists repository workspaces and binds them to providers and executions. Workspace records make resume behavior inspectable and reduce accidental cross-repository or cross-provider collisions.

### Health and observability

`hco_doctor` checks runtime, Claude Code, SQLite, provider connectivity, model discovery, MCP compatibility, repository permissions, the execution adapter, queue health, and acceptance readiness.

`hco_statistics` reports execution totals, success rates, queue depth, and timeline data.

### Artifact storage

Claude output and generated files can be stored as artifacts with bounded size limits:

- 64 KiB inline content
- 256 KiB event chunks
- 10 MiB per artifact
- 100 MiB per execution

### Compatibility

Legacy v1 session and task tools still delegate into the newer execution engine and emit deprecation warnings.

## MCP tools

All MCP tools use the `hco_` prefix.

**Execution:** `execution_submit`, `execution_start`, `execution_status`, `execution_wait`, `execution_cancel`, `execution_result`, `execution_artifact`, `execution_continue`

**Providers:** `provider_register`, `provider_validate`, `provider_models`, `provider_mapping_recommend`, `provider_activate`, `provider_status`, `provider_list`, `provider_rollback`

**Workspaces:** `workspace_resume`, `workspace_list`, `workspace_status`

**Operations:** `health`, `compatibility`, `statistics`, `doctor`, `status`, `list_jobs`, `inspect_job`, `list_milestones`

**Legacy:** `session_start`, `session_list`, `session_status`, `session_wait`, `session_stop`, `session_archive`, `task_start`

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `HCO_DATA_DIR` | `./data` | SQLite database and HCO state directory |
| `ANTHROPIC_API_KEY` | none | Credential used by provider validation and Claude Code |
| `ANTHROPIC_BASE_URL` | Anthropic endpoint | Anthropic-compatible provider endpoint |
| `HCO_ACCEPTANCE` | `0` | Set to `1` to enable real Claude acceptance tests |
| `HCO_ADAPTER` | `fake` | Use `spawn` for real Claude Code execution |

The application default for maximum concurrent Claude jobs is `1`.

## Development

```bash
git clone https://github.com/nzkbuild/hco-mcp.git
cd hco-mcp
npm install
npm run build
npm test
npm run lint
npm run format:check
```

Project layout:

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

## Security notes

- Keep provider keys outside repositories.
- Keep concurrency at `1` unless the provider explicitly permits overlapping requests.
- Allowlist only the specific repositories HCO should access.
- Review existing Hermes MCP configuration before replacing it.
- Treat provider validation and model discovery as real external API activity.
- Inspect the working tree before and after the first real Claude job.

## License

MIT
