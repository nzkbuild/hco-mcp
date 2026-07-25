import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import {
  createExecution,
  transitionToQueued,
  transitionToRunning,
  transitionToCompleted,
  transitionToFailed,
  transitionToCancelled,
  transitionToTimedOut,
  transitionToAwaitingInput,
  transitionToArchived,
  isTerminal,
} from '../src/state/execution-repository.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';

const TEST_DB_DIR = '/tmp/hco-test-state-machine';

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
      binary_path: 'claude',
      default_timeout_ms: 300_000,
      session_dir: '/tmp/hco-claude',
    },
    repository_allowlist: [{ owner: 'nzkbuild', repo: 'hco-mcp' }],
  });
}

function validPolicy() {
  return PolicySnapshotV1.parse({
    repository_boundary: { owner: 'nzkbuild', repo: 'hco-mcp', local_path: '/tmp/test' },
    permission_limits: {
      allowed_tools: ['Read', 'Write', 'Edit', 'Bash'],
      deny_shell_access: true,
    },
    timeout_ceiling_ms: 600_000,
    max_concurrency: 4,
    approval_required: true,
  });
}

function acceptedExecution(db: Database.Database) {
  return createExecution(db, validRequest(), validProfile(), validPolicy());
}

describe('Execution State Machine', () => {
  let db: Database.Database;

  before(() => {
    db = freshDb();
  });

  after(() => {
    db?.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  // Valid transitions

  it('accepted → queued transitions successfully', () => {
    const exec = acceptedExecution(db);
    const result = transitionToQueued(db, exec.executionId);
    assert.ok(result);
    assert.equal(result.status, 'queued');
  });

  it('queued → running transitions successfully', () => {
    const exec = acceptedExecution(db);
    transitionToQueued(db, exec.executionId);
    const result = transitionToRunning(db, exec.executionId);
    assert.ok(result);
    assert.equal(result.status, 'running');
  });

  it('running → completed transitions successfully', () => {
    const exec = acceptedExecution(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);
    const result = transitionToCompleted(db, exec.executionId, 0);
    assert.ok(result);
    assert.equal(result.status, 'completed');
  });

  it('running → failed records error in event payload', () => {
    const exec = acceptedExecution(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);
    const result = transitionToFailed(db, exec.executionId, 'Something broke');
    assert.ok(result);
    assert.equal(result.status, 'failed');

    const events = db
      .prepare(
        'SELECT * FROM execution_events WHERE execution_id = ? AND type = ? ORDER BY id DESC',
      )
      .all(exec.executionId, 'failed') as Array<{ payload: string }>;
    assert.equal(events.length, 1);
    const payload = JSON.parse(events[0].payload) as Record<string, unknown>;
    assert.equal(payload.error, 'Something broke');
  });

  it('running → cancelled records reason in event payload', () => {
    const exec = acceptedExecution(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);
    const result = transitionToCancelled(db, exec.executionId, 'User cancelled');
    assert.ok(result);
    assert.equal(result.status, 'cancelled');

    const events = db
      .prepare(
        'SELECT * FROM execution_events WHERE execution_id = ? AND type = ? ORDER BY id DESC',
      )
      .all(exec.executionId, 'cancelled') as Array<{ payload: string }>;
    const payload = JSON.parse(events[0].payload) as Record<string, unknown>;
    assert.equal(payload.reason, 'User cancelled');
  });

  it('running → timed_out transitions successfully', () => {
    const exec = acceptedExecution(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);
    const result = transitionToTimedOut(db, exec.executionId);
    assert.ok(result);
    assert.equal(result.status, 'timed_out');
  });

  it('running → awaiting_input transitions successfully', () => {
    const exec = acceptedExecution(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);
    const result = transitionToAwaitingInput(db, exec.executionId);
    assert.ok(result);
    assert.equal(result.status, 'awaiting_input');
  });

  it('completed → archived transitions (terminal → archived one-way)', () => {
    const exec = acceptedExecution(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);
    transitionToCompleted(db, exec.executionId, 0);
    const result = transitionToArchived(db, exec.executionId);
    assert.ok(result);
    assert.equal(result.status, 'archived');
  });

  // Invalid transitions

  it('archived → * ALL rejected (no transitions from archived)', () => {
    const exec = acceptedExecution(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);
    transitionToCompleted(db, exec.executionId, 0);
    transitionToArchived(db, exec.executionId);

    assert.equal(transitionToRunning(db, exec.executionId), null);
    assert.equal(transitionToQueued(db, exec.executionId), null);
    assert.equal(transitionToCompleted(db, exec.executionId), null);
    assert.equal(transitionToFailed(db, exec.executionId), null);
    assert.equal(transitionToCancelled(db, exec.executionId), null);
    assert.equal(transitionToTimedOut(db, exec.executionId), null);
    assert.equal(transitionToAwaitingInput(db, exec.executionId), null);
    // archived → archived also invalid
    assert.equal(transitionToArchived(db, exec.executionId), null);
  });

  it('accepted → running (skip queued) is rejected', () => {
    const exec = acceptedExecution(db);
    const result = transitionToRunning(db, exec.executionId);
    assert.equal(result, null);
  });

  it('awaiting_input → completed (skip running) is rejected', () => {
    const exec = acceptedExecution(db);
    transitionToQueued(db, exec.executionId);
    transitionToRunning(db, exec.executionId);
    transitionToAwaitingInput(db, exec.executionId);
    const result = transitionToCompleted(db, exec.executionId);
    assert.equal(result, null);
  });

  it('non-terminal → archived is rejected', () => {
    const exec = acceptedExecution(db);
    assert.equal(transitionToArchived(db, exec.executionId), null);

    transitionToQueued(db, exec.executionId);
    assert.equal(transitionToArchived(db, exec.executionId), null);
  });

  // Events and utilities

  it('each transition appends exactly one execution_events row', () => {
    const exec = acceptedExecution(db);
    const initialCount = (
      db
        .prepare('SELECT COUNT(*) AS c FROM execution_events WHERE execution_id = ?')
        .get(exec.executionId) as { c: number }
    ).c;

    transitionToQueued(db, exec.executionId);
    const afterQueued = (
      db
        .prepare('SELECT COUNT(*) AS c FROM execution_events WHERE execution_id = ?')
        .get(exec.executionId) as { c: number }
    ).c;
    assert.equal(afterQueued, initialCount + 1);

    transitionToRunning(db, exec.executionId);
    const afterRunning = (
      db
        .prepare('SELECT COUNT(*) AS c FROM execution_events WHERE execution_id = ?')
        .get(exec.executionId) as { c: number }
    ).c;
    assert.equal(afterRunning, afterQueued + 1);
  });

  it('transition for non-existent execution returns null', () => {
    assert.equal(transitionToQueued(db, 'nonexistent'), null);
    assert.equal(transitionToRunning(db, 'nonexistent'), null);
    assert.equal(transitionToCompleted(db, 'nonexistent'), null);
    assert.equal(transitionToFailed(db, 'nonexistent'), null);
    assert.equal(transitionToCancelled(db, 'nonexistent'), null);
    assert.equal(transitionToTimedOut(db, 'nonexistent'), null);
    assert.equal(transitionToAwaitingInput(db, 'nonexistent'), null);
    assert.equal(transitionToArchived(db, 'nonexistent'), null);
  });

  it('isTerminal returns true for terminal, false for non-terminal', () => {
    assert.equal(isTerminal('completed'), true);
    assert.equal(isTerminal('failed'), true);
    assert.equal(isTerminal('cancelled'), true);
    assert.equal(isTerminal('timed_out'), true);
    assert.equal(isTerminal('running'), false);
    assert.equal(isTerminal('accepted'), false);
    assert.equal(isTerminal('queued'), false);
    assert.equal(isTerminal('awaiting_input'), false);
    assert.equal(isTerminal('archived'), false);
    // archived is NOT terminal — it's a post-terminal marker
  });

  it('cancelled can be reached from queued (without running)', () => {
    const exec = acceptedExecution(db);
    transitionToQueued(db, exec.executionId);
    const result = transitionToCancelled(db, exec.executionId);
    assert.ok(result);
    assert.equal(result.status, 'cancelled');
  });
});
