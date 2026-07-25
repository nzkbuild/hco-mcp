import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { openDb, runMigrations } from '../src/state/db.js';

const TEST_DB_DIR = '/tmp/hco-test-jobs-service';

describe('Job service', () => {
  let db: Database.Database;

  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    db = openDb(TEST_DB_DIR);
  });

  after(() => {
    db?.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('createJob inserts a new job and returns it', async () => {
    const { createJob, getJob } = await import('../src/jobs/service.js');

    const job = createJob(db, {
      externalId: 'test-job-1',
      kind: 'build',
      input: { repo: 'alice/demo' },
    });

    assert.equal(job.externalId, 'test-job-1');
    assert.equal(job.kind, 'build');
    assert.equal(job.status, 'pending');
    assert.deepEqual(job.input, { repo: 'alice/demo' });
    assert.ok(job.id > 0);

    const fetched = getJob(db, 'test-job-1');
    assert.ok(fetched);
    assert.equal(fetched.id, job.id);
  });

  it('createJob defaults kind to "generic" and input to {}', async () => {
    const { createJob } = await import('../src/jobs/service.js');

    const job = createJob(db, { externalId: 'test-defaults' });

    assert.equal(job.kind, 'generic');
    assert.deepEqual(job.input, {});
    assert.equal(job.status, 'pending');
  });

  it('createJob is idempotent for same external_id, kind, and input', async () => {
    const { createJob } = await import('../src/jobs/service.js');

    const input = {
      externalId: 'test-idempotent',
      kind: 'test',
      input: { x: 1 },
    };

    const first = createJob(db, input);
    const second = createJob(db, input);

    assert.equal(first.id, second.id);
    assert.equal(second.externalId, 'test-idempotent');
    assert.equal(second.kind, 'test');
    assert.deepEqual(second.input, { x: 1 });
  });

  it('createJob is idempotent under concurrent Promise.all', async () => {
    const { createJob } = await import('../src/jobs/service.js');

    const input = {
      externalId: 'test-concurrent',
      kind: 'ci',
      input: { run: 42 },
    };

    // Open a second connection to the same WAL-mode DB so concurrent calls
    // exercise the INSERT OR IGNORE path on separate connections.
    const db2 = openDb(TEST_DB_DIR);

    const results = await Promise.all([
      new Promise((resolve) => {
        setImmediate(() => {
          resolve(createJob(db, input));
        });
      }),
      new Promise((resolve) => {
        setImmediate(() => {
          resolve(createJob(db2, input));
        });
      }),
      new Promise((resolve) => {
        setImmediate(() => {
          resolve(createJob(db, input));
        });
      }),
    ]);

    db2.close();

    assert.equal(results[0].id, results[1].id);
    assert.equal(results[1].id, results[2].id);

    for (const r of results) {
      assert.equal(r.externalId, 'test-concurrent');
      assert.equal(r.kind, 'ci');
      assert.deepEqual(r.input, { run: 42 });
    }
  });

  it('createJob throws ConflictingJobError when same external_id has different kind', async () => {
    const { createJob, ConflictingJobError } = await import('../src/jobs/service.js');

    createJob(db, {
      externalId: 'test-conflict-kind',
      kind: 'build',
      input: {},
    });

    assert.throws(
      () =>
        createJob(db, {
          externalId: 'test-conflict-kind',
          kind: 'deploy',
          input: {},
        }),
      (err: Error) => {
        assert.equal(err.name, 'ConflictingJobError');
        assert.ok(err.message.includes('test-conflict-kind'));
        return true;
      },
    );
  });

  it('createJob throws ConflictingJobError when same external_id has different input', async () => {
    const { createJob, ConflictingJobError } = await import('../src/jobs/service.js');

    createJob(db, {
      externalId: 'test-conflict-input',
      kind: 'build',
      input: { repo: 'alice/demo' },
    });

    assert.throws(
      () =>
        createJob(db, {
          externalId: 'test-conflict-input',
          kind: 'build',
          input: { repo: 'bob/other' },
        }),
      (err: Error) => {
        assert.equal(err.name, 'ConflictingJobError');
        assert.ok(err.message.includes('test-conflict-input'));
        return true;
      },
    );
  });

  it('ConflictingJobError exposes the existing job', async () => {
    const { createJob, ConflictingJobError } = await import('../src/jobs/service.js');

    const first = createJob(db, {
      externalId: 'test-conflict-ref',
      kind: 'scan',
      input: { tool: 'eslint' },
    });

    try {
      createJob(db, {
        externalId: 'test-conflict-ref',
        kind: 'scan',
        input: { tool: 'prettier' },
      });
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof ConflictingJobError);
      if (err instanceof ConflictingJobError) {
        assert.equal(err.existingJob.id, first.id);
        assert.equal(err.existingJob.externalId, 'test-conflict-ref');
      }
    }
  });

  it('getJob returns null for unknown external_id', async () => {
    const { getJob } = await import('../src/jobs/service.js');

    const result = getJob(db, 'does-not-exist');
    assert.equal(result, null);
  });

  it('createJob validates external_id is non-empty', async () => {
    const { createJob } = await import('../src/jobs/service.js');

    assert.throws(() => createJob(db, { externalId: '' }), /external_id must not be empty/);
  });

  it('createJob validates external_id max length', async () => {
    const { createJob } = await import('../src/jobs/service.js');

    const long = 'a'.repeat(257);
    assert.throws(() => createJob(db, { externalId: long }), /external_id must not exceed 256/);
  });

  it('createJob validates kind max length', async () => {
    const { createJob } = await import('../src/jobs/service.js');

    const long = 'b'.repeat(257);
    assert.throws(
      () => createJob(db, { externalId: 'test-kind-length', kind: long }),
      /kind must not exceed 256/,
    );
  });

  it('createJob stores milestone_id when provided', async () => {
    const { createJob } = await import('../src/jobs/service.js');

    db.prepare(
      "INSERT INTO milestones (name, created_at, updated_at) VALUES ('m1', datetime('now'), datetime('now'))",
    ).run();
    const milestone = db.prepare('SELECT id FROM milestones WHERE name = ?').get('m1') as {
      id: number;
    };

    const job = createJob(db, {
      externalId: 'test-milestone',
      milestoneId: milestone.id,
    });

    assert.equal(job.milestoneId, milestone.id);
  });

  it('createJob milestone_id defaults to null', async () => {
    const { createJob } = await import('../src/jobs/service.js');

    const job = createJob(db, { externalId: 'test-no-milestone' });
    assert.equal(job.milestoneId, null);
  });

  it('createJob rejects non-object input', async () => {
    const { createJob, ValidationError } = await import('../src/jobs/service.js');

    assert.throws(
      () =>
        createJob(db, {
          externalId: 'test-input-str',
          input: 'string' as unknown as Record<string, unknown>,
        }),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('must be a plain object'),
    );
  });

  it('createJob rejects null input', async () => {
    const { createJob, ValidationError } = await import('../src/jobs/service.js');

    assert.throws(
      () =>
        createJob(db, {
          externalId: 'test-input-null',
          input: null as unknown as Record<string, unknown>,
        }),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('must be a plain object'),
    );
  });

  it('createJob rejects array input', async () => {
    const { createJob, ValidationError } = await import('../src/jobs/service.js');

    assert.throws(
      () =>
        createJob(db, {
          externalId: 'test-input-arr',
          input: [1, 2, 3] as unknown as Record<string, unknown>,
        }),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('must be a plain object'),
    );
  });

  it('createJob rejects input with prototype pollution', async () => {
    const { createJob, ValidationError } = await import('../src/jobs/service.js');

    // Create an object with a non-Object prototype
    class Custom extends Object {}
    const custom = new Custom();
    Object.assign(custom, { x: 1 });

    assert.throws(
      () =>
        createJob(db, {
          externalId: 'test-input-proto',
          input: custom as unknown as Record<string, unknown>,
        }),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('must be a plain object'),
    );
  });

  it('createJob rejects input with circular reference', async () => {
    const { createJob, ValidationError } = await import('../src/jobs/service.js');

    const circ: Record<string, unknown> = { a: 1 };
    circ.self = circ;

    assert.throws(
      () => createJob(db, { externalId: 'test-input-circ', input: circ }),
      (err: Error) => err instanceof ValidationError && err.message.includes('JSON-serializable'),
    );
  });

  it('createJob rejects input with functions', async () => {
    const { createJob, ValidationError } = await import('../src/jobs/service.js');

    assert.throws(
      () =>
        createJob(db, {
          externalId: 'test-input-fn',
          input: {
            fn(): void {
              /* noop */
            },
          },
        }),
      (err: Error) => err instanceof ValidationError && err.message.includes('JSON-serializable'),
    );
  });

  it('createJob rejects oversized serialized input', async () => {
    const { createJob, ValidationError } = await import('../src/jobs/service.js');

    const huge = { data: 'x'.repeat(70000) };

    assert.throws(
      () => createJob(db, { externalId: 'test-input-huge', input: huge }),
      (err: Error) => err instanceof ValidationError && err.message.includes('65536'),
    );
  });

  it('createJob accepts input at 65536 serialized chars', async () => {
    const { createJob, ValidationError } = await import('../src/jobs/service.js');

    // Build a payload that serializes to exactly 65536 chars
    const padding = 'x'.repeat(65536 - '{"a":"'.length - '"}'.length);
    const input = { a: padding };

    const job = createJob(db, { externalId: 'test-input-boundary', input });
    assert.equal(typeof job.input, 'object');
    assert.equal(job.externalId, 'test-input-boundary');
  });

  it('createJob rejects non-string externalId', async () => {
    const { createJob, ValidationError } = await import('../src/jobs/service.js');

    assert.throws(
      () => createJob(db, { externalId: 42 as unknown as string }),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('external_id must be a string'),
    );
  });

  it('createJob rejects non-string kind', async () => {
    const { createJob, ValidationError } = await import('../src/jobs/service.js');

    assert.throws(
      () => createJob(db, { externalId: 'test-kind-nonstr', kind: 99 as unknown as string }),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('kind must be a string'),
    );
  });

  // ─── renewJobLease ──────────────────────────────────────────────────────────

  it('renewJobLease returns the job row when owner renews', async () => {
    const { createJob, claimJob, renewJobLease } = await import('../src/jobs/service.js');

    createJob(db, { externalId: 'test-renew-owner' });
    const claimed = claimJob(db, 'worker-a', 60_000);
    assert.ok(claimed);

    const renewed = renewJobLease(db, claimed.id, 'worker-a', 120_000);
    assert.ok(renewed);
    assert.equal(renewed.id, claimed.id);
    assert.equal(renewed.workerId, 'worker-a');
  });

  it('renewJobLease returns null for wrong worker', async () => {
    const { createJob, claimJob, renewJobLease } = await import('../src/jobs/service.js');

    createJob(db, { externalId: 'test-renew-wrong-worker' });
    const claimed = claimJob(db, 'worker-a', 60_000);
    assert.ok(claimed);

    const result = renewJobLease(db, claimed.id, 'worker-b', 60_000);
    assert.equal(result, null);
  });

  it('renewJobLease returns null for unknown jobId', async () => {
    const { renewJobLease } = await import('../src/jobs/service.js');

    const result = renewJobLease(db, 99999, 'worker-a', 60_000);
    assert.equal(result, null);
  });

  it('renewJobLease throws on invalid jobId', async () => {
    const { renewJobLease, ValidationError } = await import('../src/jobs/service.js');

    assert.throws(
      () => renewJobLease(db, 0, 'worker-a', 60_000),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('jobId must be a positive integer'),
    );
    assert.throws(
      () => renewJobLease(db, -1, 'worker-a', 60_000),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('jobId must be a positive integer'),
    );
    assert.throws(
      () => renewJobLease(db, 1.5, 'worker-a', 60_000),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('jobId must be a positive integer'),
    );
    assert.throws(
      () => renewJobLease(db, NaN, 'worker-a', 60_000),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('jobId must be a positive integer'),
    );
  });

  it('renewJobLease throws on invalid workerId', async () => {
    const { renewJobLease, ValidationError } = await import('../src/jobs/service.js');

    assert.throws(
      () => renewJobLease(db, 1, '', 60_000),
      (err: Error) =>
        err instanceof ValidationError &&
        err.message.includes('workerId must be 1..256 characters'),
    );
    assert.throws(
      () => renewJobLease(db, 1, 'a'.repeat(257), 60_000),
      (err: Error) =>
        err instanceof ValidationError &&
        err.message.includes('workerId must be 1..256 characters'),
    );
  });

  it('releaseExpiredJobs resets running jobs with expired leases to pending', async () => {
    const { createJob, claimJob, releaseExpiredJobs, getJob } =
      await import('../src/jobs/service.js');

    createJob(db, { externalId: 'test-release-expired' });
    createJob(db, { externalId: 'test-release-keep' });

    // Claim both with a lease that has already expired (-1 ms)
    const claim = (id: string) => {
      const row = db.prepare('SELECT id FROM jobs WHERE external_id = ?').get(id) as { id: number };
      db.prepare(
        "UPDATE jobs SET status = 'running', worker_id = 'w1', lease_until = datetime('now', '-1 second'), updated_at = datetime('now') WHERE id = ?",
      ).run(row.id);
    };
    claim('test-release-expired');
    claim('test-release-keep');

    const count = releaseExpiredJobs(db);
    assert.equal(count, 2);

    const job1 = getJob(db, 'test-release-expired');
    assert.ok(job1);
    assert.equal(job1.status, 'pending');
    assert.equal(job1.workerId, null);
    assert.equal(job1.leaseUntil, null);

    const job2 = getJob(db, 'test-release-keep');
    assert.ok(job2);
    assert.equal(job2.status, 'pending');
  });

  it('releaseExpiredJobs returns 0 when no leases are expired', async () => {
    const { createJob, claimJob, releaseExpiredJobs } = await import('../src/jobs/service.js');

    createJob(db, { externalId: 'test-no-expired' });
    const claimed = claimJob(db, 'w1', 3600_000);
    assert.ok(claimed);

    const count = releaseExpiredJobs(db);
    assert.equal(count, 0);
  });

  it('renewJobLease throws on invalid leaseMs', async () => {
    const { renewJobLease, ValidationError } = await import('../src/jobs/service.js');

    assert.throws(
      () => renewJobLease(db, 1, 'worker-a', 0),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('leaseMs must be 1..3600000'),
    );
    assert.throws(
      () => renewJobLease(db, 1, 'worker-a', 3_600_001),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('leaseMs must be 1..3600000'),
    );
    assert.throws(
      () => renewJobLease(db, 1, 'worker-a', 1.5),
      (err: Error) =>
        err instanceof ValidationError && err.message.includes('leaseMs must be a finite integer'),
    );
  });
});
