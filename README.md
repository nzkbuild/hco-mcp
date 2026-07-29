<p align="center">
  <img src="branding/assets/HCO.png" alt="HCO logo" width="112" height="112">
</p>

<h1 align="center">Hermes Claude Operator</h1>

<p align="center">
  <strong>Give your AI agent a memory. And a seatbelt.</strong>
</p>

<p align="center">
  HCO lets Hermes hand coding work to Claude Code, keep every run on record,<br>
  and recover the result when something goes wrong.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hco-mcp"><img alt="npm" src="https://img.shields.io/npm/v/hco-mcp?color=6366f1&label=npm"></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D22.0.0-6da13f?logo=node.js&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-5c6ac4"></a>
  <a href="https://github.com/nzkbuild/hco-mcp/actions"><img alt="Build" src="https://img.shields.io/badge/build-passing-22c55e"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/SETUP.md">Setup guide</a> ·
  <a href="docs/SECURITY.md">Security</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
</p>

---

## HCO in plain English

Think of **Hermes as the project manager** and **Claude Code as the developer**.

HCO is the tracked workbench between them. It records the assignment, watches the coding run, keeps the output and files, and gives Hermes something reliable to review instead of relying on one temporary process.

<table>
  <tr>
    <td align="center" width="33%">
      <strong>1. Ask Hermes</strong><br><br>
      Describe what you want built, fixed, or reviewed.
    </td>
    <td align="center" width="33%">
      <strong>2. HCO manages the run</strong><br><br>
      The task, status, output, and artifacts are recorded.
    </td>
    <td align="center" width="33%">
      <strong>3. Claude Code delivers</strong><br><br>
      Hermes receives a durable result it can inspect and continue.
    </td>
  </tr>
</table>

## Why HCO

- **Work does not vanish with one process.** Executions and results are stored instead of living only in a temporary session.
- **Failures are inspectable.** You can see what started, what finished, and where a run stopped.
- **Hermes and Claude Code stay independent.** They can use separate provider credentials and budgets.
- **Repository access stays controlled.** HCO is designed around explicit project boundaries and a safe concurrency default of `1`.

## Quick start

You need Node.js 22+, Hermes Agent, and Claude Code available as `claude` on your system.

```bash
npm install -g hco-mcp
hco setup
```

The guided wizard walks through the full connection:

1. checks HCO, Hermes, Claude Code, and SQLite locally
2. connects and validates the Claude provider
3. discovers and selects a model
4. connects HCO to Hermes

The first stage does not contact a provider. You can stop after local verification and continue later:

```bash
hco setup --continue
```

> **Current compatibility:** automatic Hermes setup in HCO 2.1.3 targets a Linux systemd user service and the current root-owned Hermes layout. Other installations may require manual paths. See the [setup guide](docs/SETUP.md).

## What a run looks like

```text
You
  “Finish the next milestone and verify the tests.”

Hermes
  Submits the work through HCO.

HCO
  accepted → queued → running → completed

Claude Code
  Works in the selected repository.

Hermes
  Returns the result, status, and captured artifacts.
```

HCO does not replace Hermes or Claude Code. It makes the handoff between them durable, visible, and recoverable.

## Safe by default

- concurrency starts at `1`
- repository access starts restricted
- provider profiles reference environment variables instead of storing raw keys in SQLite
- provider validation requires confirmation before sending a real request
- Hermes configuration is backed up before HCO replaces its MCP entry

Read the full [security guide](docs/SECURITY.md) before connecting production credentials or important repositories.

## Essential commands

| Command | What it does |
|---|---|
| `hco setup` | Start or resume guided setup |
| `hco setup --status` | Show setup progress |
| `hco status` | Show HCO operational status |
| `hco jobs` | List recorded jobs |
| `hco recover` | Recover jobs left in a stuck running state |
| `hco --help` | Show the CLI reference |

## What HCO keeps track of

- execution requests and state changes
- Claude Code process attempts
- provider profiles and model mappings
- repository workspaces
- output and generated artifacts
- health checks and execution statistics

The deeper execution model, tool list, configuration variables, limits, and source layout are documented in the [architecture guide](docs/ARCHITECTURE.md).

## Current 2.1.3 note

The setup wizard's optional real Claude verification prompt does not launch the real test automatically yet. Complete setup, then submit the first real job through Hermes and HCO and inspect the result.

## Development

```bash
git clone https://github.com/nzkbuild/hco-mcp.git
cd hco-mcp
npm install
npm run build
npm test
```

See the [changelog](CHANGELOG.md) for release history.

## License

MIT
