# HCO setup guide

This guide covers the current HCO 2.1.3 setup flow in detail.

For the fastest path, install HCO and run the guided wizard:

```bash
npm install -g hco-mcp
hco setup
```

## Requirements

- Node.js 22 or newer
- Claude Code available as `claude` on `PATH`
- Hermes Agent installed with its gateway service and configuration
- Linux with a systemd user service for automatic Hermes integration

HCO 2.1.3 currently assumes a root-owned Hermes installation by default. Custom installations may need path overrides or manual configuration.

## The guided setup

The wizard is progressive. You can stop safely and resume later without repeating completed stages.

### 1. Local verification

HCO checks:

- Node.js and HCO versions
- Claude Code availability
- Hermes binary and configuration
- SQLite access
- HCO data directory
- basic local lifecycle health

This stage does not contact a provider.

After it passes, HCO is only locally verified. Real Claude execution is not configured until the provider and integration stages are complete.

### 2. Provider configuration

The wizard can:

- collect an Anthropic-compatible API key through hidden terminal input
- collect an API base URL
- write a protected environment file
- install a systemd `EnvironmentFile` drop-in
- register the `claude-primary` provider profile
- send one validation request after confirmation
- discover available models
- select and activate a model mapping

Provider validation and model discovery contact the configured endpoint. Usage, rate limits, or charges may apply.

Current default paths:

```text
/root/.config/hermes/hco.env
/root/.config/systemd/user/hermes-gateway.service.d/hco-env.conf
```

The environment file is permission-restricted. Raw API keys are not written to HCO setup state, SQLite provider profiles, Hermes YAML, or normal setup output.

### 3. Hermes integration

The wizard can:

- validate and add one repository to HCO's allowlist
- add or replace the `hco` MCP entry in Hermes YAML
- restart `hermes-gateway.service`
- verify HCO database and provider/workspace tables

Current default paths:

```text
/root/.hermes/config.yaml
/usr/lib/node_modules/hco-mcp/dist/index.js
```

HCO backs up the Hermes YAML before replacing its MCP entry and attempts to restore the previous configuration if writing fails.

## Setup commands

```bash
hco setup              # start setup or offer to resume
hco setup --continue   # continue from the first incomplete stage
hco setup --status     # show setup state and progress
hco setup --repair     # inspect and continue an incomplete stage
hco setup --reset      # delete HCO's setup-state file
```

Setup progresses through:

```text
not_started
local_verified
provider_configured
ready
failed
```

Individual stages are tracked as `pending`, `complete`, `failed`, or `skipped`.

`hco setup --reset` removes only the setup-state file. It does not remove provider rows, credentials, the systemd drop-in, repository configuration, Hermes MCP configuration, job history, or artifacts.

## Resume a partial setup

```bash
hco setup --status
hco setup --continue
```

Running plain `hco setup` also detects partial state and offers to resume.

## Manual Hermes MCP configuration

The guided wizard is recommended because provider registration, model mapping, credentials, and Hermes MCP configuration must stay consistent.

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

## After setup

```bash
hco --version
hco setup --status
hco status
hco jobs
hco recover
```

A setup state of `ready` means all three wizard stages were marked complete.

## Current 2.1.3 limitation

The optional real Claude verification prompt does not automatically launch a real Claude job yet. After setup, submit the first real execution through Hermes and HCO, then inspect the repository and execution result.

## Troubleshooting

### Setup paused

Run:

```bash
hco setup --status
hco setup --continue
```

### Hermes gateway did not restart

```bash
systemctl --user daemon-reload
systemctl --user restart hermes-gateway.service
systemctl --user status hermes-gateway.service
```

### HCO tools are missing in Hermes

Check that:

- the `hco` MCP entry exists in Hermes YAML
- the HCO package path is correct
- `HCO_DATA_DIR` points to the intended data directory
- the gateway loaded the environment file
- the gateway was restarted after configuration

### Provider validation failed

Check the API key, base URL, provider availability, rate limits, and model access. HCO does not activate a provider after failed validation.
