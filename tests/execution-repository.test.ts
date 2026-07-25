import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import {
  createExecution,
  getExecution,
  listExecutions,
  getExecutionByIdempotencyKey,
  ConflictingExecutionError,
} from '../src/state/execution-repository.js';
import type { ExecutionRow } from '../src/state/execution-repository.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';

const TEST_DB_DIR = '/tmp/hco-test-execution-repo';

function freshDb(): Database.Database {
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
  return openDb(TEST_DB_DIR);
}

function validRequest() {
  return ExecutionRequestV1.parse({
    brief: {
      original_request: 'Make onboarding easier.',
      objective: 'Simplify the onboarding flow.',
      context: '',
      constraints: [],
      acceptance_criteria: [],
      requested_validation: [],
    },
    claude_config: {},
    repository: {
      owner: 'nzkbuild',
      repo: 'hco-mcp',
      path: '/home/hermes/repos/hco-mcp',
    },
    policy_ref: 'standard-policy',
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
    repository_boundary: {
      owner: 'nzkbuild',
      repo: 'hco-mcp',
      local_path: '/home/hermes/repos/hco-mcp',
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

describe('ExecutionRepository', () => {
  let db: Database.Database;

  before(() => {
    db = freshDb();
  });

  after(() => {
    db?.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('createExecution persists and returns execution with status accepted', () => {
    const req = validRequest();
    const profile = validProfile();
    const policy = validPolicy();

    const exec = createExecution(db, req, profile, policy);

    assert.equal(exec.status, 'accepted');
    assert.ok(typeof exec.executionId === 'string');
    assert.ok(exec.executionId.length > 0);
    assert.ok(typeof exec.idempotencyKey === 'string');
    assert.ok(exec.idempotencyKey.length > 0);
    assert.equal(exec.schemaVersion, 1);
    assert.ok(typeof exec.requestJson === 'string');
    assert.ok(typeof exec.profileSnapshotJson === 'string');
    assert.ok(typeof exec.policySnapshotJson === 'string');
    assert.ok(typeof exec.createdAt === 'string');
  });

  it('retrieved execution matches submitted ExecutionRequest structurally', () => {
    const req = validRequest();
    const profile = validProfile();
    const policy = validPolicy();

    const created = createExecution(db, req, profile, policy);
    const fetched = getExecution(db, created.executionId);

    assert.ok(fetched);
    assert.equal(fetched.executionId, created.executionId);
    assert.equal(fetched.idempotencyKey, created.idempotencyKey);
    assert.equal(fetched.status, 'accepted');

    // Verify the stored request JSON can be re-parsed to match the original
    const storedReq = ExecutionRequestV1.parse(JSON.parse(fetched.requestJson) as unknown);
    assert.equal(storedReq.brief.original_request, req.brief.original_request);
    assert.equal(storedReq.brief.objective, req.brief.objective);
    assert.equal(storedReq.repository.owner, req.repository.owner);
    assert.equal(storedReq.policy_ref, req.policy_ref);
  });

  it('PolicySnapshot stored at insertion time matches config state', () => {
    const req = validRequest();
    const profile = validProfile();
    const policy = validPolicy();

    const created = createExecution(db, req, profile, policy);
    const fetched = getExecution(db, created.executionId);

    assert.ok(fetched);
    const storedPolicy = PolicySnapshotV1.parse(JSON.parse(fetched.policySnapshotJson) as unknown);
    assert.equal(storedPolicy.repository_boundary.owner, policy.repository_boundary.owner);
    assert.equal(storedPolicy.timeout_ceiling_ms, policy.timeout_ceiling_ms);
  });

  it('idempotencyKey is auto-generated when absent', () => {
    const req = ExecutionRequestV1.parse({
      brief: {
        original_request: 'Test.',
        objective: 'Test objective.',
        context: '',
        constraints: [],
        acceptance_criteria: [],
        requested_validation: [],
      },
      claude_config: {},
      repository: {
        owner: 'nzkbuild',
        repo: 'hco-mcp',
        path: '/tmp/test',
      },
      policy_ref: 'test',
    });
    // idempotency_key is undefined on the parsed request (not provided)
    assert.equal(req.idempotency_key, undefined);

    const exec = createExecution(db, req, validProfile(), validPolicy());
    // createExecution should generate one
    assert.ok(exec.idempotencyKey.length > 0);
    // Must be UUID v4 format (36 chars with dashes)
    assert.ok(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        exec.idempotencyKey,
      ),
      `Expected UUID v4, got: ${exec.idempotencyKey}`,
    );
  });

  it('accepts caller-provided idempotencyKey', () => {
    const req = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'hermes-task-001',
    });
    assert.equal(req.idempotency_key, 'hermes-task-001');

    const exec = createExecution(db, req, validProfile(), validPolicy());
    assert.equal(exec.idempotencyKey, 'hermes-task-001');
  });

  it('duplicate idempotencyKey with identical content returns existing execution', () => {
    const req = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'hermes-dedup-same',
    });
    const profile = validProfile();
    const policy = validPolicy();

    const first = createExecution(db, req, profile, policy);
    const second = createExecution(db, req, profile, policy);

    assert.equal(first.id, second.id);
    assert.equal(first.executionId, second.executionId);
    assert.equal(first.status, second.status);
  });

  it('duplicate idempotencyKey with different content throws ConflictingExecutionError', () => {
    const req1 = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'hermes-conflict',
      brief: {
        original_request: 'Task A.',
        objective: 'Do task A.',
        context: '',
        constraints: [],
        acceptance_criteria: [],
        requested_validation: [],
      },
    });

    const first = createExecution(db, req1, validProfile(), validPolicy());
    assert.ok(first);

    const req2 = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'hermes-conflict',
      brief: {
        original_request: 'Task B — completely different.',
        objective: 'Do task B.',
        context: '',
        constraints: [],
        acceptance_criteria: [],
        requested_validation: [],
      },
    });

    assert.throws(
      () => createExecution(db, req2, validProfile(), validPolicy()),
      ConflictingExecutionError,
    );
  });

  it('ConflictingExecutionError exposes existing executionId', () => {
    const req = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'hermes-err-ref',
    });
    const first = createExecution(db, req, validProfile(), validPolicy());

    const req2 = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'hermes-err-ref',
      brief: {
        original_request: 'Different task.',
        objective: 'Different objective.',
        context: '',
        constraints: [],
        acceptance_criteria: [],
        requested_validation: [],
      },
    });

    try {
      createExecution(db, req2, validProfile(), validPolicy());
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof ConflictingExecutionError);
      if (err instanceof ConflictingExecutionError) {
        assert.equal(err.existingExecutionId, first.executionId);
      }
    }
  });

  it('getExecution returns null for unknown ID', () => {
    const result = getExecution(db, 'nonexistent-exec');
    assert.equal(result, null);
  });

  it('getExecutionByIdempotencyKey returns execution for known key', () => {
    const req = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'hermes-lookup',
    });
    const created = createExecution(db, req, validProfile(), validPolicy());

    const found = getExecutionByIdempotencyKey(db, 'hermes-lookup');
    assert.ok(found);
    assert.equal(found.executionId, created.executionId);
  });

  it('getExecutionByIdempotencyKey returns null for unknown key', () => {
    const result = getExecutionByIdempotencyKey(db, 'unknown-key');
    assert.equal(result, null);
  });

  it('listExecutions returns all executions when no filter', () => {
    const req1 = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'list-ik-1',
    });
    const req2 = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'list-ik-2',
    });

    createExecution(db, req1, validProfile(), validPolicy());
    createExecution(db, req2, validProfile(), validPolicy());

    const all = listExecutions(db);
    assert.ok(all.length >= 2);
  });

  it('listExecutions filters by status', () => {
    const req = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'list-status',
    });
    createExecution(db, req, validProfile(), validPolicy());

    const accepted = listExecutions(db, { status: 'accepted' });
    assert.ok(accepted.some((e) => e.idempotencyKey === 'list-status'));

    const completed = listExecutions(db, { status: 'completed' });
    assert.equal(completed.filter((e) => e.idempotencyKey === 'list-status').length, 0);
  });

  it('listExecutions respects limit', () => {
    for (let i = 0; i < 5; i++) {
      const req = ExecutionRequestV1.parse({
        ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
        idempotency_key: `list-limit-${String(i)}`,
      });
      createExecution(db, req, validProfile(), validPolicy());
    }

    const limited = listExecutions(db, { limit: 2 });
    assert.ok(limited.length <= 2);
  });

  it('profile snapshot is persisted and retrievable', () => {
    const req = validRequest();
    const profile = ExecutionProfileV1.parse({
      profile_id: 'custom-profile',
      claude_defaults: {
        binary_path: 'claude',
        default_model: 'claude-sonnet-5',
        default_thinking_effort: 'high',
        default_timeout_ms: 120_000,
        session_dir: '/tmp/sessions',
      },
      allowed_overrides: ['model'],
      repository_allowlist: [{ owner: 'nzkbuild', repo: 'hco-mcp' }],
    });
    const policy = validPolicy();

    const exec = createExecution(db, req, profile, policy);
    const fetched = getExecution(db, exec.executionId);
    assert.ok(fetched);

    const storedProfile = ExecutionProfileV1.parse(
      JSON.parse(fetched.profileSnapshotJson) as unknown,
    );
    assert.equal(storedProfile.profile_id, 'custom-profile');
    assert.equal(storedProfile.claude_defaults.default_model, 'claude-sonnet-5');
    assert.equal(storedProfile.claude_defaults.default_thinking_effort, 'high');
  });

  it('createExecution inserts execution event', () => {
    const req = validRequest();
    const profile = validProfile();
    const policy = validPolicy();

    const exec = createExecution(db, req, profile, policy);

    const events = db
      .prepare('SELECT * FROM execution_events WHERE execution_id = ? ORDER BY id')
      .all(exec.executionId) as Array<{
      type: string;
      payload: string;
    }>;
    assert.ok(events.length >= 1);
    const createdEvent = events.find((e) => e.type === 'created');
    assert.ok(createdEvent, 'must have a created event');
    const payload = JSON.parse(createdEvent.payload) as Record<string, unknown>;
    assert.equal(payload.execution_id, exec.executionId);
  });
});
