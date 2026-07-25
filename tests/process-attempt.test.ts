import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';
import {
  createExecution,
  createProcessAttempt,
  getProcessAttempts,
  getLatestProcessAttempt,
  finishProcessAttempt,
} from '../src/state/execution-repository.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';

const TEST_BASE = '/tmp/hco-test-attempts';
let dbCount = 0;
function freshDb() {
  const d = `${TEST_BASE}/${String(dbCount++)}`;
  rmSync(d, { recursive: true, force: true });
  return openDb(d);
}

function create(db: ReturnType<typeof openDb>) {
  return createExecution(
    db,
    ExecutionRequestV1.parse({
      brief: {
        original_request: 'Test.',
        objective: 'Test.',
        context: '',
        constraints: [],
        acceptance_criteria: [],
        requested_validation: [],
      },
      claude_config: {},
      repository: { owner: 'z', repo: 'z', path: '/tmp/z' },
      policy_ref: 'z',
    }),
    ExecutionProfileV1.parse({
      profile_id: 'p',
      claude_defaults: { binary_path: 'x', default_timeout_ms: 300000, session_dir: '/tmp/x' },
      repository_allowlist: [{ owner: 'z', repo: 'z' }],
    }),
    PolicySnapshotV1.parse({
      repository_boundary: { owner: 'z', repo: 'z', local_path: '/tmp/z' },
      permission_limits: { allowed_tools: ['Read'], deny_shell_access: true },
      timeout_ceiling_ms: 600000,
      max_concurrency: 1,
      approval_required: true,
    }),
  );
}

describe('ProcessAttempt', () => {
  after(() => {
    rmSync(TEST_BASE, { recursive: true, force: true });
  });

  it('createProcessAttempt persists and returns attempt', () => {
    const db = freshDb();
    const exec = create(db);
    const a = createProcessAttempt(db, 'pa-1', exec.executionId, 1, 12345);
    assert.equal(a.executionId, exec.executionId);
    assert.equal(a.attemptNumber, 1);
    assert.equal(a.pid, 12345);
    assert.ok(typeof a.startedAt === 'string');
    db.close();
  });

  it('getProcessAttempts returns all ordered by attempt_number', () => {
    const db = freshDb();
    const exec = create(db);
    createProcessAttempt(db, 'pa-a', exec.executionId, 1, 100);
    createProcessAttempt(db, 'pa-b', exec.executionId, 2, 200);
    const all = getProcessAttempts(db, exec.executionId);
    assert.equal(all.length, 2);
    assert.equal(all[0].attemptNumber, 1);
    assert.equal(all[1].attemptNumber, 2);
    db.close();
  });

  it('getLatestProcessAttempt returns most recent', () => {
    const db = freshDb();
    const exec = create(db);
    createProcessAttempt(db, 'pa-x', exec.executionId, 1, 100);
    createProcessAttempt(db, 'pa-y', exec.executionId, 2, 200);
    const latest = getLatestProcessAttempt(db, exec.executionId);
    assert.ok(latest);
    assert.equal(latest.attemptNumber, 2);
    db.close();
  });

  it('finishProcessAttempt updates exit_code, finished_at, timed_out, aborted', () => {
    const db = freshDb();
    const exec = create(db);
    createProcessAttempt(db, 'pa-f', exec.executionId, 1, 100);
    const finished = finishProcessAttempt(db, 'pa-f', 0, false, false);
    assert.ok(finished);
    assert.equal(finished.exitCode, 0);
    assert.ok(typeof finished.finishedAt === 'string');
    assert.equal(finished.timedOut, false);
    assert.equal(finished.aborted, false);
    db.close();
  });
});
