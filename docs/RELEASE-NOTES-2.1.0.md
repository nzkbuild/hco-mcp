# HCO 2.1.0 Release Notes

**Hermes Control Plane**

Version 2.1.0 evolves HCO from an execution engine into the operational control plane for Hermes. This release adds provider management, workspace isolation, operational intelligence, and systematic diagnostics.

---

## New Features

### Provider Management

HCO now owns the provider lifecycle:

- **Register** providers with type-aware profiles (Anthropic, OpenAI, custom)
- **Validate** credentials and discover available models
- **Recommend** model-to-role mappings (fable, opus, sonnet, haiku, subagent)
- **Activate** validated providers with selected mappings
- **Rollback** providers to failed state without data loss

Provider data is persisted in the new `providers` and `provider_events` tables (migration v11) with append-only event logging and state machine enforcement.

### Workspace Isolation

Every project becomes an isolated workspace:

- **Resume** workspace for a repository + provider combination (idempotent)
- **List** all workspaces with status
- **Status** shows workspace + associated provider health

Workspaces are persisted in the new `workspaces` table (migration v12) with partial unique indexes ensuring one active workspace per repository + provider combination. Foreign key constraints enforce provider existence.

### Operational Intelligence

New `hco_statistics` MCP tool provides:

- Execution overview (total, by status, success rate, avg duration)
- Queue health (pending depth, stale leases)
- Provider health (per-provider execution counts)
- Timeline (daily execution counts for 30 days)

All statistics are derived from existing `executions` data — no new event stream or tables.

### HCO Doctor

`hco_doctor` runs 15 systematic health checks across 4 categories:

| Category       | Checks                                                                                  |
| -------------- | --------------------------------------------------------------------------------------- |
| Infrastructure | Node.js version, Claude binary, SQLite health, disk space                               |
| Provider       | Connectivity, authentication, model discovery                                           |
| Execution      | Tool support, streaming status, adapter type, queue health                              |
| Security       | MCP protocol discipline, repository permissions, environment vars, acceptance readiness |

Results are aggregated into `healthy` / `degraded` / `unhealthy` status with per-check detail and duration.

## New MCP Tools (12)

| Tool                             | Category                 |
| -------------------------------- | ------------------------ |
| `hco_provider_register`          | Provider management      |
| `hco_provider_validate`          | Provider management      |
| `hco_provider_models`            | Model discovery          |
| `hco_provider_mapping_recommend` | Model mapping            |
| `hco_provider_activate`          | Provider lifecycle       |
| `hco_provider_status`            | Provider status          |
| `hco_provider_list`              | Provider listing         |
| `hco_provider_rollback`          | Provider lifecycle       |
| `hco_workspace_resume`           | Workspace operations     |
| `hco_workspace_list`             | Workspace operations     |
| `hco_workspace_status`           | Workspace operations     |
| `hco_statistics`                 | Operational intelligence |
| `hco_doctor`                     | Diagnostics              |

## Contract Changes

### Extended

- `ProviderProfileV1`: Now supports `anthropic` | `openai` | `custom` provider types with optional `provider_metadata`

### New

- `ModelInfoV1`: Provider model information (id, display name, capabilities)
- `ModelMappingV1`: Provider model → HCO role mapping (fable/opus/sonnet/haiku/subagent)
- `WorkspaceV1`: Repository + provider binding with optional policy/env snapshots
- `ExecutionStatsV1`: Structured statistics output

## Database Migrations

| Migration | Version                | Creates                                                        |
| --------- | ---------------------- | -------------------------------------------------------------- |
| v11       | providers-and-mappings | `providers`, `provider_events` (append-only), `model_mappings` |
| v12       | workspaces             | `workspaces` with FK to providers, partial unique index        |

## Architecture

```
Hermes (intent, planning)
  ↓
HCO 2.1.0 (control plane)
  ├── Provider management
  ├── Workspace isolation
  ├── Execution pipeline (2.0.0)
  ├── Statistics & doctor
  ↓
Claude Code (implementation)
```

## Breaking Changes

None from HCO 2.0.0. All existing MCP tools, contracts, and database tables continue to function.

## Migration from 2.0.0

No migration required. New tables (v11, v12) are created automatically by the migration system. Existing `executions`, `execution_events`, `process_attempts`, and `artifacts` tables are unchanged.

## Known Limitations

- Provider adapters for OpenAI and custom types return stub responses ("not yet implemented")
- `hco_provider_validate` and `hco_provider_models` call the real Anthropic API in the MCP server; use the fake adapter for test environments
- Workspace `createOrResume` requires an active provider — providers must be validated and activated before workspaces can be created
- Slash commands (`/hco ...`) are implemented by Hermes calling HCO MCP tools; they are documented in `docs/slash-commands.md` but not built into HCO

## Test Coverage

All new functionality includes:

- Contract validation tests (Zod schema parsing)
- Repository tests (state machine transitions, FK constraints, append-only enforcement)
- Service tests (orchestration, adapter injection)
- Real MCP transport tests (JSON-RPC via stdio client transport)
- Doctor check tests (15 checks verified independently)
