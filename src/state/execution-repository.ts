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
  };
}

function dbNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
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
    if (existing.requestJson === requestJson) {
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
