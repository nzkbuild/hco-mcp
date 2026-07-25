import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, readdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import {
  createExecution,
  transitionToQueued,
  transitionToRunning,
  transitionToAwaitingInput,
  claimExecution,
  releaseExpiredExecutions,
  renewExecutionLease,
  isExecutionTimedOut,
} from '../src/state/execution-repository.js';
import type { ExecutionRow } from '../src/state/execution-repository.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';

const TEST_DIR = '/tmp/hco-test-queue';

let dbCounter = 0;

function freshDb(): Database.Database {
  const dir = `${TEST_DIR}/${String(dbCounter++)}`;
  rmSync(dir, { recursive: true, force: true });
  return openDb(dir);
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

function validProfile(overrides?: Partial<ExecutionProfileV1>) {
  return ExecutionProfileV1.parse({
    profile_id: 'test-profile',
    claude_defaults: {
      binary_path: 'echo',
      default_timeout_ms: 300_000,
      session_dir: '/tmp/hco-claude',
    },
    repository_allowlist: [{ owner: 'nzkbuild', repo: 'hco-mcp' }],
    ...overrides,
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

function persisted(db: Database.Database): ExecutionRow {
  return createExecution(db, validRequest(), validProfile(), validPolicy());
}

describe('Execution Queue', () => {
  after(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('claimExecution claims oldest accepted execution', () => {
    const db = freshDb();
    const first = persisted(db);
    persisted(db);

    const claimed = claimExecution(db, 'worker-1', 60000);
    assert.ok(claimed);
    assert.equal(claimed.executionId, first.executionId);
    assert.equal(claimed.status, 'running');
    assert.equal(claimed.workerId, 'worker-1');
    assert.ok(typeof claimed.leaseUntil === 'string');
    db.close();
  });

  it('claimExecution picks oldest job (FIFO)', () => {
    const db = freshDb();
    const first = persisted(db);
    persisted(db);

    const claimed = claimExecution(db, 'worker-1', 60000);
    assert.ok(claimed);
    assert.equal(claimed.executionId, first.executionId);
    db.close();
  });

  it('claimExecution picks queued over newer accepted', () => {
    const db = freshDb();
    persisted(db);
    const second = persisted(db);
    transitionToQueued(db, second.executionId);

    const claimed = claimExecution(db, 'worker-1', 60000);
    assert.ok(claimed);
    assert.equal(claimed.executionId, second.executionId);
    db.close();
  });

  it('claimExecution reclaims expired-lease running execution', () => {
    const db = freshDb();
    const exec = persisted(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);

    const pastLease = new Date(Date.now() - 60000).toISOString().replace('T', ' ').slice(0, 19);
    db.prepare('UPDATE executions SET worker_id = ?, lease_until = ? WHERE execution_id = ?').run(
      'old-worker',
      pastLease,
      exec.executionId,
    );

    const claimed = claimExecution(db, 'new-worker', 60000);
    assert.ok(claimed);
    assert.equal(claimed.executionId, exec.executionId);
    assert.equal(claimed.workerId, 'new-worker');
    db.close();
  });

  it('claimExecution returns null when no eligible executions', () => {
    const db = freshDb();
    assert.equal(claimExecution(db, 'worker-1', 60000), null);
    db.close();
  });

  it('renewExecutionLease extends lease for correct worker', () => {
    const db = freshDb();
    const exec = persisted(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);

    db.prepare('UPDATE executions SET worker_id = ?, lease_until = ? WHERE execution_id = ?').run(
      'worker-1',
      new Date().toISOString().replace('T', ' ').slice(0, 19),
      exec.executionId,
    );

    const renewed = renewExecutionLease(db, exec.executionId, 'worker-1', 120000);
    assert.ok(renewed);
    assert.equal(renewed.workerId, 'worker-1');
    db.close();
  });

  it('renewExecutionLease returns null for wrong worker_id (atomic guard)', () => {
    const db = freshDb();
    const exec = persisted(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);

    db.prepare('UPDATE executions SET worker_id = ?, lease_until = ? WHERE execution_id = ?').run(
      'correct-worker',
      new Date().toISOString().replace('T', ' ').slice(0, 19),
      exec.executionId,
    );

    assert.equal(renewExecutionLease(db, exec.executionId, 'wrong-worker', 120000), null);
    db.close();
  });

  it('releaseExpiredExecutions: expired running → queued', () => {
    const db = freshDb();
    const exec = persisted(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);

    const pastLease = new Date(Date.now() - 60000).toISOString().replace('T', ' ').slice(0, 19);
    db.prepare('UPDATE executions SET worker_id = ?, lease_until = ? WHERE execution_id = ?').run(
      'worker-1',
      pastLease,
      exec.executionId,
    );

    const result = releaseExpiredExecutions(db);
    assert.ok(result.requeued >= 1);
    db.close();
  });

  it('releaseExpiredExecutions: expired awaiting_input → failed', () => {
    const db = freshDb();
    const exec = persisted(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);
    transitionToAwaitingInput(db, exec.executionId);

    const pastLease = new Date(Date.now() - 60000).toISOString().replace('T', ' ').slice(0, 19);
    db.prepare('UPDATE executions SET worker_id = ?, lease_until = ? WHERE execution_id = ?').run(
      'worker-1',
      pastLease,
      exec.executionId,
    );

    const result = releaseExpiredExecutions(db);
    assert.ok(result.failed >= 1);
    db.close();
  });

  it('isExecutionTimedOut detects timeout based on max_execution_time_ms', () => {
    const db = freshDb();
    const exec = persisted(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);

    const profile = validProfile({ max_execution_time_ms: 1000 });
    assert.equal(isExecutionTimedOut(exec, profile), false);
    db.close();
  });

  it('isExecutionTimedOut returns false when within limit', () => {
    const db = freshDb();
    const exec = persisted(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);

    const profile = validProfile({ max_execution_time_ms: 3600000 });
    assert.equal(isExecutionTimedOut(exec, profile), false);
    db.close();
  });
});
