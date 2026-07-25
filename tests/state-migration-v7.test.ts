import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb, runMigrations } from '../src/state/db.js';

const TEST_DIR = '/tmp/hco-test-migration-v7';

describe('Migration v7 — executions', () => {
  let db: Database.Database;

  before(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    db = openDb(TEST_DIR);
  });

  after(() => {
    db?.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('schema_version records v7 as highest', () => {
    const row = db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as {
      version: number;
    };
    assert.equal(row.version, 7);
  });

  it('executions table exists with correct columns', () => {
    const info = db.prepare("PRAGMA table_info('executions')").all() as Array<{ name: string }>;
    const names = info.map((c) => c.name);
    assert.ok(names.includes('id'));
    assert.ok(names.includes('execution_id'));
    assert.ok(names.includes('idempotency_key'));
    assert.ok(names.includes('schema_version'));
    assert.ok(names.includes('status'));
    assert.ok(names.includes('request_json'));
    assert.ok(names.includes('profile_snapshot_json'));
    assert.ok(names.includes('policy_snapshot_json'));
    assert.ok(names.includes('created_at'));
    assert.ok(names.includes('updated_at'));
  });

  it('execution_events table exists', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'execution_events'")
      .all() as Array<{ name: string }>;
    assert.equal(tables.length, 1);
    assert.equal(tables[0]?.name, 'execution_events');
  });

  it('execution_events table has correct columns', () => {
    const info = db.prepare("PRAGMA table_info('execution_events')").all() as Array<{
      name: string;
    }>;
    const names = info.map((c) => c.name);
    assert.ok(names.includes('id'));
    assert.ok(names.includes('execution_id'));
    assert.ok(names.includes('type'));
    assert.ok(names.includes('payload'));
    assert.ok(names.includes('recorded_at'));
  });

  it('execution_events rejects UPDATE via trigger', () => {
    db.exec(
      "INSERT INTO executions (execution_id, idempotency_key, schema_version, status, request_json, profile_snapshot_json, policy_snapshot_json, created_at, updated_at) VALUES ('req-test-ev', 'ik-001', 1, 'accepted', '{}', '{}', '{}', datetime('now'), datetime('now'))",
    );
    db.exec(
      "INSERT INTO execution_events (execution_id, type, payload) VALUES ('req-test-ev', 'created', '{}')",
    );
    assert.throws(() => {
      db.exec(
        "UPDATE execution_events SET payload = '{\"x\":1}' WHERE execution_id = 'req-test-ev'",
      );
    }, /append-only/);
  });

  it('execution_events rejects DELETE via trigger', () => {
    assert.throws(() => {
      db.exec("DELETE FROM execution_events WHERE execution_id = 'req-test-ev'");
    }, /append-only/);
  });

  it('idempotency_key has unique index', () => {
    db.exec(
      "INSERT INTO executions (execution_id, idempotency_key, schema_version, status, request_json, profile_snapshot_json, policy_snapshot_json, created_at, updated_at) VALUES ('req-uniq-a', 'ik-uniq-1', 1, 'accepted', '{}', '{}', '{}', datetime('now'), datetime('now'))",
    );
    assert.throws(() => {
      db.exec(
        "INSERT INTO executions (execution_id, idempotency_key, schema_version, status, request_json, profile_snapshot_json, policy_snapshot_json, created_at, updated_at) VALUES ('req-uniq-b', 'ik-uniq-1', 1, 'accepted', '{}', '{}', '{}', datetime('now'), datetime('now'))",
      );
    }, /UNIQUE/);
  });

  it('execution_id has unique index', () => {
    assert.throws(() => {
      db.exec(
        "INSERT INTO executions (execution_id, idempotency_key, schema_version, status, request_json, profile_snapshot_json, policy_snapshot_json, created_at, updated_at) VALUES ('req-test-ev', 'ik-002', 1, 'accepted', '{}', '{}', '{}', datetime('now'), datetime('now'))",
      );
    }, /UNIQUE/);
  });

  it('migration v7 is idempotent', () => {
    assert.doesNotThrow(() => {
      runMigrations(db);
    });
  });

  it('existing HCO 1.0.0 tables are not affected', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    assert.ok(names.includes('jobs'));
    assert.ok(names.includes('claude_sessions'));
    assert.ok(names.includes('milestones'));
    assert.ok(names.includes('validations'));
    assert.ok(names.includes('events'));
    assert.ok(names.includes('executions'));
    assert.ok(names.includes('execution_events'));
  });
});
