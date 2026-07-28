import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import { _testSetState, handleHealth, handleCompatibility } from '../src/mcp/server.js';
import { ExecutionService } from '../src/execution/service.js';
import { FakeClaudeCodeAdapter } from '../src/claude/adapter.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';

const TEST_DB_DIR = '/tmp/hco-test-health';

function freshDb(): Database.Database {
  try {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  } catch {
    /* Windows */
  }
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

describe('MCP health and compatibility', () => {
  let db: Database.Database;
  let executionService: ExecutionService;

  before(() => {
    db = freshDb();
    const adapter = new FakeClaudeCodeAdapter();
    executionService = new ExecutionService(db, adapter);
    _testSetState({ db, launcher: undefined, executionService });
  });

  after(() => {
    db?.close();
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('hco_health returns operational status with all fields', () => {
    const result = handleHealth();
    const data = result.data as Record<string, unknown>;
    assert.equal(data.status, 'operational');
    assert.ok(typeof data.uptime === 'number');
    const dbObj = data.db as Record<string, unknown>;
    assert.ok(typeof dbObj.size_bytes === 'number');
    assert.ok(typeof dbObj.schema_version === 'number');
    assert.ok(typeof dbObj.migration_count === 'number');
    const execs = data.executions as Record<string, unknown>;
    assert.ok(typeof execs.total === 'number');
    assert.ok(typeof execs.accepted === 'number');
    assert.ok(typeof execs.queued === 'number');
    assert.ok(typeof execs.running === 'number');
    assert.ok(typeof execs.awaiting_input === 'number');
    assert.ok(typeof execs.terminal === 'number');
  });

  it('hco_health reflects execution counts correctly', () => {
    executionService.submit(validRequest(), validProfile(), validPolicy());
    executionService.submit(validRequest(), validProfile(), validPolicy());

    const result = handleHealth();
    const execs = (result.data as Record<string, unknown>).executions as Record<string, unknown>;
    assert.equal(execs.accepted, 2);
    assert.equal(execs.total, 2);
  });

  it('hco_compatibility returns structured readiness assessment', () => {
    const result = handleCompatibility();
    const data = result.data as Record<string, unknown>;
    assert.ok(typeof data.legacy_jobs_pending === 'number');
    assert.ok(typeof data.legacy_sessions_active === 'number');
    assert.ok(typeof data.can_migrate === 'boolean');
    assert.ok(Array.isArray(data.warnings));
    assert.ok(['migrate', 'wait', 'clean'].includes(data.recommended_action as string));
  });

  it('hco_compatibility reports can_migrate=false when legacy jobs are pending', () => {
    // Insert a legacy job in non-terminal state
    db.prepare(
      `INSERT INTO jobs (external_id, kind, status, input, created_at, updated_at)
       VALUES ('job-legacy', 'generic', 'pending', '{}', datetime('now'), datetime('now'))`,
    ).run();

    const result = handleCompatibility();
    const data = result.data as Record<string, unknown>;
    assert.equal(data.can_migrate, false);
    assert.ok((data.warnings as string[]).some((w) => w.includes('legacy jobs')));
    assert.equal(data.recommended_action, 'wait');
  });

  it('hco_compatibility reports can_migrate=true when no legacy jobs are pending', () => {
    // Remove the legacy job
    db.prepare('DELETE FROM jobs').run();

    const result = handleCompatibility();
    const data = result.data as Record<string, unknown>;
    assert.equal(data.can_migrate, true);
    assert.equal(data.recommended_action, 'migrate');
  });
});
