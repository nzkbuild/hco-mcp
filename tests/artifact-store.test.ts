import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import { createExecution } from '../src/state/execution-repository.js';
import {
  ArtifactStorage,
  ArtifactLimitExceededError,
  ARTIFACT_LIMITS,
} from '../src/state/artifact-store.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';

const TEST_DIR = '/tmp/hco-test-artifacts';
let dbCount = 0;
function freshDb() {
  const d = `${TEST_DIR}/${String(dbCount++)}`;
  rmSync(d, { recursive: true, force: true });
  return openDb(d);
}

function create(db: Database.Database) {
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
      claude_defaults: {
        binary_path: 'x',
        default_timeout_ms: 300000,
        session_dir: '/tmp/x',
      },
      repository_allowlist: [{ owner: 'z', repo: 'z' }],
    }),
    PolicySnapshotV1.parse({
      repository_boundary: {
        owner: 'z',
        repo: 'z',
        local_path: '/tmp/z',
      },
      permission_limits: { allowed_tools: ['Read'], deny_shell_access: true },
      timeout_ceiling_ms: 600000,
      max_concurrency: 1,
      approval_required: true,
    }),
  );
}

describe('ArtifactStorage', () => {
  after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      /* Windows file locking */
    }
  });

  it('stores and retrieves a single-chunk artifact', () => {
    const db = freshDb();
    const exec = create(db);
    const store = new ArtifactStorage(db);

    const data = Buffer.from('hello world');
    store.store(exec.executionId, 'art-1', 'output.txt', data, 'text/plain');

    const retrieved = store.retrieve(exec.executionId, 'output.txt');
    assert.ok(retrieved);
    assert.equal(retrieved.toString(), 'hello world');
    db.close();
  });

  it('stores and retrieves a multi-chunk artifact', () => {
    const db = freshDb();
    const exec = create(db);
    const store = new ArtifactStorage(db);

    const data = Buffer.alloc(ARTIFACT_LIMITS.maxChunkBytes + 100, 'x');
    store.store(exec.executionId, 'art-2', 'large.bin', data, 'application/octet-stream');

    const retrieved = store.retrieve(exec.executionId, 'large.bin');
    assert.ok(retrieved);
    assert.equal(retrieved.length, data.length);
    assert.ok(retrieved.equals(data));
    db.close();
  });

  it('listArtifacts returns metadata for all keys', () => {
    const db = freshDb();
    const exec = create(db);
    const store = new ArtifactStorage(db);

    store.store(exec.executionId, 'art-a', 'a.txt', Buffer.from('a'), 'text/plain');
    store.store(exec.executionId, 'art-b', 'b.txt', Buffer.from('bb'), 'text/plain');

    const list = store.listArtifacts(exec.executionId);
    assert.equal(list.length, 2);
    assert.equal(list[0].key, 'a.txt');
    assert.equal(list[0].byte_length, 1);
    assert.equal(list[1].key, 'b.txt');
    assert.equal(list[1].byte_length, 2);
    db.close();
  });

  it('retrieve returns null for unknown key', () => {
    const db = freshDb();
    const exec = create(db);
    const store = new ArtifactStorage(db);

    assert.equal(store.retrieve(exec.executionId, 'nonexistent'), null);
    db.close();
  });

  it('getTotalBytes tracks cumulative size', () => {
    const db = freshDb();
    const exec = create(db);
    const store = new ArtifactStorage(db);

    store.store(exec.executionId, 'art-1', 'a.txt', Buffer.from('abc'), 'text/plain');
    assert.equal(store.getTotalBytes(exec.executionId), 3);

    store.store(exec.executionId, 'art-2', 'b.txt', Buffer.from('defg'), 'text/plain');
    assert.equal(store.getTotalBytes(exec.executionId), 7);
    db.close();
  });

  it('enforces individual artifact size limit', () => {
    const db = freshDb();
    const exec = create(db);
    const store = new ArtifactStorage(db);

    const huge = Buffer.alloc(ARTIFACT_LIMITS.maxIndividualBytes + 1, 'x');
    assert.throws(() => {
      store.store(exec.executionId, 'art-3', 'huge.bin', huge, 'application/octet-stream');
    }, ArtifactLimitExceededError);
    db.close();
  });

  it('enforces total per-execution size limit', () => {
    const db = freshDb();
    const exec = create(db);
    const store = new ArtifactStorage(db);

    // Store 20 artifacts of 5 MiB each = 100 MiB, right at the limit
    const fiveMiB = Buffer.alloc(5 * 1024 * 1024, 'x');
    for (let i = 0; i < 20; i++) {
      store.store(
        exec.executionId,
        `art-${String(i)}`,
        `chunk${String(i)}.bin`,
        fiveMiB,
        'application/octet-stream',
      );
    }

    // One more byte should exceed the total limit
    assert.throws(() => {
      store.store(exec.executionId, 'art-over', 'over.bin', Buffer.from('x'), 'text/plain');
    }, ArtifactLimitExceededError);
    db.close();
  });

  it('deleteArtifactsByExecution removes all chunks', () => {
    const db = freshDb();
    const exec = create(db);
    const store = new ArtifactStorage(db);

    const data = Buffer.alloc(ARTIFACT_LIMITS.maxChunkBytes + 50, 'z');
    store.store(exec.executionId, 'art-1', 'chunked.bin', data, 'application/octet-stream');
    store.store(exec.executionId, 'art-2', 'small.txt', Buffer.from('hi'), 'text/plain');

    const deleted = store.deleteArtifactsByExecution(exec.executionId);
    assert.ok(deleted >= 3, `expected at least 3 rows deleted, got ${String(deleted)}`);

    assert.equal(store.retrieve(exec.executionId, 'chunked.bin'), null);
    assert.equal(store.retrieve(exec.executionId, 'small.txt'), null);
    assert.equal(store.listArtifacts(exec.executionId).length, 0);
    db.close();
  });

  it('listArtifacts returns correct chunk count', () => {
    const db = freshDb();
    const exec = create(db);
    const store = new ArtifactStorage(db);

    const data = Buffer.alloc(ARTIFACT_LIMITS.maxChunkBytes * 2 + 50, 'y');
    store.store(exec.executionId, 'art-1', 'multi.bin', data, 'application/octet-stream');

    const list = store.listArtifacts(exec.executionId);
    assert.equal(list.length, 1);
    assert.equal(list[0].chunks, 3);
    assert.equal(list[0].byte_length, data.length);
    db.close();
  });

  it('FK constraint rejects artifact for unknown execution', () => {
    const db = freshDb();
    create(db);
    const store = new ArtifactStorage(db);

    assert.throws(() => {
      store.store('nonexistent-exec', 'art-1', 'x.txt', Buffer.from('x'), 'text/plain');
    }, /FOREIGN KEY/);
    db.close();
  });

  it('listArtifacts returns empty for unknown execution', () => {
    const db = freshDb();
    create(db);
    const store = new ArtifactStorage(db);

    assert.deepEqual(store.listArtifacts('unknown-exec'), []);
    db.close();
  });
});
