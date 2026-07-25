import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import { ExecutionService } from '../src/execution/service.js';
import { FakeClaudeCodeAdapter } from '../src/claude/adapter.js';
import { _testSetState, handleExecutionContinue } from '../src/mcp/server.js';
import { handleExecutionSubmit } from '../src/mcp/server.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';

const TEST_DB_DIR = '/tmp/hco-test-mcp-handlers';
let db: Database.Database;

function validRequestJson() {
  return JSON.stringify({
    brief: {
      original_request: 'Test.',
      objective: 'Test.',
      context: '',
      constraints: [],
      acceptance_criteria: [],
      requested_validation: [],
    },
    claude_config: {},
    repository: { owner: 'nzkbuild', repo: 'hco-mcp', path: '/tmp/test' },
    policy_ref: 'test',
    schema_version: 1,
  });
}

function validProfileJson() {
  return JSON.stringify({
    profile_id: 'test-profile',
    claude_defaults: {
      binary_path: 'echo',
      default_timeout_ms: 300_000,
      session_dir: '/tmp/hco-claude',
    },
    repository_allowlist: [{ owner: 'nzkbuild', repo: 'hco-mcp' }],
    schema_version: 1,
  });
}

function validPolicyJson() {
  return JSON.stringify({
    repository_boundary: {
      owner: 'nzkbuild',
      repo: 'hco-mcp',
      local_path: '/tmp/test',
    },
    permission_limits: {
      allowed_tools: ['Read', 'Write', 'Edit', 'Bash'],
      deny_shell_access: true,
    },
    timeout_ceiling_ms: 600_000,
    max_concurrency: 4,
    approval_required: true,
    schema_version: 1,
  });
}

describe('MCP handler-level tests (awaiting_input)', () => {
  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    db = openDb(TEST_DB_DIR);
  });

  after(() => {
    db?.close();
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('handleExecutionContinue succeeds when execution is in awaiting_input', async () => {
    const adapter = new FakeClaudeCodeAdapter({ awaitingInputCount: 1 });
    const service = new ExecutionService(db, adapter);
    _testSetState({ db, launcher: undefined, executionService: service });

    // Submit → start → adapter fires awaiting_input
    const submitResp = handleExecutionSubmit({
      request_json: validRequestJson(),
      profile_json: validProfileJson(),
      policy_json: validPolicyJson(),
    });
    assert.ok('data' in submitResp);
    const executionId = (submitResp.data as Record<string, unknown>).execution_id as string;

    // Start the execution — fake adapter will fire awaiting_input via setImmediate
    const { handleExecutionStart } = await import('../src/mcp/server.js');
    handleExecutionStart({ execution_id: executionId });

    // Wait for async onExit
    await new Promise((r) => setTimeout(r, 50));

    // Verify waiting for input
    const { handleExecutionStatus } = await import('../src/mcp/server.js');
    const statusResp = handleExecutionStatus({ execution_id: executionId });
    assert.ok('data' in statusResp);
    assert.equal((statusResp.data as Record<string, unknown>).status, 'awaiting_input');

    // Now continue
    const continueResp = handleExecutionContinue({
      execution_id: executionId,
      prompt: 'Proceed with the next step.',
    });

    assert.ok('data' in continueResp);
    assert.equal((continueResp.data as Record<string, unknown>).status, 'running');

    // After continue fires, adapter completes
    await new Promise((r) => setTimeout(r, 50));
    const finalResp = handleExecutionStatus({ execution_id: executionId });
    assert.equal((finalResp.data as Record<string, unknown>).status, 'completed');
  });

  it('handleExecutionContinue returns error when execution is not in awaiting_input', () => {
    const adapter = new FakeClaudeCodeAdapter({ awaitingInputCount: 1 });
    const service = new ExecutionService(db, adapter);
    _testSetState({ db, launcher: undefined, executionService: service });

    const submitResp = handleExecutionSubmit({
      request_json: validRequestJson(),
      profile_json: validProfileJson(),
      policy_json: validPolicyJson(),
    });
    const executionId = (submitResp.data as Record<string, unknown>).execution_id as string;

    const continueResp = handleExecutionContinue({
      execution_id: executionId,
      prompt: 'Should fail.',
    });

    assert.ok('error' in continueResp);
    assert.equal((continueResp.error as Record<string, unknown>).code, 'INVALID_LIFECYCLE');
  });

  it('handleExecutionContinue returns error for unknown execution', () => {
    const adapter = new FakeClaudeCodeAdapter({ awaitingInputCount: 1 });
    const service = new ExecutionService(db, adapter);
    _testSetState({ db, launcher: undefined, executionService: service });

    const continueResp = handleExecutionContinue({
      execution_id: 'nonexistent',
      prompt: 'Should fail.',
    });

    assert.ok('error' in continueResp);
    assert.equal((continueResp.error as Record<string, unknown>).code, 'INVALID_LIFECYCLE');
  });
});
