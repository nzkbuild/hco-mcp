import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import { createExecution } from '../src/state/execution-repository.js';
import type { ExecutionRow } from '../src/state/execution-repository.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';
import {
  FakeClaudeCodeAdapter,
  type ClaudeCodeAdapter,
  type ProcessAttempt,
} from '../src/claude/adapter.js';

const TEST_DB_DIR = '/tmp/hco-test-adapter';

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

function persistedExecution(db: Database.Database): ExecutionRow {
  return createExecution(db, validRequest(), validProfile(), validPolicy());
}

describe('ClaudeCodeAdapter (fake)', () => {
  let db: Database.Database;
  let adapter: ClaudeCodeAdapter;

  before(() => {
    db = freshDb();
    adapter = new FakeClaudeCodeAdapter();
  });

  after(() => {
    db?.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('launch returns ProcessAttempt with correct executionId', () => {
    const exec = persistedExecution(db);
    const attempt = adapter.launch(exec, validProfile(), () => {
      /* noop */
    });
    assert.equal(attempt.executionId, exec.executionId);
    assert.equal(attempt.attemptNumber, 1);
    assert.ok(typeof attempt.id === 'string');
    assert.ok(typeof attempt.pid === 'number');
    assert.ok(typeof attempt.startedAt === 'string');
    assert.equal(attempt.finishedAt, null);
    assert.equal(attempt.exitCode, null);
    assert.equal(attempt.timedOut, false);
    assert.equal(attempt.aborted, false);
  });

  it('launch fires onExit callback with completed ProcessAttempt', async () => {
    const exec = persistedExecution(db);

    const result = await new Promise<ProcessAttempt>((resolve) => {
      adapter.launch(exec, validProfile(), (attempt) => {
        resolve(attempt);
      });
    });

    assert.equal(result.executionId, exec.executionId);
    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, 'completed');
    assert.ok(typeof result.finishedAt === 'string');
    assert.equal(result.aborted, false);
    assert.equal(result.timedOut, false);
  });

  it('attach returns running ProcessAttempt for known execution', async () => {
    const exec = persistedExecution(db);

    const attempt = adapter.launch(exec, validProfile(), () => {
      /* noop */
    });
    const attached = adapter.attach(exec.executionId);

    assert.ok(attached);
    assert.equal(attached.id, attempt.id);
    assert.equal(attached.executionId, exec.executionId);
  });

  it('attach returns null for unknown execution', () => {
    assert.equal(adapter.attach('nonexistent'), null);
  });

  it('attach returns null after process exits', async () => {
    const exec = persistedExecution(db);

    await new Promise<ProcessAttempt>((resolve) => {
      adapter.launch(exec, validProfile(), (attempt) => {
        resolve(attempt);
      });
    });

    // After onExit fires, the process should no longer be attached
    const attached = adapter.attach(exec.executionId);
    assert.equal(attached, null);
  });

  it('abort marks ProcessAttempt as aborted=true', () => {
    const exec = persistedExecution(db);

    const attempt = adapter.launch(exec, validProfile(), () => {
      /* noop */
    });
    assert.equal(attempt.aborted, false);

    adapter.abort(exec.executionId);

    // Sync check — the process.kill() mock sets aborted=true synchronously
    assert.equal(attempt.aborted, true);
  });

  it('abort removes process from attach tracking', () => {
    const exec = persistedExecution(db);

    adapter.launch(exec, validProfile(), () => {
      /* noop */
    });
    adapter.abort(exec.executionId);

    assert.equal(adapter.attach(exec.executionId), null);
  });

  it('onExit after abort has exit_code=-1 and aborted=true', async () => {
    const exec = persistedExecution(db);

    const result = await new Promise<ProcessAttempt>((resolve) => {
      adapter.launch(exec, validProfile(), (attempt) => {
        resolve(attempt);
      });
      adapter.abort(exec.executionId);
    });

    assert.equal(result.aborted, true);
    assert.equal(result.exitCode, -1);
  });

  it('multiple launches for same execution increment attemptNumber', () => {
    const exec = persistedExecution(db);

    const attempt1 = adapter.launch(exec, validProfile(), () => {
      /* noop */
    });
    assert.equal(attempt1.attemptNumber, 1);

    adapter.abort(exec.executionId);

    // Wait for onExit to clear the attempt
    // Then relaunch
    const attempt2 = adapter.launch(exec, validProfile(), () => {
      /* noop */
    });
    assert.equal(attempt2.attemptNumber, 2);
  });
});
