import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { openDb } from '../src/state/db.js';
import { createJob } from '../src/jobs/service.js';
import { JobWorker } from '../src/jobs/worker.js';

describe('JobWorker', () => {
  it('claims and handles queued job', async () => {
    const db = openDb(`/tmp/hco-worker-${String(Date.now())}.db`);
    createJob(db, { externalId: `worker-${String(Date.now())}`, kind: 'test' });
    let handled = false;
    const worker = new JobWorker(db, {
      workerId: 'w',
      leaseMs: 5000,
      intervalMs: 100,
      handle: async () => {
        handled = true;
      },
    });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    worker.stop();
    db.close();
    assert.equal(handled, true);
  });

  it('rejects invalid runtime options', () => {
    const db = openDb(`/tmp/hco-worker-invalid-${String(Date.now())}.db`);
    assert.throws(
      () =>
        new JobWorker(db, {
          workerId: 123 as unknown as string,
          leaseMs: 1,
          intervalMs: 100,
          handle: 1 as unknown as () => Promise<void>,
        }),
    );
    assert.throws(
      () =>
        new JobWorker(db, {
          workerId: 'w',
          leaseMs: 1,
          intervalMs: 100,
          handle: 1 as unknown as () => Promise<void>,
        }),
    );
    db.close();
  });
});
