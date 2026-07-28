# HCO 2.1.0 Roadmap

## Hermes Control Plane

Status: Planning
Prerequisite: HCO 2.0.0 released

---

# Vision

HCO should evolve beyond an execution engine into the operational control plane for Hermes.

Hermes is responsible for understanding the user, planning work, improving vague requests, assigning execution, reviewing results, and making decisions.

HCO is responsible for safely executing work, managing providers, enforcing policy, isolating workspaces, validating results, and exposing operational state.

Claude Code remains the coding agent.

The architecture becomes:

User
│
▼
Hermes
(Intent, Planning, Decision Making)
│
▼
HCO
(Control Plane)
│
▼
Claude Code
(Implementation)

---

# Guiding Principles

- Hermes thinks.
- HCO controls.
- Claude Code builds.

Never duplicate Claude Code.

Never move orchestration into HCO.

Never allow uncontrolled execution.

Everything must remain:

- deterministic
- measurable
- resumable
- isolated
- auditable
- recoverable

---

# Pillar 1 — Provider Management

Current pain:

Manual .env editing, stale environment variables, provider conflicts, broken mappings.

Goal:

HCO owns provider management.

Capabilities:

- Provider registry
- Credential management
- Provider validation
- Health checks
- Compatibility testing
- Provider history
- Safe activation
- Automatic rollback

Provider lifecycle:

Register
↓

Validate
↓

Discover models
↓

Recommend mappings
↓

Acceptance test
↓

Activate
↓

Rollback if needed

---

# Pillar 2 — Model Discovery & Mapping

Automatically discover available models.

Support provider-specific model IDs.

Examples:

- cx/gpt-5.6-terra
- lv/claude-sonnet-5
- deepseek-v4-pro

Map discovered models into Claude Code roles.

Supported roles:

- Fable
- Opus
- Sonnet
- Haiku
- Subagent (optional)

Mappings are operational roles, not claims of model equivalence.

Every mapping should be validated before activation.

---

# Pillar 3 — Workspace Isolation

Every project becomes an isolated workspace.

Workspace contains:

- repository
- provider profile
- model mapping
- policy snapshot
- environment profile
- execution history
- validation history
- artifacts
- logs
- Claude session references

No workspace should contaminate another.

Hermes resumes workspaces, not conversations.

---

# Pillar 4 — Slash Command Interface

Expose operational commands through Hermes.

Examples:

/hco help

/hco status

/hco doctor

/hco projects

/hco ongoing

/hco history

/hco providers

/hco models

/hco mappings

/hco switch

/hco usage

/hco effort

/hco result

Commands query HCO.

They are not sent into Claude Code.

---

# Pillar 5 — Operational Intelligence

Provide visibility into execution.

Examples:

- execution count
- success rate
- validation duration
- average runtime
- failure rate
- recovery count
- queue health
- provider health

Hermes should understand system health without inspecting raw logs.

---

# Pillar 6 — Diagnostics

Implement HCO Doctor.

Checks include:

- Node.js
- Claude Code
- provider connectivity
- authentication
- model discovery
- tool support
- streaming
- MCP
- SQLite
- repository permissions
- execution adapter
- queue
- environment
- policy
- acceptance readiness

---

# Pillar 7 — Hermes Prompt Enhancement

Hermes should never forward vague user requests directly.

Hermes transforms:

User Request

↓

Intent Analysis

↓

Clarification

↓

Planning

↓

Constraint Injection

↓

ExecutionRequestV1

↓

HCO

↓

Claude Code

Claude Code should always receive a structured execution request.

---

# Future MCP APIs

Potential additions:

- hco_provider_register
- hco_provider_validate
- hco_provider_models
- hco_provider_mapping_recommend
- hco_provider_activate
- hco_provider_status
- hco_workspace_list
- hco_workspace_resume
- hco_workspace_status
- hco_doctor
- hco_statistics

---

# Non Goals

HCO should NOT:

- replace Claude Code
- implement planning AI
- decide milestones
- review architecture
- rewrite prompts independently
- become another coding agent

Those responsibilities belong to Hermes.

---

# Success Criteria

Users should be able to:

- add providers safely
- switch providers safely
- map models safely
- inspect system health
- resume workspaces
- monitor executions
- understand failures
- recover quickly

without editing environment variables or manually modifying Claude Code configuration.

HCO becomes the trusted execution control plane underneath Hermes.
