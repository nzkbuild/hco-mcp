import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

// ─── Migration interface ───────────────────────────────────────────────────────

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

// ─── All migrations ────────────────────────────────────────────────────────────

const migrations: Migration[] = [
  {
    version: 1,
    name: 'foundation',
    up: (db) => {
      db.exec(`
        -- Milestones track named checkpoints in the HCO pipeline
        CREATE TABLE IF NOT EXISTS milestones (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          phase       TEXT NOT NULL DEFAULT 'H0',
          status      TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'active', 'complete', 'blocked')),
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Jobs are the core unit of work. Each job belongs to a milestone.
        CREATE TABLE IF NOT EXISTS jobs (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          external_id TEXT NOT NULL UNIQUE,
          milestone_id INTEGER REFERENCES milestones(id),
          kind        TEXT NOT NULL DEFAULT 'generic',
          status      TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'running', 'paused', 'complete', 'failed', 'cancelled')),
          input       TEXT NOT NULL DEFAULT '{}',
          output      TEXT,
          error       TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          started_at  TEXT,
          finished_at TEXT,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_jobs_milestone ON jobs(milestone_id);

        -- Sessions represent connected clients/MCP sessions
        CREATE TABLE IF NOT EXISTS sessions (
          id          TEXT PRIMARY KEY,
          transport   TEXT NOT NULL DEFAULT 'stdio',
          client_info TEXT NOT NULL DEFAULT '{}',
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Repositories tracked by HCO
        CREATE TABLE IF NOT EXISTS repositories (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          owner       TEXT NOT NULL,
          repo        TEXT NOT NULL,
          trust_level TEXT NOT NULL DEFAULT 'sandbox'
            CHECK (trust_level IN ('sandbox', 'trusted', 'privileged')),
          added_at    TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(owner, repo)
        );

        -- Validation results (lint, test, typecheck, etc.)
        CREATE TABLE IF NOT EXISTS validations (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id      INTEGER NOT NULL REFERENCES jobs(id),
          kind        TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'running', 'pass', 'fail', 'error')),
          summary     TEXT NOT NULL DEFAULT '',
          details     TEXT NOT NULL DEFAULT '{}',
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_validations_job ON validations(job_id);

        -- Pull requests tracked per job
        CREATE TABLE IF NOT EXISTS pull_requests (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id      INTEGER NOT NULL REFERENCES jobs(id),
          number      INTEGER,
          title       TEXT NOT NULL DEFAULT '',
          branch      TEXT NOT NULL DEFAULT '',
          base        TEXT NOT NULL DEFAULT '',
          state       TEXT NOT NULL DEFAULT 'open'
            CHECK (state IN ('open', 'closed', 'merged', 'draft')),
          url         TEXT NOT NULL DEFAULT '',
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_pr_job ON pull_requests(job_id);

        -- Approval records attached to jobs
        CREATE TABLE IF NOT EXISTS approvals (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id      INTEGER NOT NULL REFERENCES jobs(id),
          approver    TEXT NOT NULL,
          decision    TEXT NOT NULL DEFAULT 'pending'
            CHECK (decision IN ('pending', 'approved', 'rejected')),
          reason      TEXT NOT NULL DEFAULT '',
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_approvals_job ON approvals(job_id);

        -- Append-only event log — no deletes, no updates after insert
        CREATE TABLE IF NOT EXISTS events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          stream      TEXT NOT NULL,
          type        TEXT NOT NULL,
          version     INTEGER NOT NULL DEFAULT 1,
          payload     TEXT NOT NULL DEFAULT '{}',
          recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_events_stream ON events(stream, id);
        CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

        -- Schema version tracker
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 2,
    name: 'events-append-only',
    up: (db) => {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_events_no_update
        BEFORE UPDATE ON events
        BEGIN
          SELECT RAISE(FAIL, 'events table is append-only: UPDATE rejected');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_events_no_delete
        BEFORE DELETE ON events
        BEGIN
          SELECT RAISE(FAIL, 'events table is append-only: DELETE rejected');
        END;
      `);
    },
  },
  {
    version: 3,
    name: 'claude-sessions',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS claude_sessions (
          id          TEXT PRIMARY KEY,
          repo_owner  TEXT NOT NULL,
          repo_name   TEXT NOT NULL,
          repo_path   TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'start'
            CHECK (status IN ('start', 'running', 'exited', 'failed', 'stopped')),
          metadata    TEXT NOT NULL DEFAULT '{}',
          output_path TEXT,
          stderr_path TEXT,
          checkpoint_path TEXT,
          exit_code   INTEGER,
          error       TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          started_at  TEXT,
          finished_at TEXT,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_claude_sessions_status ON claude_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_claude_sessions_repo ON claude_sessions(repo_owner, repo_name);
      `);
    },
  },
  {
    version: 4,
    name: 'claude-lifecycle',
    up: (db) => {
      db.exec(`
        -- Add PID tracking for abort via OS signal
        ALTER TABLE claude_sessions ADD COLUMN pid INTEGER;

        -- Archive marker for terminal sessions (output preserved after cleanup)
        ALTER TABLE claude_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE claude_sessions ADD COLUMN archived_at TEXT;

        -- Append-only lifecycle event log (no updates, no deletes)
        CREATE TABLE IF NOT EXISTS session_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id  TEXT NOT NULL REFERENCES claude_sessions(id),
          type        TEXT NOT NULL,
          payload     TEXT NOT NULL DEFAULT '{}',
          recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, id);
        CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(type);

        -- Enforce append-only on session_events (same pattern as events table)
        CREATE TRIGGER IF NOT EXISTS trg_session_events_no_update
        BEFORE UPDATE ON session_events
        BEGIN
          SELECT RAISE(FAIL, 'session_events table is append-only: UPDATE rejected');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_session_events_no_delete
        BEFORE DELETE ON session_events
        BEGIN
          SELECT RAISE(FAIL, 'session_events table is append-only: DELETE rejected');
        END;
      `);
    },
  },
  {
    version: 6,
    name: 'jobs-worker-lease',
    up: (db) => {
      db.exec(`
        ALTER TABLE jobs ADD COLUMN worker_id TEXT DEFAULT NULL;
        ALTER TABLE jobs ADD COLUMN lease_until TEXT DEFAULT NULL;
        CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_lease ON jobs(lease_until);
        CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, lease_until);
      `);
    },
  },
  {
    version: 5,
    name: 'claude-status-archived-check',
    up: (db) => {
      db.exec(`
        -- Rebuild claude_sessions with 'archived' in the CHECK constraint.
        -- SQLite does not support ALTER TABLE … MODIFY CONSTRAINT, so we
        -- recreate the table, preserving all existing data and indices.
        CREATE TABLE claude_sessions_v5 (
          id          TEXT PRIMARY KEY,
          repo_owner  TEXT NOT NULL,
          repo_name   TEXT NOT NULL,
          repo_path   TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'start'
            CHECK (status IN ('start', 'running', 'exited', 'failed', 'stopped', 'archived')),
          metadata    TEXT NOT NULL DEFAULT '{}',
          output_path TEXT,
          stderr_path TEXT,
          checkpoint_path TEXT,
          exit_code   INTEGER,
          error       TEXT,
          pid         INTEGER,
          archived    INTEGER NOT NULL DEFAULT 0,
          archived_at TEXT,
          created_at  TEXT NOT NULL,
          started_at  TEXT,
          finished_at TEXT,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO claude_sessions_v5 SELECT
          id, repo_owner, repo_name, repo_path, status, metadata,
          output_path, stderr_path, checkpoint_path, exit_code, error,
          pid, archived, archived_at,
          created_at, started_at, finished_at, updated_at
        FROM claude_sessions;

        DROP TABLE claude_sessions;
        ALTER TABLE claude_sessions_v5 RENAME TO claude_sessions;

        CREATE INDEX IF NOT EXISTS idx_claude_sessions_status ON claude_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_claude_sessions_repo ON claude_sessions(repo_owner, repo_name);
      `);
    },
  },
  {
    version: 7,
    name: 'executions-immutable',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS executions (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id          TEXT NOT NULL UNIQUE,
          idempotency_key       TEXT NOT NULL UNIQUE,
          schema_version        INTEGER NOT NULL DEFAULT 1,
          status                TEXT NOT NULL DEFAULT 'accepted'
            CHECK (status IN ('accepted', 'queued', 'running', 'awaiting_input', 'completed', 'failed', 'cancelled', 'timed_out', 'archived')),
          request_json          TEXT NOT NULL,
          profile_snapshot_json TEXT NOT NULL,
          policy_snapshot_json  TEXT NOT NULL,
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
        CREATE INDEX IF NOT EXISTS idx_executions_idempotency ON executions(idempotency_key);

        CREATE TABLE IF NOT EXISTS execution_events (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id TEXT NOT NULL REFERENCES executions(execution_id),
          type         TEXT NOT NULL,
          payload      TEXT NOT NULL DEFAULT '{}',
          recorded_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_execution_events_execution ON execution_events(execution_id, id);
        CREATE INDEX IF NOT EXISTS idx_execution_events_type ON execution_events(type);

        CREATE TRIGGER IF NOT EXISTS trg_execution_events_no_update
        BEFORE UPDATE ON execution_events
        BEGIN
          SELECT RAISE(FAIL, 'execution_events table is append-only: UPDATE rejected');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_execution_events_no_delete
        BEFORE DELETE ON execution_events
        BEGIN
          SELECT RAISE(FAIL, 'execution_events table is append-only: DELETE rejected');
        END;
      `);
    },
  },
  {
    version: 8,
    name: 'executions-queue',
    up: (db) => {
      db.exec(`
        ALTER TABLE executions ADD COLUMN worker_id TEXT;
        ALTER TABLE executions ADD COLUMN lease_until TEXT;
        CREATE INDEX IF NOT EXISTS idx_executions_queue
          ON executions(status, lease_until, created_at);
      `);
    },
  },
  {
    version: 9,
    name: 'process-attempts',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS process_attempts (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          attempt_id      TEXT NOT NULL UNIQUE,
          execution_id    TEXT NOT NULL REFERENCES executions(execution_id),
          attempt_number  INTEGER NOT NULL,
          pid             INTEGER,
          started_at      TEXT NOT NULL,
          finished_at     TEXT,
          exit_code       INTEGER,
          timed_out       INTEGER NOT NULL DEFAULT 0,
          aborted         INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_process_attempts_execution
          ON process_attempts(execution_id, attempt_number);
      `);
    },
  },
  {
    version: 10,
    name: 'artifacts',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS artifacts (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          artifact_id     TEXT NOT NULL,
          execution_id    TEXT NOT NULL REFERENCES executions(execution_id),
          key             TEXT NOT NULL,
          content_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
          byte_length     INTEGER NOT NULL,
          chunk_index     INTEGER NOT NULL DEFAULT 0,
          total_chunks    INTEGER NOT NULL DEFAULT 1,
          data            BLOB NOT NULL,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(artifact_id, chunk_index)
        );
        CREATE INDEX IF NOT EXISTS idx_artifacts_execution
          ON artifacts(execution_id, key, chunk_index);
      `);
    },
  },
];

// ─── Migrate entrypoint ────────────────────────────────────────────────────────

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const current = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version')
    .get() as { version: number };

  const pending = migrations
    .filter((m) => m.version > current.version)
    .sort((a, b) => a.version - b.version);

  for (const m of pending) {
    if (m.version === 5) {
      // v5 rebuilds claude_sessions (referenced by session_events FK), so
      // foreign-key enforcement must be disabled OUTSIDE the transaction.
      const fkWasOn = db.pragma('foreign_keys', { simple: true }) as number;
      db.pragma('foreign_keys = OFF');
      db.transaction(() => {
        m.up(db);
        db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(m.version);
      })();
      if (fkWasOn) {
        db.pragma('foreign_keys = ON');
      }
    } else {
      db.transaction(() => {
        m.up(db);
        db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(m.version);
      })();
    }
  }
}

// ─── Open database ─────────────────────────────────────────────────────────────

export function openDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const dbPath = resolve(dataDir, 'hco.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);

  return db;
}
