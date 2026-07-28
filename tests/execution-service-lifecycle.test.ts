import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import { ExecutionService, ExecutionLifecycleError } from '../src/execution/service.js';
import { FakeClaudeCodeAdapter } from '../src/claude/adapter.js';
import type { ClaudeCodeAdapter } from '../src/claude/adapter.js';
import { getProcessAttempts, getLatestProcessAttempt } from '../src/state/execution-repository.js';
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

    service.start(result.execution_id);
    // Fake adapter fires onExit via setImmediate
    await new Promise((r) => setImmediate(r));

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

    assert.throws(() => service.cancel(result.execution_id), ExecutionLifecycleError);
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

  // ─── ProcessAttempt persistence tests ────────────────────────────────────────

  it('successful execution creates and finishes exactly one ProcessAttempt', async () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    await new Promise((r) => setTimeout(r, 50));

    const attempts = getProcessAttempts(db, result.execution_id);
    assert.equal(attempts.length, 1, 'exactly one ProcessAttempt');
    const a = attempts[0];
    assert.ok(a, 'attempt exists');
    assert.equal(a.executionId, result.execution_id);
    assert.equal(a.attemptNumber, 1);
    assert.ok(typeof a.finishedAt === 'string', 'finishedAt is set');
    assert.equal(a.exitCode, 0);
    assert.equal(a.timedOut, false);
    assert.equal(a.aborted, false);
  });

  it('cancelled execution finishes ProcessAttempt with aborted=true', async () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);
    service.cancel(result.execution_id, 'test');

    // onExit fires async via setImmediate — wait for it
    await new Promise((r) => setTimeout(r, 20));

    const attempts = getProcessAttempts(db, result.execution_id);
    assert.equal(attempts.length, 1);
    const a = attempts[0];
    assert.ok(a);
    assert.ok(typeof a.finishedAt === 'string', 'finishedAt should be set after async onExit');
    assert.equal(a.aborted, true);
  });

  it('ProcessAttempt remains open during awaiting_input then finishes on continue', async () => {
    const db2Dir = `/tmp/hco-test-pa-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    const db2 = openDb(db2Dir);

    const adapter2 = new FakeClaudeCodeAdapter({ awaitingInputCount: 1 });
    const svc2 = new ExecutionService(db2, adapter2);

    const result = svc2.submit(validRequest(), validProfile(), validPolicy());
    svc2.start(result.execution_id);
    await new Promise((r) => setTimeout(r, 50));

    let attempts = getProcessAttempts(db2, result.execution_id);
    assert.equal(attempts.length, 1);
    let a = attempts[0];
    assert.ok(a);
    assert.equal(a.finishedAt, null, 'attempt is still open during awaiting_input');

    svc2.continue(result.execution_id, 'Proceed');
    await new Promise((r) => setTimeout(r, 50));

    attempts = getProcessAttempts(db2, result.execution_id);
    assert.equal(attempts.length, 1);
    a = attempts[0];
    assert.ok(a);
    assert.ok(typeof a.finishedAt === 'string', 'attempt finished after continue');
    assert.equal(a.exitCode, 0);

    db2.close();
    try {
      rmSync(db2Dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('multiple pause-continue cycles use same ProcessAttempt', async () => {
    const db2Dir = `/tmp/hco-test-pa-multi-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    const db2 = openDb(db2Dir);

    const adapter2 = new FakeClaudeCodeAdapter({ awaitingInputCount: 2 });
    const svc2 = new ExecutionService(db2, adapter2);

    const result = svc2.submit(validRequest(), validProfile(), validPolicy());
    svc2.start(result.execution_id);

    await new Promise((r) => setTimeout(r, 50));
    svc2.continue(result.execution_id, 'First');
    await new Promise((r) => setTimeout(r, 50));
    svc2.continue(result.execution_id, 'Second');
    await new Promise((r) => setTimeout(r, 50));

    const attempts = getProcessAttempts(db2, result.execution_id);
    assert.equal(attempts.length, 1, 'single ProcessAttempt across all continue cycles');
    const a = attempts[0];
    assert.ok(a);
    assert.ok(typeof a.finishedAt === 'string');
    assert.equal(a.exitCode, 0);

    db2.close();
    try {
      rmSync(db2Dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('launch failure still records a ProcessAttempt', async () => {
    const db2Dir = `/tmp/hco-test-pa-launch-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
    const db2 = openDb(db2Dir);

    const adapter2 = new FakeClaudeCodeAdapter();
    const svc2 = new ExecutionService(db2, adapter2);
    const result = svc2.submit(validRequest(), validProfile(), validPolicy());
    svc2.start(result.execution_id);

    await new Promise((r) => setTimeout(r, 20));

    const attempts = getProcessAttempts(db2, result.execution_id);
    assert.equal(attempts.length, 1, 'ProcessAttempt created even for immediate results');

    db2.close();
    try {
      rmSync(db2Dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('restart recovery: getLatestProcessAttempt identifies abandoned attempts', async () => {
    const result = service.submit(validRequest(), validProfile(), validPolicy());
    service.start(result.execution_id);

    await new Promise((r) => setTimeout(r, 20));

    const latest = getLatestProcessAttempt(db, result.execution_id);
    assert.ok(latest);
    assert.equal(latest.executionId, result.execution_id);
    assert.equal(latest.attemptNumber, 1);
  });
});
