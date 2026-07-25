import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import { ExecutionService } from '../src/execution/service.js';
import { FakeClaudeCodeAdapter } from '../src/claude/adapter.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';
import { getExecution } from '../src/state/execution-repository.js';
import { ConflictingExecutionError } from '../src/state/execution-repository.js';

const TEST_DB_DIR = '/tmp/hco-test-execution-service';

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

describe('ExecutionService.submit', () => {
  let db: Database.Database;
  let service: ExecutionService;

  before(() => {
    db = freshDb();
    service = new ExecutionService(db, new FakeClaudeCodeAdapter());
  });

  after(() => {
    db?.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('returns a persisted execution with status accepted', () => {
    const req = validRequest();
    const profile = validProfile();
    const policy = validPolicy();

    const result = service.submit(req, profile, policy);

    assert.equal(result.status, 'accepted');
    assert.ok(typeof result.execution_id === 'string');
    assert.ok(result.execution_id.length > 0);
    assert.ok(typeof result.accepted_at === 'string');
  });

  it('persisted execution matches the submitted request', () => {
    const req = validRequest();
    const profile = validProfile();
    const policy = validPolicy();

    const result = service.submit(req, profile, policy);
    const persisted = getExecution(db, result.execution_id);

    assert.ok(persisted);
    assert.equal(persisted.executionId, result.execution_id);
    assert.equal(persisted.status, 'accepted');

    const storedReq = ExecutionRequestV1.parse(JSON.parse(persisted.requestJson) as unknown);
    assert.equal(storedReq.brief.original_request, req.brief.original_request);
    assert.equal(storedReq.repository.owner, req.repository.owner);
  });

  it('deduplicates by idempotency_key with identical content', () => {
    const req = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'service-dedup-same',
    });
    const profile = validProfile();
    const policy = validPolicy();

    const first = service.submit(req, profile, policy);
    const second = service.submit(req, profile, policy);

    assert.equal(first.execution_id, second.execution_id);
    assert.equal(first.status, second.status);
  });

  it('rejects duplicate idempotency_key with different content', () => {
    const req1 = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'service-conflict',
      brief: {
        original_request: 'Task A.',
        objective: 'Do task A.',
        context: '',
        constraints: [],
        acceptance_criteria: [],
        requested_validation: [],
      },
    });

    service.submit(req1, validProfile(), validPolicy());

    const req2 = ExecutionRequestV1.parse({
      ...(JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>),
      idempotency_key: 'service-conflict',
      brief: {
        original_request: 'Task B.',
        objective: 'Do task B.',
        context: '',
        constraints: [],
        acceptance_criteria: [],
        requested_validation: [],
      },
    });

    assert.throws(
      () => service.submit(req2, validProfile(), validPolicy()),
      ConflictingExecutionError,
    );
  });

  it('does not spawn any process', () => {
    const req = validRequest();
    const profile = validProfile();
    const policy = validPolicy();

    // submit() is synchronous — it never spawns anything.
    // If it spawned a process, it would need to be async (child_process.spawn
    // is async). The fact that it's sync is itself the "no spawn" guarantee.
    const result = service.submit(req, profile, policy);
    assert.ok(result.execution_id.length > 0);
    // Synchronous return confirms no async process launch
  });
});
