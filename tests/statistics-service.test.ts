import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';
import { StatisticsService } from '../src/statistics/service.js';

const TEST_DB_DIR = '/tmp/hco-test-stats';

function seedData(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT INTO executions (execution_id, idempotency_key, schema_version, status, request_json, profile_snapshot_json, policy_snapshot_json, created_at, updated_at)
     VALUES (?, ?, 1, ?, '{}', '{}', '{}', ?, datetime('now'))`,
  );
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  for (let i = 0; i < 6; i++) {
    const statuses = ['completed', 'completed', 'completed', 'failed', 'running', 'queued'];
    insert.run(`ex-${String(i)}-${now}`, `k-${String(i)}-${now}`, statuses[i], now);
  }
}

describe('StatisticsService', () => {
  let db: Database.Database;
  let service: StatisticsService;

  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    db = openDb(TEST_DB_DIR);
    service = new StatisticsService(db);
    seedData(db);
  });

  after(() => {
    db.close();
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });

  it('getOverview returns correct counts for seeded data', () => {
    const stats = service.getOverview();
    assert.equal(stats.total_executions, 6);
    assert.equal(stats.completed, 3);
    assert.equal(stats.failed, 1);
    assert.equal(stats.running, 1);
    assert.equal(stats.queued, 1);
    assert.equal(stats.success_rate, 0.75);
  });

  it('getQueueHealth reports queue depth', () => {
    const health = service.getQueueHealth();
    assert.equal(health.queued, 1);
    assert.equal(health.running, 1);
  });

  it('getTimeline returns execution counts by date', () => {
    const timeline = service.getTimeline();
    assert.ok(timeline.length >= 1);
    assert.ok(typeof timeline[0].date === 'string');
    assert.ok(typeof timeline[0].count === 'number');
  });

  it('empty DB returns zeroes', () => {
    const emptyDir = `/tmp/hco-test-stats-empty-${String(Date.now())}`;
    const db2 = openDb(emptyDir);
    try {
      const svc2 = new StatisticsService(db2);
      const stats = svc2.getOverview();
      assert.equal(stats.total_executions, 0);
      assert.equal(stats.completed, 0);
    } finally {
      db2.close();
      try {
        rmSync(emptyDir, { recursive: true, force: true });
      } catch {
        /* ok */
      }
    }
  });
});
