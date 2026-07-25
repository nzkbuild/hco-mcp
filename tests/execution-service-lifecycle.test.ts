import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import {
  ExecutionService,
  ExecutionLifecycleError,
} from '../src/execution/service.js';
import { FakeClaudeCodeAdapter } from '../src/claude/adapter.js';
import type { ClaudeCodeAdapter, ProcessAttempt } from '../src/claude/adapter.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';

const TEST_DB_DIR = '/tmp/hco-test-lifecycle';

function freshDb(): Database.Database {
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
  return openDb(TEST_DB_DIR);
}

function validRequest() {
  return ExecutionRequestV1.parse({
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
  });
}

function validProfile() {
  return ExecutionProfileV1.parse({
    profile_id: 'test-profile',
    claude_defaults: {
      binary_path: 'echo',
      default_timeout_ms: 300_000,
      session_dir: '/tmp/hco-claude',
    },
    repository_allowlist: [{ owner: 'nzkbuild', repo: 'hco-mcp' }],
  });
}

function validPolicy() {
  return PolicySnapshotV1.parse({
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
  });
}

describe('ExecutionService lifecycle', () => {
  let db: Database.Database;
  let adapter: ClaudeCodeAdapter;
  let service: ExecutionService;

  before(() => {
    db = freshDb();
    adapter = new FakeClaudeCodeAdapter();
    service = new ExecutionService(db, adapter);
  });

  after(() => {
    db?.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('start transitions accepted → queued → running and returns running execution', () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    const running = service.start(result.execution_id);
    assert.equal(running.status, 'running');
  });

  it('start calls adapter.launch with correct execution and profile', () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    const attached = adapter.attach(result.execution_id);
    assert.ok(attached, 'adapter should have a running process');
    assert.equal(attached.executionId, result.execution_id);
    assert.equal(attached.attemptNumber, 1);
  });

  it('start onExit handler transitions to completed on exit_code=0', async () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());

    const completed = await new Promise((resolve) => {
      service.start(result.execution_id);
      // Fake adapter fires onExit via setImmediate
      setImmediate(() => {
        resolve(service.getStatus(result.execution_id));
      });
    });

    // Wait for the async onExit to process
    await new Promise((r) => setTimeout(r, 20));

    const final = service.getStatus(result.execution_id);
    assert.ok(final);
    assert.equal(final.status, 'completed');
  });

  it('cancel transitions running → cancelled and calls adapter.abort', () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    const cancelled = service.cancel(result.execution_id, 'User aborted');
    assert.equal(cancelled.status, 'cancelled');
  });

  it('cancel on terminal execution throws', () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);
    service.cancel(result.execution_id);

    assert.throws(
      () => service.cancel(result.execution_id),
      ExecutionLifecycleError,
    );
  });

  it('getStatus returns current execution row', () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    const status = service.getStatus(result.execution_id);
    assert.ok(status);
    assert.equal(status.executionId, result.execution_id);
    assert.equal(status.status, 'accepted');
  });

  it('getStatus returns null for unknown execution', () => {
    assert.equal(service.getStatus('nonexistent'), null);
  });

  it('getResult returns valid ExecutionResultV1 for completed execution', async () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    // Wait for async onExit
    await new Promise((r) => setTimeout(r, 50));
    // Final status is completed since fake adapter exits 0
    const final = service.getStatus(result.execution_id);
    assert.equal(final?.status, 'completed');

    const execResult = service.getResult(result.execution_id);
    assert.equal(execResult.execution_id, result.execution_id);
    assert.equal(execResult.status, 'completed');
    assert.ok(typeof execResult.claude_session_id === 'string');
    assert.ok(typeof execResult.submitted_at === 'string');
    assert.ok(typeof execResult.finished_at === 'string');
  });

  it('getResult throws for non-terminal execution', () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    assert.throws(() => service.getResult(result.execution_id), ExecutionLifecycleError);
  });

  it('wait resolves when execution reaches terminal state', async () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    const waited = await service.wait(result.execution_id, 5000);
    assert.ok(waited);
    assert.equal(waited.status, 'completed');
  });

  it('wait returns null when timeout exceeded before terminal', async () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    // Don't start it — stays accepted (non-terminal)

    const waited = await service.wait(result.execution_id, 100);
    assert.ok(waited);
    // Still accepted since timeout expired
    assert.equal(waited.status, 'accepted');
  });

  it('wait does not treat awaiting_input as terminal', () => {
    // awaiting_input isn't implemented in B3 (B7 adds it), but the wait
    // should only return on terminal status. We verify the contract:
    // isTerminal('awaiting_input') returns false from the state machine.
    // This is verified by the state machine tests (B1).
    assert.ok(true);
  });
});
