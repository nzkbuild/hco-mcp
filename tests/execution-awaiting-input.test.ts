import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import { ExecutionService, ExecutionLifecycleError } from '../src/execution/service.js';
import { FakeClaudeCodeAdapter } from '../src/claude/adapter.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';

const TEST_DIR = '/tmp/hco-test-awaiting-input';
let dbCount = 0;

function freshDb(): Database.Database {
  const d = `${TEST_DIR}/${String(dbCount++)}`;
  rmSync(d, { recursive: true, force: true });
  return openDb(d);
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

describe('ExecutionService awaiting_input', () => {
  after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('onExit transitions to awaiting_input when adapter emits signal', async () => {
    const db = freshDb();
    const adapter = new FakeClaudeCodeAdapter({ awaitingInputCount: 1 });
    const service = new ExecutionService(db, adapter);

    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    await new Promise((r) => setTimeout(r, 50));

    const status = service.getStatus(result.execution_id);
    assert.ok(status);
    assert.equal(status.status, 'awaiting_input');
    db.close();
  });

  it('continue transitions awaiting_input → running and completes on final', async () => {
    const db = freshDb();
    const adapter = new FakeClaudeCodeAdapter({ awaitingInputCount: 1 });
    const service = new ExecutionService(db, adapter);

    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(service.getStatus(result.execution_id)?.status, 'awaiting_input');

    const continued = service.continue(result.execution_id, 'Proceed.');
    assert.equal(continued.status, 'running');

    // After continue, seen=1 >= count=1, so adapter completes with exit_code=0
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(service.getStatus(result.execution_id)?.status, 'completed');
    db.close();
  });

  it('continue throws when not in awaiting_input', async () => {
    const db = freshDb();
    const adapter = new FakeClaudeCodeAdapter();
    const service = new ExecutionService(db, adapter);

    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(service.getStatus(result.execution_id)?.status, 'completed');

    assert.throws(() => service.continue(result.execution_id, 'prompt'), ExecutionLifecycleError);
    db.close();
  });

  it('continue throws for accepted status', () => {
    const db = freshDb();
    const adapter = new FakeClaudeCodeAdapter({ awaitingInputCount: 1 });
    const service = new ExecutionService(db, adapter);

    const result = service.submit(validRequest(), validProfile(), validPolicy());
    assert.throws(() => service.continue(result.execution_id, 'prompt'), ExecutionLifecycleError);
    db.close();
  });

  it('cancel from awaiting_input transitions to cancelled', async () => {
    const db = freshDb();
    const adapter = new FakeClaudeCodeAdapter({ awaitingInputCount: 1 });
    const service = new ExecutionService(db, adapter);

    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(service.getStatus(result.execution_id)?.status, 'awaiting_input');

    const cancelled = service.cancel(result.execution_id, 'No longer needed');
    assert.equal(cancelled.status, 'cancelled');
    db.close();
  });

  it('multiple pause-continue cycles work', async () => {
    const db = freshDb();
    const adapter = new FakeClaudeCodeAdapter({ awaitingInputCount: 2 });
    const service = new ExecutionService(db, adapter);

    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    // Cycle 1
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(service.getStatus(result.execution_id)?.status, 'awaiting_input');

    service.continue(result.execution_id, 'First continue');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(service.getStatus(result.execution_id)?.status, 'awaiting_input');

    // Cycle 2
    service.continue(result.execution_id, 'Second continue');
    await new Promise((r) => setTimeout(r, 50));
    // After 2 continues, seen=2 >= count=2, adapter completes
    assert.equal(service.getStatus(result.execution_id)?.status, 'completed');
    db.close();
  });

  it('wait does not treat awaiting_input as terminal', async () => {
    const db = freshDb();
    const adapter = new FakeClaudeCodeAdapter({ awaitingInputCount: 1 });
    const service = new ExecutionService(db, adapter);

    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    const waited = await service.wait(result.execution_id, 300);
    assert.ok(waited);
    assert.equal(waited.status, 'awaiting_input');
    db.close();
  });

  it('awaiting_input event is recorded', async () => {
    const db = freshDb();
    const adapter = new FakeClaudeCodeAdapter({ awaitingInputCount: 1 });
    const service = new ExecutionService(db, adapter);

    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    await new Promise((r) => setTimeout(r, 50));

    const events = db
      .prepare('SELECT type FROM execution_events WHERE execution_id = ? AND type = ?')
      .all(result.execution_id, 'awaiting_input') as Record<string, unknown>[];
    assert.ok(
      events.length >= 1,
      `expected at least one awaiting_input event, got ${String(events.length)}`,
    );
    db.close();
  });
});
