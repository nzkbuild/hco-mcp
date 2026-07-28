# HCO Slash Command Specification

Each `/hco` command is implemented by Hermes calling an HCO MCP tool.
HCO does not implement slash commands — it provides the MCP tools below.

## Status & Discovery

| Command       | MCP Tool     | Purpose                                    |
| ------------- | ------------ | ------------------------------------------ |
| `/hco help`   | `tools/list` | List all available HCO tools               |
| `/hco status` | `hco_status` | Job counts, milestone counts, session info |
| `/hco health` | `hco_health` | DB size, schema version, execution counts  |

## Provider Management

| Command                       | MCP Tool                | Purpose                               |
| ----------------------------- | ----------------------- | ------------------------------------- |
| `/hco providers`              | `hco_provider_list`     | List all registered providers         |
| `/hco provider add <json>`    | `hco_provider_register` | Register a new provider profile       |
| `/hco provider validate <id>` | `hco_provider_validate` | Validate credentials, discover models |
| `/hco provider activate <id>` | `hco_provider_activate` | Activate a validated provider         |
| `/hco provider rollback <id>` | `hco_provider_rollback` | Rollback to failed status             |

## Model Mapping

| Command                                | MCP Tool                           | Purpose                               |
| -------------------------------------- | ---------------------------------- | ------------------------------------- |
| `/hco models <provider_id>`            | `hco_provider_models`              | List available models from a provider |
| `/hco mappings <provider_id>`          | `hco_provider_mapping_recommend`   | Recommend HCO role mappings           |
| `/hco switch <provider_id> <model_id>` | `hco_provider_activate` + mappings | Switch active model mapping           |

## Execution

| Command                      | MCP Tool                                       | Purpose                        |
| ---------------------------- | ---------------------------------------------- | ------------------------------ |
| `/hco run <json>`            | `hco_execution_submit` → `hco_execution_start` | Submit and start an execution  |
| `/hco result <execution_id>` | `hco_execution_result`                         | Get structured terminal result |
| `/hco cancel <execution_id>` | `hco_execution_cancel`                         | Cancel a running execution     |
| `/hco ongoing`               | `hco_execution_status` + `hco_statistics`      | List active/queued executions  |

## Workspaces

| Command                       | MCP Tool               | Purpose                              |
| ----------------------------- | ---------------------- | ------------------------------------ |
| `/hco projects`               | `hco_workspace_list`   | List all workspaces                  |
| `/hco resume <owner> <repo>`  | `hco_workspace_resume` | Create or resume workspace           |
| `/hco history <workspace_id>` | `hco_workspace_status` | Workspace status + recent executions |

## Diagnostics

| Command                      | MCP Tool                 | Purpose                             |
| ---------------------------- | ------------------------ | ----------------------------------- |
| `/hco doctor`                | `hco_doctor`             | Run systematic health checks        |
| `/hco usage`                 | `hco_statistics`         | Execution statistics and trends     |
| `/hco effort <execution_id>` | `hco_execution_artifact` | Retrieve execution output/artifacts |

## Command Flow Examples

### Submit and run

```
/hco run {"brief": {...}, "repository": {...}, "claude_config": {...}}
→ hco_execution_submit(request_json, profile_json, policy_json)
→ returns {execution_id, status: "accepted"}
→ hco_execution_start(execution_id)
→ returns {execution_id, status: "running"}
→ hco_execution_wait(execution_id)
→ returns ExecutionResultV1
```

### Provider lifecycle

```
/hco provider add {"profile_id":"...","provider":"anthropic","api_key_env":"ANTHROPIC_API_KEY"}
→ hco_provider_register
→ /hco provider validate <id>
→ hco_provider_validate
→ /hco provider activate <id>
→ hco_provider_activate
```
