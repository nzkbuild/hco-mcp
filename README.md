<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/assets/HCO.png">
    <img alt="HCO logo" src="branding/assets/HCO.png" width="128" height="128">
  </picture>
</p>

<h1 align="center">Hermes Claude Operator</h1>

<p align="center"><strong>Hermes plans. Claude Code builds. HCO runs the operation.</strong></p>

<p align="center">The execution layer between Hermes Agent and Claude Code.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hco-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/hco-mcp"></a>
  <a href="https://nodejs.org/"><img alt="Node.js 22 or newer" src="https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://github.com/nzkbuild/hco-mcp/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/nzkbuild/hco-mcp?style=social"></a>
</p>

```bash
npm install -g hco-mcp
```

## What is HCO?

Claude Code is excellent at writing code.

It was not designed to be a durable orchestration system.

Sessions end. Output gets scattered. Retries waste tokens. A failed process can leave Hermes guessing what happened.

HCO sits between Hermes Agent and Claude Code and turns each coding task into a controlled, recoverable execution.

```text
Hermes Agent
    │
    │ plans and delegates
    ▼
┌──────────────────────────┐
│           HCO            │
│                          │
│  Queue       Recovery    │
│  Artifacts   Workspaces  │
│  SQLite      Audit trail │
└──────────────────────────┘
    │
    │ starts and supervises
    ▼
Claude Code
    │
    ▼
Git repository
```

**HCO turns short-lived Claude Code sessions into durable executions.**

## Without HCO

```text
Hermes
   │
   ▼
Claude Code

Session ends.
History disappears.
Start again.
```

## With HCO

```text
Hermes
   │
   ▼
HCO
   │
   ▼
Claude Code

Queue
Recovery
Artifacts
History
Resume
Statistics
```

Your terminal has amnesia. HCO does not.

## Why use it?

| Benefit | What it means |
|---|---|
| Durable execution | Jobs survive crashes, restarts, and interrupted sessions. |
| Safe orchestration | Repository access is controlled through an explicit allowlist. |
| Provider separation | Hermes and Claude Code can use different credentials and models. |
| Recoverable state | Resume work without rebuilding the entire chain from memory. |
| Observable runs | Inspect jobs, timelines, artifacts, health, and queue state. |

## Is HCO for you?

HCO is a good fit when you:

- use Hermes Agent to plan or manage development work;
- use Claude Code to make repository changes;
- want automated coding jobs to survive restarts;
- need strict control over which repositories an agent may touch;
- prefer logs, artifacts, and durable state over blind trust.

HCO is probably unnecessary when you only open Claude Code manually for occasional one-off edits.

It is an operator layer, not a prettier shell alias.

## Quick start

### 1. Install HCO

```bash
npm install -g hco-mcp
```

Verify it:

```bash
hco --version
hco status
```

A fresh installation starts cautiously:

- repository allowlist: empty;
- execution concurrency: 1;
- real Claude Code jobs: unavailable until configured.

### 2. Allow one repository

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

Only listed repositories may receive Claude Code sessions.

### 3. Install Claude Code

HCO starts the `claude` executable as a child process. Claude Code is installed separately.

Confirm that it is available:

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

They confirm that HCO can create its data directory, open SQLite, and inspect durable state.

### 5. Connect Hermes

After HCO, Claude Code, and the repository allowlist work independently, add HCO as an MCP server in Hermes:

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

`ANTHROPIC_API_KEY` belongs to the Claude Code execution path when that provider requires it.

HCO does not need unrelated Hermes, Telegram, OpenRouter, or provider-pool credentials.

Start with one repository, one job, and concurrency set to 1. Confirm the complete path before increasing parallel work.

## What HCO manages

| Area | Purpose |
|---|---|
| Execution engine | Submit, start, wait, cancel, continue, and recover work. |
| Workspace manager | Isolate repository and provider contexts. |
| Artifact store | Persist generated files and execution output. |
| Provider lifecycle | Register, validate, discover, map, activate, and roll back providers. |
| MCP server | Expose HCO controls to Hermes through MCP. |
| Health checks | Diagnose runtime, storage, provider, repository, and queue readiness. |
| Statistics | Report execution totals, success rates, queue depth, and timelines. |

## Execution lifecycle

```text
accepted → queued → running → completed
```

Failures, cancellations, timeouts, and requests for human input remain explicit states rather than disappearing into terminal history.

Executions can be inspected, resumed, or recovered without pretending nothing happened.

## Safe by default

HCO follows a few deliberately boring rules:

- no repository access without an allowlist entry;
- no automatic Claude Code installation;
- no need to share Hermes credentials with the coding runtime;
- no silent increase in concurrency;
- durable state and audit events for important transitions;
- bounded artifact storage;
- errors should explain failures without printing secrets.

Boring security is good security. Exciting security usually means someone is writing an incident report.

## What HCO is not

HCO is not another coding model.

HCO is not a Claude replacement.

HCO is not an IDE.

HCO is not a general model router.

HCO is the execution layer between Hermes Agent and Claude Code.

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

## Current status

### Available now

- durable execution;
- recovery and resume flows;
- repository allowlists;
- workspace isolation;
- artifact storage;
- MCP transport;
- health checks and statistics;
- Anthropic provider support.

### Extension points

- OpenAI provider adapter;
- custom provider adapter;
- broader multi-agent orchestration;
- richer operational interfaces.

OpenAI and custom provider adapters should not be treated as complete production integrations yet.

## Principles

Durable over clever.

Explicit over magical.

Recoverable over fragile.

Secure by default.

Every execution leaves evidence.

## FAQ

### Why not call Claude Code directly?

You can. HCO becomes useful when Hermes needs durable jobs, recovery, artifacts, repository controls, and inspectable execution state.

### Why SQLite?

HCO needs durable local state without requiring a separate database server. SQLite keeps installation simple while preserving jobs, events, workspaces, and artifacts.

### Can Hermes and Claude Code use different providers?

Yes. Their credentials and model choices can remain separate.

### Why does HCO start with an empty allowlist?

Because an automation layer should not decide which repositories it may modify. You make that decision explicitly.

### Does HCO install Claude Code?

No. Claude Code is installed and configured separately.

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

## Contributing

Focused bug reports and pull requests are welcome.

Reproduction steps are especially helpful. “It broke” is emotionally valid, but logs travel better.

## License

MIT