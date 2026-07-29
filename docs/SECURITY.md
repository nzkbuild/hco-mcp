# HCO security guide

HCO sits between Hermes and Claude Code, so its security model focuses on four boundaries: credentials, repository access, provider traffic, and recoverable configuration changes.

## Credentials

HCO provider profiles store environment-variable references, not raw API keys.

During guided setup, the provider key is:

- entered through hidden terminal input
- written to a permission-restricted environment file
- referenced from Hermes YAML as `${ANTHROPIC_API_KEY}`
- temporarily injected into the setup process for provider validation and model discovery

Raw provider keys should not appear in:

- HCO setup state
- SQLite provider profiles
- Hermes YAML
- normal setup output
- logs or error messages

Current default credential file:

```text
/root/.config/hermes/hco.env
```

Keep this file outside repositories and restrict access to the account running Hermes.

## Repository access

HCO starts with an empty repository allowlist.

Only add the specific repositories Claude Code is allowed to inspect or modify. Do not allowlist broad paths such as a home directory, filesystem root, or a directory containing unrelated projects.

Before the first real job:

1. confirm the repository path
2. inspect the current branch
3. inspect the working tree
4. make sure important local work is committed or backed up
5. review the working tree again after the job

## Concurrency and provider policy

HCO defaults to one concurrent Claude job.

Keep concurrency at `1` unless the provider explicitly permits overlapping requests for the account and key being used. Higher concurrency can increase cost, create overlapping traffic, and conflict with provider anti-sharing or anti-reseller rules.

Hermes and Claude Code should use credentials that match their intended workloads. HCO does not require both sides to share the same provider key.

## External provider activity

These actions contact the configured provider:

- provider validation
- model discovery
- real Claude Code execution

Provider charges, quotas, rate limits, and acceptable-use rules may apply. The setup wizard asks for confirmation before provider validation.

## Hermes configuration changes

The guided wizard can add or replace the `hco` MCP entry in Hermes YAML and install a systemd environment drop-in.

HCO backs up Hermes YAML before replacing the MCP entry and attempts to restore it if writing fails. Review an existing HCO MCP entry before approving replacement.

A Hermes gateway restart may briefly interrupt active interactions while tools and environment variables reload.

## Setup reset

`hco setup --reset` currently deletes only HCO's setup-state file.

It does not delete:

- provider records
- credential files
- systemd drop-ins
- repository settings
- Hermes MCP configuration
- execution history
- artifacts

Remove those separately only after verifying that they belong to HCO and are no longer needed.

## Secret handling checklist

- Never commit provider keys.
- Never paste raw keys into issues, logs, screenshots, or support messages.
- Use dedicated credentials when the provider supports them.
- Rotate a key immediately if it is exposed.
- Keep the credential file and parent directory permission-restricted.
- Review provider usage after the first real execution.
- Keep concurrency at `1` by default.

## Reporting a vulnerability

Do not publish credentials or exploitable details in a public issue. Contact the repository owner privately before public disclosure when a vulnerability could expose users, credentials, repositories, or provider accounts.
