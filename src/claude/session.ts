import { z } from 'zod';
import type Database from 'better-sqlite3';

// ─── Session status type ───────────────────────────────────────────────────────

export type ClaudeSessionStatus =
  'start' | 'running' | 'exited' | 'failed' | 'stopped' | 'archived';

// ─── Zod schemas for MCP input boundaries ──────────────────────────────────────

export const SESSION_ID_SCHEMA = z.string().min(1).max(256);
export const CLAUDE_SESSION_STATUS_SCHEMA = z.enum([
  'start',
  'running',
  'exited',
  'failed',
  'stopped',
  'archived',
]);
export const SESSION_LIMIT_SCHEMA = z.number().int().positive().max(200);
export const SESSION_TIMEOUT_MS_SCHEMA = z.number().int().positive().max(3_600_000);
export const SESSION_REASON_SCHEMA = z.string().min(1).max(1024);

// ─── Session row ───────────────────────────────────────────────────────────────

export interface ClaudeSession {
  id: string;
  repoOwner: string;
  repoName: string;
  repoPath: string;
  status: ClaudeSessionStatus;
  metadata: Record<string, unknown>;
  outputPath: string | null;
  stderrPath: string | null;
  checkpointPath: string | null;
  exitCode: number | null;
  error: string | null;
  pid: number | null;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

// ─── State transitions ─────────────────────────────────────────────────────────
//
//   start ──→ running ──→ exited ──→ archived
//     │           │──────→ failed ──→ archived
//     │           │──────→ stopped ─→ archived
//     │──────→ failed ──→ archived
//     │──────→ stopped ─→ archived
//
// Terminal states (exited, failed, stopped, archived) cannot transition further
// except exited/failed/stopped → archived (terminal marker, one-way).

const VALID_TRANSITIONS: Record<ClaudeSessionStatus, readonly ClaudeSessionStatus[]> = {
  start: ['running', 'failed', 'stopped'],
  running: ['exited', 'failed', 'stopped'],
  exited: ['archived'],
  failed: ['archived'],
  stopped: ['archived'],
  archived: [],
};

export function isValidTransition(from: ClaudeSessionStatus, to: ClaudeSessionStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ─── Column mapping ────────────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): ClaudeSession {
  return {
    id: row.id as string,
    repoOwner: row.repo_owner as string,
    repoName: row.repo_name as string,
    repoPath: row.repo_path as string,
    status: row.status as ClaudeSessionStatus,
    metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
    outputPath: (row.output_path as string | null) ?? null,
    stderrPath: (row.stderr_path as string | null) ?? null,
    checkpointPath: (row.checkpoint_path as string | null) ?? null,
    exitCode: (row.exit_code as number | null) ?? null,
    error: (row.error as string | null) ?? null,
    pid: (row.pid as number | null) ?? null,
    archived: row.archived === 1 || row.archived === true,
    archivedAt: (row.archived_at as string | null) ?? null,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

export function createSession(
  db: Database.Database,
  params: {
    id: string;
    repoOwner: string;
    repoName: string;
    repoPath: string;
    metadata?: Record<string, unknown>;
  },
): ClaudeSession {
  const now = dbNow();
  db.prepare(
    `INSERT INTO claude_sessions (id, repo_owner, repo_name, repo_path, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'start', ?, ?, ?)`,
  ).run(
    params.id,
    params.repoOwner,
    params.repoName,
    params.repoPath,
    JSON.stringify(params.metadata ?? {}),
    now,
    now,
  );

  const session = getSession(db, params.id);
  if (!session) {
    throw new Error(`Failed to fetch created session ${params.id}`);
  }
  return session;
}

export function getSession(db: Database.Database, id: string): ClaudeSession | null {
  const row = db.prepare('SELECT * FROM claude_sessions WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function listSessions(
  db: Database.Database,
  opts?: { status?: ClaudeSessionStatus; limit?: number },
): ClaudeSession[] {
  const limit = Math.min(opts?.limit ?? 50, 200);
  let rows: Record<string, unknown>[];
  if (opts?.status) {
    rows = db
      .prepare('SELECT * FROM claude_sessions WHERE status = ? ORDER BY created_at DESC LIMIT ?')
      .all(opts.status, limit) as Record<string, unknown>[];
  } else {
    rows = db
      .prepare('SELECT * FROM claude_sessions ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
  }
  return rows.map(rowToSession);
}

function dbNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ─── State transitions ─────────────────────────────────────────────────────────

export function transitionToRunning(db: Database.Database, id: string): ClaudeSession | null {
  const now = dbNow();
  const current = getSession(db, id);
  if (!current) return null;
  if (!isValidTransition(current.status, 'running')) return null;

  db.prepare(
    `UPDATE claude_sessions SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`,
  ).run(now, now, id);
  return getSession(db, id);
}

export function transitionToExited(
  db: Database.Database,
  id: string,
  exitCode: number,
): ClaudeSession | null {
  const now = dbNow();
  const current = getSession(db, id);
  if (!current) return null;
  if (!isValidTransition(current.status, 'exited')) return null;

  db.prepare(
    `UPDATE claude_sessions SET status = 'exited', exit_code = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
  ).run(exitCode, now, now, id);
  return getSession(db, id);
}

export function transitionToFailed(
  db: Database.Database,
  id: string,
  error: string,
): ClaudeSession | null {
  const now = dbNow();
  const current = getSession(db, id);
  if (!current) return null;
  if (!isValidTransition(current.status, 'failed')) return null;

  db.prepare(
    `UPDATE claude_sessions SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
  ).run(error, now, now, id);
  return getSession(db, id);
}

export function transitionToStopped(
  db: Database.Database,
  id: string,
  reason?: string,
): ClaudeSession | null {
  const now = dbNow();
  const current = getSession(db, id);
  if (!current) return null;
  if (!isValidTransition(current.status, 'stopped')) return null;

  db.prepare(
    `UPDATE claude_sessions SET status = 'stopped', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
  ).run(reason ?? null, now, now, id);
  return getSession(db, id);
}

export function setSessionOutputs(
  db: Database.Database,
  id: string,
  outputPath: string,
  stderrPath: string,
): boolean {
  const row = db.prepare('SELECT id FROM claude_sessions WHERE id = ?').get(id);
  if (!row) return false;
  const now = dbNow();
  db.prepare(
    `UPDATE claude_sessions SET output_path = ?, stderr_path = ?, updated_at = ? WHERE id = ?`,
  ).run(outputPath, stderrPath, now, id);
  return true;
}

export function setSessionCheckpointPath(
  db: Database.Database,
  id: string,
  checkpointPath: string,
): boolean {
  const row = db.prepare('SELECT id FROM claude_sessions WHERE id = ?').get(id);
  if (!row) return false;
  const now = dbNow();
  db.prepare(`UPDATE claude_sessions SET checkpoint_path = ?, updated_at = ? WHERE id = ?`).run(
    checkpointPath,
    now,
    id,
  );
  return true;
}

// ─── Lifecycle: PID tracking ────────────────────────────────────────────────────

export function setSessionPid(db: Database.Database, id: string, pid: number): boolean {
  const row = db.prepare('SELECT id FROM claude_sessions WHERE id = ?').get(id);
  if (!row) return false;
  const now = dbNow();
  db.prepare(`UPDATE claude_sessions SET pid = ?, updated_at = ? WHERE id = ?`).run(pid, now, id);
  return true;
}

// ─── Lifecycle: archive ─────────────────────────────────────────────────────────

export function transitionToArchived(db: Database.Database, id: string): ClaudeSession | null {
  const now = dbNow();
  const current = getSession(db, id);
  if (!current) return null;
  if (!isValidTransition(current.status, 'archived')) return null;

  db.prepare(
    `UPDATE claude_sessions SET status = 'archived', archived = 1, archived_at = ?, finished_at = COALESCE(finished_at, ?), updated_at = ? WHERE id = ?`,
  ).run(now, now, now, id);
  return getSession(db, id);
}

// ─── Lifecycle: session events (append-only) ────────────────────────────────────

export interface SessionEvent {
  id: number;
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
  recordedAt: string;
}

export function appendSessionEvent(
  db: Database.Database,
  sessionId: string,
  type: string,
  payload?: Record<string, unknown>,
): void {
  db.prepare(`INSERT INTO session_events (session_id, type, payload) VALUES (?, ?, ?)`).run(
    sessionId,
    type,
    JSON.stringify(payload ?? {}),
  );
}

export function getSessionEvents(
  db: Database.Database,
  sessionId: string,
  opts?: { type?: string; limit?: number },
): SessionEvent[] {
  const limit = Math.min(opts?.limit ?? 100, 500);
  let rows: Record<string, unknown>[];
  if (opts?.type) {
    rows = db
      .prepare(
        'SELECT * FROM session_events WHERE session_id = ? AND type = ? ORDER BY id DESC LIMIT ?',
      )
      .all(sessionId, opts.type, limit) as Record<string, unknown>[];
  } else {
    rows = db
      .prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit) as Record<string, unknown>[];
  }
  return rows.map((r) => ({
    id: r.id as number,
    sessionId: r.session_id as string,
    type: r.type as string,
    payload: JSON.parse(r.payload as string) as Record<string, unknown>,
    recordedAt: r.recorded_at as string,
  }));
}
