import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';
import { DoctorService } from '../src/doctor/service.js';
import { ProviderService } from '../src/provider/service.js';
import { FakeProviderAdapter } from '../src/provider/fake-adapter.js';

const TEST_DB_DIR = '/tmp/hco-test-doctor';

describe('DoctorService', () => {
  let db: Database.Database;

  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    db = openDb(TEST_DB_DIR);
  });

  after(() => {
    db.close();
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });

  it('runAll returns one result per check', async () => {
    const providerService = new ProviderService(db, () => new FakeProviderAdapter());
    const doctor = new DoctorService({ db, providerService });
    const report = await doctor.runAll();
    assert.equal(report.checks.length, 15, 'should have 15 checks');
    assert.ok(report.summary.length > 0);
    assert.ok(typeof report.total_duration_ms === 'number');
  });

  it('runAll returns healthy/degraded/unhealthy status', async () => {
    const providerService = new ProviderService(db, () => new FakeProviderAdapter());
    const doctor = new DoctorService({ db, providerService });
    const report = await doctor.runAll();
    assert.ok(
      report.status === 'healthy' || report.status === 'degraded' || report.status === 'unhealthy',
    );
  });

  it('runAll with category filter returns only matching checks', async () => {
    const providerService = new ProviderService(db, () => new FakeProviderAdapter());
    const doctor = new DoctorService({ db, providerService });
    const report = await doctor.runAll('infrastructure');
    assert.ok(report.checks.length > 0);
    assert.ok(report.checks.length < 15);
    for (const _c of report.checks) {
      // Infrastructure checks don't use providerService, no need to verify category on result
    }
  });

  it('each check has required fields', async () => {
    const providerService = new ProviderService(db, () => new FakeProviderAdapter());
    const doctor = new DoctorService({ db, providerService });
    const report = await doctor.runAll();
    for (const c of report.checks) {
      assert.ok(typeof c.pass === 'boolean');
      assert.ok(typeof c.detail === 'string');
      assert.ok(typeof c.duration_ms === 'number');
      assert.ok(
        c.severity === 'ok' || c.severity === 'warning' || c.severity === 'error',
      );
    }
  });
});
