<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/assets/HCO.png">
    <img alt="HCO logo" src="branding/assets/HCO.png" width="128" height="128">
  </picture>
</p>

<h1 align="center">Hermes Claude Operator</h1>

<p align="center">
  <strong>Give Hermes a reliable way to operate Claude Code.</strong>
</p>

<p align="center">
  Durable jobs, controlled repositories, recoverable execution, and fewer mysterious “it was working a minute ago” moments.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hco-mcp"><img alt="npm" src="https://img.shields.io/npm/v/hco-mcp?color=6366f1&label=npm"></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22.0.0-6da13f?logo=node.js&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-5c6ac4"></a>
  <a href="https://github.com/nzkbuild/hco-mcp/actions"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/nzkbuild/hco-mcp/ci.yml?branch=main&label=build"></a>
</p>

## What is HCO?

HCO is the execution layer between **Hermes Agent** and **Claude Code**.

Hermes decides what should be done. Claude Code edits the repository. HCO keeps the handoff controlled, recorded, and recoverable.

Without that middle layer, an automated coding workflow is mostly a collection of shell commands, scattered output, and optimism. HCO turns it into a durable job with state, artifacts, limits, and a clear result.

```text
Hermes Agent
    │
    │ submits and manages work through MCP
    ▼
HCO
    │
    ├── validates the target repository
    ├── records execution state in SQLite
    ├── starts and supervises Claude Code
    ├── stores output and generated artifacts
    └── exposes status, recovery, and diagnostics
    │
    ▼
Claude Code
```

**Hermes thinks. Claude codes. HCO keeps the operation from becoming archaeology.**

## Why use it?

### Jobs survive the chat

Executions are stored in SQLite instead of existing only inside one agent conversation. A restart does not have to mean “start over and hope it remembers.”

### Repository access is explicit

HCO starts with an empty repository allowlist. Claude Code cannot be sent into an arbitrary project until you approve it.

### Hermes and Claude Code stay separate

Hermes can use one provider while Claude Code uses another. Their credentials, models, and costs do not need to be tangled together.

### You can inspect what actually happened

HCO exposes job state, timelines, results, artifacts, health checks, queue information, and recovery tools. “The agent is working on it” becomes something you can verify.

### Small jobs do not need a ceremony

Submit a focused task, run it, collect the result, and move on. HCO supports lightweight work as well as longer, resumable execution.

## Who is this for?

HCO is useful when you:

- run Hermes Agent and want it to delegate coding work to Claude Code;
- want automated coding jobs to survive restarts and failed sessions;
- need strict control over which repositories an agent may touch;
- want provider and credential boundaries instead of one giant environment file;
- prefer evidence, logs, and artifacts over “trust me, it ran.”

HCO is probably unnecessary if you only open Claude Code manually for occasional one-off edits. It is an operator layer, not a prettier shell alias.

## Quick start

### Requirements

- Node.js 22 or newer
- Claude Code installed separately for real coding jobs
- A repository you are willing to explicitly allow

### 1. Install HCO

```bash
npm install -g hco-mcp
```

Check the installation:

```bash
hco --version
hco --help
hco status
```

A fresh installation is intentionally cautious:

- repository allowlist: empty;
- execution concurrency: 1;
- real Claude Code jobs: disabled until you configure them.

This is not HCO being shy. It is HCO refusing to improvise with your repositories.

### 2. Allow a repository

Create `~/.hco/config.json`:

```json
{
  "allowlist": [
    {
      "owner": "your-org",
      "repo": "your-project",
      "trustLevel": "sandbox"
    }
  ]
}
```

Only repositories listed here may receive Claude Code sessions.

### 3. Install Claude Code

HCO starts the `claude` executable as a child process. Claude Code is not bundled with HCO and is never installed silently.

Follow the official Claude Code installation instructions, then confirm:

```bash
claude --version
```

### 4. Check HCO before spending tokens

These commands do not require a provider call:

```bash
hco status
hco jobs
hco recover
```

They confirm that HCO can open its data directory, create the SQLite database, and inspect durable state.

### 5. Connect HCO to Hermes

After HCO, Claude Code, and the repository allowlist are working independently, add HCO as an MCP server in Hermes:

```json
{
  "mcpServers": {
    "hco": {
      "command": "hco",
      "args": [],
      "env": {
        "HCO_DATA_DIR": "/var/lib/hco",
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

`ANTHROPIC_API_KEY` belongs to the Claude Code execution path when that provider requires it. HCO does not need your Hermes, Telegram, OpenRouter, or unrelated provider credentials.

A sensible first run is one allowlisted repository, one job, and concurrency set to 1. Confirm the complete path before turning every dial to maximum. Your API provider will appreciate the restraint, even if it never sends flowers.

## What HCO manages

### Durable execution

HCO records each execution through a defined state machine. Work can be submitted, started, inspected, waited on, cancelled, continued, and recovered.

Typical states include:

```text
accepted → queued → running → completed
```

Failures, timeouts, cancellations, and requests for human input remain explicit states rather than disappearing into terminal history.

### Artifacts and results

Files and output produced during an execution can be stored and retrieved by ID. Size limits prevent one runaway job from quietly eating the machine.

Current limits include:

- 64 KiB inline content;
- 256 KiB per event chunk;
- 10 MiB per artifact;
- 100 MiB total artifacts per execution.

When a limit is reached, HCO reports which limit was exceeded.

### Workspaces

Repository workspaces are isolated by repository and provider context. Resume operations are idempotent, and concurrent sessions do not need to share one accidental working directory.

### Provider lifecycle

HCO includes provider registration, validation, model discovery, mapping recommendations, activation, status, and rollback flows.

```text
register → validate → discover models → recommend mappings → activate
```

Anthropic support is available. OpenAI and custom provider adapters remain extension points and should not be treated as complete production integrations yet.

### Health and observability

`hco_doctor` checks the execution environment, including Node.js, Claude Code availability, SQLite integrity, disk space, authentication, provider connectivity, repository permissions, queue state, MCP behaviour, and acceptance readiness.

`hco_statistics` reports operational information such as execution totals, success rate, queue depth, and timeline breakdowns.

## MCP tools

HCO exposes 31 MCP tools. Every tool is prefixed with `hco_` to avoid collisions with other servers.

| Area | Tools |
|---|---|
| Execution | `submit`, `start`, `status`, `wait`, `cancel`, `result`, `artifact`, `continue` |
| Providers | `register`, `validate`, `models`, `mapping_recommend`, `activate`, `status`, `list`, `rollback` |
| Workspaces | `resume`, `list`, `status` |
| Operations | `health`, `compatibility`, `statistics`, `doctor`, `status`, `list_jobs`, `inspect_job`, `list_milestones` |
| Legacy | `session_start`, `session_list`, `session_status`, `session_wait`, `session_stop`, `session_archive`, `task_start` |

The v1 session tools remain available for compatibility. They emit a deprecation warning and delegate to the current execution engine.

## Security model

HCO is designed around a few deliberately boring rules:

- no repository access without an allowlist entry;
- no automatic Claude Code installation;
- no requirement to share Hermes credentials with the coding runtime;
- no silent increase in execution concurrency;
- durable state and append-only audit events for important transitions;
- bounded artifact storage;
- errors should explain the failure without printing secrets.

Boring security is good security. Exciting security usually means somebody is writing an incident report.

## CLI

Common commands:

```bash
hco --help
hco --version
hco status
hco jobs
hco recover
hco-daemon --help
```

Use `hco status` as the first diagnostic. Use the doctor and MCP tools for deeper inspection once the server is connected.

## Development

```bash
git clone https://github.com/nzkbuild/hco-mcp.git
cd hco-mcp
npm install
npm run build
npm run lint
npm run format:check
npm test
```

### Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `HCO_DATA_DIR` | `./data` | SQLite database and durable HCO state |
| `ANTHROPIC_API_KEY` | none | Anthropic provider validation or Claude execution environment |
| `HCO_ACCEPTANCE` | `0` | Set to `1` to enable real Claude Code acceptance tests |
| `HCO_ADAPTER` | `fake` | Use `spawn` for real Claude Code or `fake` for tests |

### Project layout

```text
src/
  contract/     Zod schemas and interfaces
  state/        SQLite migrations and repositories
  provider/     LLM provider adapters and lifecycle
  workspace/    Repository workspace isolation
  execution/    Durable execution engine
  statistics/   Operational metrics
  doctor/       Environment and readiness checks
  mcp/          MCP server, handlers, and transport

tests/
  acceptance/   Real Claude Code integration tests
```

## Status

HCO is actively developed. Read the current release notes and CLI output before relying on unfinished provider adapters or undocumented behaviour.

Bug reports and focused pull requests are welcome. Reproduction steps are even more welcome. “It broke” is emotionally valid, but logs travel better.

## License

MIT
