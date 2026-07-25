import Database from 'better-sqlite3';
import type { ExecutionRequestV1 } from '../contract/execution-request.js';
import type { ExecutionProfileV1 } from '../contract/execution-profile.js';
import type { PolicySnapshotV1 } from '../contract/policy-snapshot.js';
import { generateIdempotencyKey } from './idempotency.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ExecutionRow {
  id: number;
  executionId: string;
  idempotencyKey: string;
  schemaVersion: number;
  status: string;
  requestJson: string;
  profileSnapshotJson: string;
  policySnapshotJson: string;
  createdAt: string;
  updatedAt: string;
  workerId?: string | null;
  leaseUntil?: string | null;
}

// ─── Error types ────────────────────────────────────────────────────────────────

export class ConflictingExecutionError extends Error {
  public readonly existingExecutionId: string;

  constructor(idempotencyKey: string, existingExecutionId: string) {
    super(
      `Conflicting execution: idempotency_key "${idempotencyKey}" already exists with different content`,
    );
    this.name = 'ConflictingExecutionError';
    this.existingExecutionId = existingExecutionId;
  }
}

// ─── Row mapping ────────────────────────────────────────────────────────────────

function rowToExecution(row: Record<string, unknown>): ExecutionRow {
  return {
    id: row.id as number,
    executionId: row.execution_id as string,
    idempotencyKey: row.idempotency_key as string,
    schemaVersion: row.schema_version as number,
    status: row.status as string,
    requestJson: row.request_json as string,
    profileSnapshotJson: row.profile_snapshot_json as string,
    policySnapshotJson: row.policy_snapshot_json as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    workerId: (row.worker_id as string | null) ?? null,
    leaseUntil: (row.lease_until as string | null) ?? null,
  };
}

function dbNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function requestJsonEquals(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const parsedA = JSON.parse(a) as Record<string, unknown>;
    const parsedB = JSON.parse(b) as Record<string, unknown>;
    delete parsedA.request_id;
    delete parsedB.request_id;
    delete parsedA.submitted_at;
    delete parsedB.submitted_at;
    return deepSortedJson(parsedA) === deepSortedJson(parsedB);
  } catch {
    return a === b;
  }
}

function deepSortedJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(deepSortedJson).join(',')}]`;
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${deepSortedJson((obj as Record<string, unknown>)[k])}`,
  );
  return `{${pairs.join(',')}}`;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────────

export function createExecution(
  db: Database.Database,
  request: ExecutionRequestV1,
  profile: ExecutionProfileV1,
  policy: PolicySnapshotV1,
): ExecutionRow {
  const executionId = request.request_id;
  const idempotencyKey = request.idempotency_key ?? generateIdempotencyKey();
  const requestJson = JSON.stringify(request);
  const profileJson = JSON.stringify(profile);
  const policyJson = JSON.stringify(policy);
  const now = dbNow();

  const existing = getExecutionByIdempotencyKey(db, idempotencyKey);
  if (existing) {
    if (requestJsonEquals(existing.requestJson, requestJson)) {
      return existing;
    }
    throw new ConflictingExecutionError(idempotencyKey, existing.executionId);
  }

  db.prepare(
    `INSERT INTO executions (execution_id, idempotency_key, schema_version, status, request_json, profile_snapshot_json, policy_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?, ?)`,
  ).run(
    executionId,
    idempotencyKey,
    request.schema_version,
    requestJson,
    profileJson,
    policyJson,
    now,
    now,
  );

  db.prepare(
    `INSERT INTO execution_events (execution_id, type, payload)
     VALUES (?, 'created', ?)`,
  ).run(executionId, JSON.stringify({ execution_id: executionId }));

  const created = getExecution(db, executionId);
  if (!created) {
    throw new Error(`Failed to fetch created execution ${executionId}`);
  }
  return created;
}

export function getExecution(db: Database.Database, executionId: string): ExecutionRow | null {
  const row = db.prepare('SELECT * FROM executions WHERE execution_id = ?').get(executionId) as
    Record<string, unknown> | undefined;
  return row ? rowToExecution(row) : null;
}

export function getExecutionByIdempotencyKey(
  db: Database.Database,
  key: string,
): ExecutionRow | null {
  const row = db.prepare('SELECT * FROM executions WHERE idempotency_key = ?').get(key) as
    Record<string, unknown> | undefined;
  return row ? rowToExecution(row) : null;
}

export function listExecutions(
  db: Database.Database,
  opts?: { status?: string; limit?: number },
): ExecutionRow[] {
  const limit = Math.min(opts?.limit ?? 50, 200);
  let rows: Record<string, unknown>[];
  if (opts?.status) {
    rows = db
      .prepare('SELECT * FROM executions WHERE status = ? ORDER BY created_at DESC LIMIT ?')
      .all(opts.status, limit) as Record<string, unknown>[];
  } else {
    rows = db
      .prepare('SELECT * FROM executions ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
  }
  return rows.map(rowToExecution);
}

// ─── State machine ─────────────────────────────────────────────────────────────
//
//   accepted → queued → running → completed
//                           ├→ failed
//                           ├→ cancelled
//                           ├→ timed_out
//                           └→ awaiting_input → running (continue)
//   queued → cancelled
//   any terminal (completed, failed, cancelled, timed_out) → archived
//   archived → (none)

const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  accepted: ['queued', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'timed_out', 'awaiting_input'],
  awaiting_input: ['running', 'cancelled'],
  completed: ['archived'],
  failed: ['archived'],
  cancelled: ['archived'],
  timed_out: ['archived'],
  archived: [],
};

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed_out']);

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

function appendEvent(
  db: Database.Database,
  executionId: string,
  type: string,
  payload?: Record<string, unknown>,
): void {
  db.prepare('INSERT INTO execution_events (execution_id, type, payload) VALUES (?, ?, ?)').run(
    executionId,
    type,
    JSON.stringify(payload ?? {}),
  );
}

function transition(
  db: Database.Database,
  executionId: string,
  to: string,
  eventType: string,
  eventPayload?: Record<string, unknown>,
): ExecutionRow | null {
  const current = getExecution(db, executionId);
  if (!current) return null;
  if (!isValidTransition(current.status, to)) return null;

  const now = dbNow();
  db.prepare('UPDATE executions SET status = ?, updated_at = ? WHERE execution_id = ?').run(
    to,
    now,
    executionId,
  );

  appendEvent(db, executionId, eventType, {
    from: current.status,
    to,
    ...eventPayload,
  });

  return getExecution(db, executionId);
}

export function transitionToQueued(
  db: Database.Database,
  executionId: string,
): ExecutionRow | null {
  return transition(db, executionId, 'queued', 'queued');
}

export function transitionToRunning(
  db: Database.Database,
  executionId: string,
): ExecutionRow | null {
  return transition(db, executionId, 'running', 'started');
}

export function transitionToCompleted(
  db: Database.Database,
  executionId: string,
  exitCode?: number,
): ExecutionRow | null {
  const now = dbNow();
  const current = getExecution(db, executionId);
  if (!current) return null;
  if (!isValidTransition(current.status, 'completed')) return null;

  db.prepare('UPDATE executions SET status = ?, updated_at = ? WHERE execution_id = ?').run(
    'completed',
    now,
    executionId,
  );

  appendEvent(db, executionId, 'completed', {
    exit_code: exitCode,
    from: current.status,
    to: 'completed',
  });

  return getExecution(db, executionId);
}

export function transitionToFailed(
  db: Database.Database,
  executionId: string,
  error?: string,
): ExecutionRow | null {
  return transition(db, executionId, 'failed', 'failed', error ? { error } : undefined);
}

export function transitionToCancelled(
  db: Database.Database,
  executionId: string,
  reason?: string,
): ExecutionRow | null {
  return transition(db, executionId, 'cancelled', 'cancelled', reason ? { reason } : undefined);
}

export function transitionToTimedOut(
  db: Database.Database,
  executionId: string,
): ExecutionRow | null {
  return transition(db, executionId, 'timed_out', 'timed_out');
}

export function transitionToAwaitingInput(
  db: Database.Database,
  executionId: string,
): ExecutionRow | null {
  return transition(db, executionId, 'awaiting_input', 'awaiting_input');
}

export function transitionToArchived(
  db: Database.Database,
  executionId: string,
): ExecutionRow | null {
  return transition(db, executionId, 'archived', 'archived');
}

// ─── Queue with lease ownership ─────────────────────────────────────────

export function claimExecution(
  db: Database.Database,
  workerId: string,
  leaseMs: number,
): ExecutionRow | null {
  const now = dbNow();
  const leaseUntilDate = new Date(Date.now() + leaseMs);
  const leaseUntil = leaseUntilDate.toISOString().replace('T', ' ').slice(0, 19);

  const row = db
    .prepare(
      `UPDATE executions
       SET status = 'running',
           worker_id = ?,
           lease_until = ?,
           updated_at = ?
       WHERE id = (
         SELECT id FROM executions
         WHERE status IN ('accepted', 'queued')
            OR (status IN ('running', 'awaiting_input') AND lease_until <= ?)
         ORDER BY
           CASE status
             WHEN 'queued' THEN 0
             WHEN 'accepted' THEN 1
             WHEN 'running' THEN 2
             WHEN 'awaiting_input' THEN 3
           END,
           created_at
         LIMIT 1
       )
       RETURNING *`,
    )
    .get(workerId, leaseUntil, now, now) as Record<string, unknown> | undefined;

  return row ? rowToExecution(row) : null;
}

export function releaseExpiredExecutions(db: Database.Database): {
  requeued: number;
  failed: number;
} {
  const now = dbNow();

  // Expired running -> back to queued (retry eligible)
  const requeuedResult = db
    .prepare(
      `UPDATE executions
       SET status = 'queued',
           worker_id = NULL,
           lease_until = NULL,
           updated_at = ?
       WHERE status = 'running'
         AND lease_until IS NOT NULL
         AND lease_until <= ?`,
    )
    .run(now, now);

  // Expired awaiting_input -> failed (no auto-retry for input waits)
  // Expired queued -> failed (never started)
  const failedResult = db
    .prepare(
      `UPDATE executions
       SET status = 'failed',
           worker_id = NULL,
           lease_until = NULL,
           updated_at = ?
       WHERE status IN ('awaiting_input', 'queued')
         AND lease_until IS NOT NULL
         AND lease_until <= ?`,
    )
    .run(now, now);

  return { requeued: requeuedResult.changes, failed: failedResult.changes };
}

export function renewExecutionLease(
  db: Database.Database,
  executionId: string,
  workerId: string,
  leaseMs: number,
): ExecutionRow | null {
  const now = dbNow();
  const leaseUntilDate = new Date(Date.now() + leaseMs);
  const leaseUntil = leaseUntilDate.toISOString().replace('T', ' ').slice(0, 19);

  const row = db
    .prepare(
      `UPDATE executions
       SET lease_until = ?, updated_at = ?
       WHERE execution_id = ?
         AND worker_id = ?
         AND status = 'running'
       RETURNING *`,
    )
    .get(leaseUntil, now, executionId, workerId) as Record<string, unknown> | undefined;

  return row ? rowToExecution(row) : null;
}

export function isExecutionTimedOut(execution: ExecutionRow, profile: ExecutionProfileV1): boolean {
  if (!profile.max_execution_time_ms) return false;
  if (execution.status !== 'running') return false;
  if (!execution.createdAt) return false;

  const started = new Date(execution.createdAt.replace(' ', 'T') + 'Z').getTime();
  const elapsed = Date.now() - started;
  return elapsed > profile.max_execution_time_ms;
}
