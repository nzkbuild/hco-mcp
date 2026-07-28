import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';

const TEST_DB_DIR = '/tmp/hco-test-migration-v12';

describe('Migration v12 — workspaces', () => {
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

  it('applies migration v12 on top of v11', () => {
    const v = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number };
    assert.ok(v.v >= 12, 'migration v12 should be applied');
  });

  it('workspaces table exists with correct columns', () => {
    const cols = db.prepare("PRAGMA table_info('workspaces')").all() as Array<{
      name: string;
    }>;
    const names = cols.map((c) => c.name);
    assert.ok(names.includes('workspace_id'));
    assert.ok(names.includes('repository_owner'));
    assert.ok(names.includes('repository_name'));
    assert.ok(names.includes('repository_path'));
    assert.ok(names.includes('provider_profile_id'));
    assert.ok(names.includes('status'));
    assert.ok(names.includes('last_resumed_at'));
  });

  it('workspaces enforce status CHECK constraint', () => {
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO workspaces (workspace_id, repository_owner, repository_name, repository_path, provider_profile_id, status) VALUES ('w1', 'o', 'r', '/p', 'prov-1', 'deleted')",
          )
          .run(),
      /CHECK constraint/,
    );
  });

  it('workspaces enforce FK to providers', () => {
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO workspaces (workspace_id, repository_owner, repository_name, repository_path, provider_profile_id) VALUES ('w2', 'o', 'r', '/p', 'nonexistent')",
          )
          .run(),
      /FOREIGN KEY/,
    );
  });

  it('migration v12 is idempotent', () => {
    const db2 = openDb(TEST_DB_DIR);
    const cols = db2.prepare("PRAGMA table_info('workspaces')").all() as Array<{
      name: string;
    }>;
    assert.ok(cols.some((c) => c.name === 'workspace_id'));
    db2.close();
  });
});
