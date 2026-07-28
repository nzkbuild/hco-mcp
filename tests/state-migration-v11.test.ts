import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';

const TEST_DB_DIR = '/tmp/hco-test-migration-v11';

describe('Migration v11 — providers and model mappings', () => {
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

  it('applies migration v11 on top of v10', () => {
    const v = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number };
    assert.ok(v.v >= 11, 'migration v11 should be applied');
  });

  it('providers table exists with correct columns', () => {
    const cols = db.prepare("PRAGMA table_info('providers')").all() as Array<{
      name: string;
      type: string;
    }>;
    const names = cols.map((c) => c.name);
    assert.ok(names.includes('provider_id'));
    assert.ok(names.includes('profile_id'));
    assert.ok(names.includes('provider'));
    assert.ok(names.includes('api_key_env'));
    assert.ok(names.includes('status'));
    assert.ok(names.includes('created_at'));
  });

  it('providers table enforces status CHECK constraint', () => {
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO providers (provider_id, profile_id, provider, api_key_env, status)
           VALUES ('p1', 'prof-1', 'anthropic', 'KEY', 'unknown_status')`,
          )
          .run(),
      /CHECK constraint/,
    );
  });

  it('provider_events table is append-only', () => {
    db.prepare(
      `INSERT INTO providers (provider_id, profile_id, provider, api_key_env, status)
       VALUES ('p2', 'prof-2', 'anthropic', 'KEY', 'registered')`,
    ).run();
    db.prepare(
      `INSERT INTO provider_events (provider_id, type, payload)
       VALUES ('p2', 'test_event', '{}')`,
    ).run();

    assert.throws(
      () => db.prepare("UPDATE provider_events SET type = 'hacked'").run(),
      /UPDATE rejected/,
    );
    assert.throws(
      () => db.prepare('DELETE FROM provider_events').run(),
      /DELETE rejected/,
    );
  });

  it('model_mappings table exists with correct columns', () => {
    const cols = db.prepare("PRAGMA table_info('model_mappings')").all() as Array<{
      name: string;
      type: string;
    }>;
    const names = cols.map((c) => c.name);
    assert.ok(names.includes('mapping_id'));
    assert.ok(names.includes('provider_id'));
    assert.ok(names.includes('provider_model_id'));
    assert.ok(names.includes('hco_role'));
    assert.ok(names.includes('validated'));
  });

  it('model_mappings table enforces hco_role CHECK constraint', () => {
    db.prepare(
      `INSERT INTO providers (provider_id, profile_id, provider, api_key_env, status)
       VALUES ('p3', 'prof-3', 'anthropic', 'KEY', 'registered')`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO model_mappings (mapping_id, provider_id, provider_model_id, hco_role)
           VALUES ('m1', 'p3', 'model-1', 'assistant')`,
          )
          .run(),
      /CHECK constraint/,
    );
  });

  it('model_mappings enforces FK to providers', () => {
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO model_mappings (mapping_id, provider_id, provider_model_id, hco_role)
           VALUES ('m2', 'nonexistent', 'model-1', 'sonnet')`,
          )
          .run(),
      /FOREIGN KEY/,
    );
  });

  it('migration v11 is idempotent', () => {
    // Running openDb again should not error
    const db2 = openDb(TEST_DB_DIR);
    const cols = db2.prepare("PRAGMA table_info('providers')").all() as Array<{
      name: string;
    }>;
    assert.ok(cols.some((c) => c.name === 'provider_id'));
    db2.close();
  });

  it('existing HCO tables are unaffected by v11', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    assert.ok(names.includes('executions'));
    assert.ok(names.includes('execution_events'));
    assert.ok(names.includes('jobs'));
    assert.ok(names.includes('claude_sessions'));
    assert.ok(names.includes('providers'));
    assert.ok(names.includes('model_mappings'));
  });
});
