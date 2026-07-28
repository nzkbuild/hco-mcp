import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDb, runMigrations } from '../src/state/db.js';

const TEST_DIR = '/tmp/hco-test-db';

describe('Database migrations', () => {
  let db: Database.Database;

  before(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  after(() => {
    db?.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('openDb creates the database file', () => {
    db = openDb(TEST_DIR);
    assert.ok(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;

    const names = tables.map((t) => t.name).sort();
    assert.ok(names.includes('jobs'));
    assert.ok(names.includes('milestones'));
    assert.ok(names.includes('sessions'));
    assert.ok(names.includes('repositories'));
    assert.ok(names.includes('validations'));
    assert.ok(names.includes('pull_requests'));
    assert.ok(names.includes('approvals'));
    assert.ok(names.includes('events'));
    assert.ok(names.includes('claude_sessions'));
    assert.ok(names.includes('schema_version'));
  });

  it('migrations are idempotent', () => {
    // Running migrations again on the same db should not error
    assert.doesNotThrow(() => {
      runMigrations(db);
    });
  });

  it('schema_version records the correct version', () => {
    const row = db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as {
      version: number;
    };
    assert.ok(row.version >= 6, `expected >= 6, got ${String(row.version)}`);
  });

  it('jobs table accepts inserts with CHECK constraints', () => {
    db.exec("INSERT INTO jobs (external_id, kind, status) VALUES ('test-1', 'build', 'pending')");

    const row = db.prepare("SELECT * FROM jobs WHERE external_id = 'test-1'").get() as {
      external_id: string;
      kind: string;
      status: string;
    };
    assert.equal(row.external_id, 'test-1');
    assert.equal(row.kind, 'build');
    assert.equal(row.status, 'pending');
  });

  it('jobs table rejects invalid status', () => {
    assert.throws(() => {
      db.exec("INSERT INTO jobs (external_id, kind, status) VALUES ('test-2', 'build', 'invalid')");
    });
  });

  it('milestones table accepts inserts', () => {
    db.exec(
      "INSERT INTO milestones (name, description, phase, status) VALUES ('H0A', 'Foundation', 'H0', 'active')",
    );

    const row = db.prepare("SELECT * FROM milestones WHERE name = 'H0A'").get() as {
      name: string;
      status: string;
    };
    assert.equal(row.name, 'H0A');
    assert.equal(row.status, 'active');
  });

  it('sessions table accepts inserts', () => {
    db.exec("INSERT INTO sessions (id, transport, client_info) VALUES ('sess-1', 'stdio', '{}')");
    db.prepare("UPDATE sessions SET last_seen = datetime('now') WHERE id = 'sess-1'").run();

    const row = db.prepare("SELECT * FROM sessions WHERE id = 'sess-1'").get() as {
      id: string;
      transport: string;
    };
    assert.equal(row.id, 'sess-1');
    assert.equal(row.transport, 'stdio');
  });
});

describe('Append-only events', () => {
  let db: Database.Database;

  before(() => {
    rmSync('/tmp/hco-test-events', { recursive: true, force: true });
    db = openDb('/tmp/hco-test-events');
  });

  after(() => {
    db?.close();
    rmSync('/tmp/hco-test-events', { recursive: true, force: true });
  });

  it('events table stores structured payloads', () => {
    db.exec(
      "INSERT INTO events (stream, type, version, payload) VALUES ('job/test-1', 'job.created', 1, '{\"kind\":\"build\"}')",
    );
    db.exec(
      "INSERT INTO events (stream, type, version, payload) VALUES ('job/test-1', 'job.started', 2, '{}')",
    );

    const events = db.prepare("SELECT * FROM events WHERE stream = 'job/test-1' ORDER BY id").all();
    assert.equal(events.length, 2);
  });

  it('events are ordered by id within a stream', () => {
    const events = db
      .prepare(
        "SELECT stream, type, version, payload FROM events WHERE stream = 'job/test-1' ORDER BY id",
      )
      .all() as Array<{ stream: string; type: string; version: number }>;

    assert.equal(events[0]?.type, 'job.created');
    assert.equal(events[0]?.version, 1);
    assert.equal(events[1]?.type, 'job.started');
    assert.equal(events[1]?.version, 2);
  });

  it('events can be filtered by type', () => {
    const events = db.prepare("SELECT * FROM events WHERE type = 'job.created'").all();
    assert.equal(events.length, 1);
  });

  it('events table rejects UPDATE via SQLite trigger', () => {
    db.exec(
      "INSERT INTO events (stream, type, version, payload) VALUES ('job/test-3', 'test.event', 1, '{}')",
    );
    assert.throws(() => {
      db.exec("UPDATE events SET payload = '{}' WHERE stream = 'job/test-3'");
    }, /append-only/);
  });

  it('events table rejects DELETE via SQLite trigger', () => {
    assert.throws(() => {
      db.exec("DELETE FROM events WHERE stream = 'job/test-3'");
    }, /append-only/);
  });
});

describe('Migration v5 with existing session_events FK', () => {
  let db: Database.Database;

  before(() => {
    rmSync('/tmp/hco-test-v5', { recursive: true, force: true });
    db = openDb('/tmp/hco-test-v5');
  });

  after(() => {
    db?.close();
    rmSync('/tmp/hco-test-v5', { recursive: true, force: true });
  });

  it('preserves session_events FK row and supports archived status', () => {
    // Insert a claude_sessions row and a referencing session_events row
    db.exec(`
      INSERT INTO claude_sessions (id, repo_owner, repo_name, repo_path, status, metadata, created_at, updated_at)
      VALUES ('ses-test', 'alice', 'demo', '/tmp/demo', 'running', '{}', datetime('now'), datetime('now'))
    `);
    db.exec(`
      INSERT INTO session_events (session_id, type, payload)
      VALUES ('ses-test', 'started', '{"pid":99999}')
    `);

    // Verify the session and events exist before asserting v5 success
    const preSession = db.prepare('SELECT * FROM claude_sessions WHERE id = ?').get('ses-test');
    assert.ok(preSession);

    const preEvents = db
      .prepare('SELECT * FROM session_events WHERE session_id = ?')
      .all('ses-test');
    assert.equal(preEvents.length, 1);

    // archived status must now be allowed by the CHECK constraint
    db.exec("UPDATE claude_sessions SET status = 'archived', archived = 1 WHERE id = 'ses-test'");
    const archived = db
      .prepare('SELECT status, archived FROM claude_sessions WHERE id = ?')
      .get('ses-test') as { status: string; archived: number };
    assert.equal(archived.status, 'archived');
    assert.equal(archived.archived, 1);

    // FK is intact — session_events row still references ses-test
    const postEvents = db
      .prepare('SELECT * FROM session_events WHERE session_id = ?')
      .all('ses-test');
    assert.equal(postEvents.length, 1);

    // Deleting the parent row must fail (FK enforcement is back on)
    assert.throws(() => {
      db.exec("DELETE FROM claude_sessions WHERE id = 'ses-test'");
    });
  });
});
