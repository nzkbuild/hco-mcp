import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';
import { migrateV1toV2 } from '../src/migrate/migrate-v1-to-v2.js';

const TEST_DB_DIR = '/tmp/hco-test-migrate';

interface SeedRow {
  externalId: string;
  status: string;
  input: string;
}

function seedTestDb(rows: SeedRow[]): void {
  try {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  } catch {
    /* Windows */
  }
  const db = openDb(TEST_DB_DIR);
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19);
  for (const row of rows) {
    db.prepare(
      `INSERT INTO jobs (external_id, kind, status, input, created_at, updated_at)
       VALUES (?, 'generic', ?, ?, ?, ?)`,
    ).run(row.externalId, row.status, row.input, t, t);
  }
  db.close();
}

function validInput(overrides?: Record<string, string>): string {
  return JSON.stringify({
    owner: overrides?.owner ?? 'a',
    repo: overrides?.repo ?? 'b',
    path: overrides?.path ?? '/x',
    prompt: overrides?.prompt ?? 'test',
  });
}

describe('Migration v1 to v2', () => {
  afterEach(() => {
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('dry-run reports counts without writing', () => {
    seedTestDb([{ externalId: 'dry-1', status: 'pending', input: validInput() }]);

    const result = migrateV1toV2({ dataDir: TEST_DB_DIR, dryRun: true });

    assert.equal(result.jobsScanned, 1);
    assert.equal(result.executionsCreated, 1);
    assert.equal(result.attemptsCreated, 0);
    assert.equal(result.errors.length, 0);
  });

  it('migration creates valid executions from legacy jobs', () => {
    seedTestDb([{ externalId: 'real-1', status: 'pending', input: validInput() }]);

    const result = migrateV1toV2({ dataDir: TEST_DB_DIR, dryRun: false });

    assert.equal(result.executionsCreated, 1);
    assert.equal(result.errors.length, 0);
  });

  it('second run with no pending jobs creates nothing', () => {
    seedTestDb([]);

    const result = migrateV1toV2({ dataDir: TEST_DB_DIR, dryRun: false });
    assert.equal(result.executionsCreated, 0);
    assert.equal(result.jobsScanned, 0);
  });

  it('invalid legacy input is reported as error, not crash', () => {
    seedTestDb([{ externalId: 'bad-1', status: 'pending', input: 'not valid json' }]);

    const result = migrateV1toV2({ dataDir: TEST_DB_DIR, dryRun: false });
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes('Failed to parse job'));
  });

  it('migrates jobs with paused status too', () => {
    seedTestDb([{ externalId: 'paused-1', status: 'paused', input: validInput() }]);

    const result = migrateV1toV2({ dataDir: TEST_DB_DIR, dryRun: false });

    assert.equal(result.errors.length, 0);
    assert.equal(result.executionsCreated, 1);
  });
});
