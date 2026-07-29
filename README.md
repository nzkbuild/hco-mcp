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

## The problem

You have Hermes, an AI agent that plans work. You have Claude Code, an AI that writes code. When Hermes tells Claude what to build, a lot can go wrong. The session crashes. The prompt gets lost. The output vanishes. You burn API credits retrying the same thing. Halfway through a refactor, nobody knows what happened or why.

**Hermes thinks. Claude codes. HCO makes sure the whole thing doesn't fall apart in between.**

## How it actually works (the short version)

Hermes needs Claude Code to build something. Instead of talking to Claude directly, Hermes hands the job to HCO. HCO writes it down, fires up Claude Code, watches it work, catches every file it produces, and hands everything back to Hermes in a neat package. If anything breaks, HCO knows exactly what happened and can pick up where it left off.

```
Hermes              HCO                       Claude Code
  │                  │                            │
  ├─ "build X" ─────►│                            │
  │                  ├─ logs it                   │
  │                  ├─ spawns claude ───────────►│
  │                  │                            ├─ coding away
  │                  │◄── files + output ─────────┤
  │                  │                            │
  │◄── "done, here" ─┤                            │
  │                  │                            │
  │ "also, gimme     │                            │
  │  the .ts file" ──►│                            │
  │◄── file ─────────┤                            │
```

## Why this matters

**Separate your bills.** Hermes runs on one API key (yours, or whichever provider you want). Claude Code runs on a different API key. HCO sits in the middle, so a $40 coding session never eats into your Hermes budget. Swap either side independently.

**Crash proof.** You just burned 15 minutes of Claude Code output. Without HCO, that work is gone. With HCO, the execution and its artifacts are sitting in SQLite. Hermes asks "what happened?" and gets the full answer.

**You can actually see what's happening.** 15 built-in health checks. Execution statistics with success rates. Queue depth. Timeline views. When Hermes says "I'm working on it," you can verify that claim.

**One-off tasks without the overhead.** Need Claude to lint a file or explain some code? HCO handles lightweight jobs without setting up a full multi-turn session. Submit, start, collect the result, move on.

## Setup

### 1. Install HCO

```bash
npm install -g hco-mcp
```

### 2. Verify the installation

```bash
hco --help
hco status
```

HCO starts with a safe default: empty allowlist (no repos permitted) and concurrency set to 1. You must explicitly configure repositories before any real Claude jobs can run.

### 3. Configure allowlisted repositories

Create `~/.hco/config.json`:

```json
{
  "allowlist": [
    { "owner": "your-org", "repo": "your-project", "trustLevel": "sandbox" }
  ]
}
```

Only repositories in the allowlist can receive Claude Code sessions.

### 4. Install Claude Code

HCO spawns `claude` as a child process. Install Claude Code separately:

https://docs.anthropic.com/en/docs/claude-code

Confirm it is on your PATH:

```bash
claude --version
```

### 5. Validate with a fake job

```bash
hco status
hco jobs
hco recover
```

These work without Claude Code and confirm HCO is operational.

### 6. Connect to Hermes

Once HCO, Claude Code, and an allowlisted repository are confirmed working, add HCO to your Hermes MCP config:

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

The `ANTHROPIC_API_KEY` is used by Claude Code — HCO passes it through to the Claude process. HCO does not require separate Hermes, OpenRouter, or Telegram credentials.

## Features

### Durable execution

Eight tools. One state machine. Submit work, start it, wait for results, cancel mid-run, continue where you left off, and pull artifacts by ID. Executions move through `accepted > queued > running > completed`. Failed? Cancelled? Timed out? Every state has a recovery path. Need human input mid-session? `awaiting_input` pauses cleanly and resumes when you're ready.

### Provider management

Run Hermes on OpenAI. Run Claude Code on Anthropic. Or the other way around. Register any number of providers, validate credentials, auto-discover available models, and map them to HCO roles (sonnet, opus, haiku, fable, subagent). Each provider tracks its own lifecycle: `registered > validated > active > failed`. Every state transition is audited in an append-only event log.

```
Register > Validate > Discover models > Recommend mappings > Activate
```

Anthropic ships ready. OpenAI and custom provider adapters are stubbed and waiting for your implementation.

### Workspaces

Each repository gets its own workspace, tied to a specific provider. Two concurrent sessions on the same repo with different providers? No collision. Call resume twice? You get the same workspace back. Workspaces track when they were last touched, who owns the repo, and which provider is active.

### Health and observability

`hco_doctor` runs 15 checks in parallel: Node version, Claude binary, SQLite integrity, disk space, provider connectivity, auth status, model discovery, tool support, streaming, MCP protocol, repo permissions, execution adapter, queue health, environment config, and acceptance readiness. Each check returns `healthy`, `degraded`, or `unhealthy` with a readable explanation. `hco_statistics` gives you the dashboard: total executions, success rate, queue depth, timeline breakdown.

### Artifact storage

Every file Claude Code produces gets stored as an artifact. Retrieve anything by ID. Limits keep things sane: 64 KiB inline, 256 KiB per event chunk, 10 MiB per artifact, 100 MiB cap per execution. If you hit a limit, HCO tells you exactly which one.

### Legacy compatibility

The v1 session tools still work. They log a deprecation warning to stderr and delegate to the v2 engine internally. No breaking changes.

## All 31 tools

**Execution (v2):** `submit`, `start`, `status`, `wait`, `cancel`, `result`, `artifact`, `continue`

**Providers:** `register`, `validate`, `models`, `mapping_recommend`, `activate`, `status`, `list`, `rollback`

**Workspaces:** `resume`, `list`, `status`

**Operations:** `health`, `compatibility`, `statistics`, `doctor`, `status`, `list_jobs`, `inspect_job`, `list_milestones`

**Legacy:** `session_start`, `session_list`, `session_status`, `session_wait`, `session_stop`, `session_archive`, `task_start`

All prefixed with `hco_` so they never collide with your other MCP tools.

## Developing

```bash
git clone https://github.com/nzkbuild/hco-mcp.git
cd hco-mcp
npm install
npm run build
npm test
```

| Requirement | Why |
|---|---|
| Node.js >= 22 | ESM, built-in test runner, SQLite bindings |
| `claude` on PATH | Spawn adapter and acceptance tests need it |

| Variable | Default | Purpose |
|---|---|---|
| `HCO_DATA_DIR` | `./data` | Where the SQLite database lives |
| `ANTHROPIC_API_KEY` | -- | For Anthropic provider validation |
| `HCO_ACCEPTANCE` | `0` | `1` to enable acceptance tests |
| `HCO_ADAPTER` | `fake` | `spawn` for real Claude Code, `fake` for tests |

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
