import type Database from 'better-sqlite3';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface JobRow {
  id: number;
  externalId: string;
  milestoneId: number | null;
  kind: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  workerId: string | null;
  leaseUntil: string | null;
}

export interface CreateJobInput {
  externalId: string;
  kind?: string;
  input?: Record<string, unknown>;
  milestoneId?: number | null;
}

// ─── Error types ────────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConflictingJobError extends Error {
  public readonly existingJob: JobRow;

  constructor(externalId: string, existing: JobRow) {
    super(`Conflicting job with external_id "${externalId}": kind or input differs`);
    this.name = 'ConflictingJobError';
    this.existingJob = existing;
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────────

const EXTERNAL_ID_MAX = 256;
const KIND_MAX = 256;
const INPUT_MAX_SERIALIZED = 65536;

function validateExternalId(id: unknown): void {
  if (typeof id !== 'string') {
    throw new ValidationError('external_id must be a string');
  }
  if (id.length < 1) {
    throw new ValidationError('external_id must not be empty');
  }
  if (id.length > EXTERNAL_ID_MAX) {
    throw new ValidationError('external_id must not exceed 256 characters');
  }
}

function validateKind(kind: unknown): void {
  if (typeof kind !== 'string') {
    throw new ValidationError('kind must be a string');
  }
  if (kind.length < 1) {
    throw new ValidationError('kind must not be empty');
  }
  if (kind.length > KIND_MAX) {
    throw new ValidationError('kind must not exceed 256 characters');
  }
}

function rejectUnserializable(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): void {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throw new ValidationError('input must be JSON-serializable');
  }

  if (seen.has(value)) {
    throw new ValidationError('input must be JSON-serializable');
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      rejectUnserializable(item, seen);
    }
    return;
  }
  // plain object
  for (const v of Object.values(value as Record<string, unknown>)) {
    rejectUnserializable(v, seen);
  }
}

function validateMilestoneId(id: unknown): void {
  if (id === null || id === undefined) {
    return;
  }
  if (typeof id !== 'number') {
    throw new ValidationError('milestoneId must be a positive integer or null/undefined');
  }
  if (!Number.isFinite(id)) {
    throw new ValidationError('milestoneId must be a positive integer');
  }
  if (!Number.isInteger(id)) {
    throw new ValidationError('milestoneId must be a positive integer');
  }
  if (id <= 0) {
    throw new ValidationError('milestoneId must be a positive integer');
  }
}

function validateInput(input: unknown): Record<string, unknown> {
  if (input === undefined) {
    return {};
  }

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('input must be a plain object');
  }

  const proto: object | null = Object.getPrototypeOf(input) as object | null;
  if (proto !== Object.prototype && proto !== null) {
    throw new ValidationError('input must be a plain object');
  }

  rejectUnserializable(input);

  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    throw new ValidationError('input must be JSON-serializable');
  }

  if (json.length > INPUT_MAX_SERIALIZED) {
    throw new ValidationError('input serialized size must not exceed 65536 characters');
  }

  return JSON.parse(json) as Record<string, unknown>;
}

// ─── Row mapping ────────────────────────────────────────────────────────────────

function rowToJob(row: Record<string, unknown>): JobRow {
  return {
    id: row.id as number,
    externalId: row.external_id as string,
    milestoneId: (row.milestone_id as number | null) ?? null,
    kind: row.kind as string,
    status: row.status as string,
    input: JSON.parse(row.input as string) as Record<string, unknown>,
    output: row.output ? (JSON.parse(row.output as string) as Record<string, unknown>) : null,
    error: (row.error as string | null) ?? null,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    updatedAt: row.updated_at as string,
    workerId: (row.worker_id as string | null) ?? null,
    leaseUntil: (row.lease_until as string | null) ?? null,
  };
}

function dbNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ─── CRUD ───────────────────────────────────────────────────────────────────────

export function createJob(db: Database.Database, input: CreateJobInput): JobRow {
  validateExternalId(input.externalId);
  if (input.kind !== undefined) {
    validateKind(input.kind);
  }
  validateMilestoneId(input.milestoneId);

  const kind = input.kind ?? 'generic';
  const validatedInput = validateInput(input.input);
  const inputJson = JSON.stringify(validatedInput);

  const now = dbNow();

  const insertResult = db
    .prepare(
      `INSERT OR IGNORE INTO jobs (external_id, kind, input, milestone_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.externalId, kind, inputJson, input.milestoneId ?? null, now, now);

  if (insertResult.changes === 0) {
    const existing = getJob(db, input.externalId);
    if (!existing) {
      throw new Error(`Failed to fetch existing job ${input.externalId}`);
    }
    if (existing.kind === kind && JSON.stringify(existing.input) === inputJson) {
      return existing;
    }
    throw new ConflictingJobError(input.externalId, existing);
  }

  const created = getJob(db, input.externalId);
  if (!created) {
    throw new Error(`Failed to fetch created job ${input.externalId}`);
  }
  return created;
}

export function getJob(db: Database.Database, externalId: string): JobRow | null {
  const row = db.prepare('SELECT * FROM jobs WHERE external_id = ?').get(externalId) as
    Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

export function claimJob(db: Database.Database, workerId: string, leaseMs: number): JobRow | null {
  if (typeof workerId !== 'string') {
    throw new ValidationError('workerId must be a string');
  }
  if (workerId.length < 1 || workerId.length > 256) {
    throw new ValidationError('workerId must be 1..256 characters');
  }

  if (typeof leaseMs !== 'number' || !Number.isFinite(leaseMs) || !Number.isInteger(leaseMs)) {
    throw new ValidationError('leaseMs must be a finite integer');
  }
  if (leaseMs < 1 || leaseMs > 3_600_000) {
    throw new ValidationError('leaseMs must be 1..3600000');
  }

  const now = dbNow();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString().replace('T', ' ').slice(0, 19);

  const row = db
    .prepare(
      `UPDATE jobs
       SET status = 'running',
           started_at = COALESCE(started_at, ?),
           worker_id = ?,
           lease_until = ?,
           updated_at = ?
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'pending'
            OR (status = 'running' AND lease_until <= ?)
         ORDER BY created_at
         LIMIT 1
       )
       RETURNING *`,
    )
    .get(now, workerId, leaseUntil, now, now) as Record<string, unknown> | undefined;

  return row ? rowToJob(row) : null;
}

export function releaseExpiredJobs(db: Database.Database): number {
  const now = dbNow();
  const result = db
    .prepare(
      `UPDATE jobs
       SET status = 'pending',
           worker_id = NULL,
           lease_until = NULL,
           updated_at = ?
       WHERE status = 'running'
         AND lease_until <= ?`,
    )
    .run(now, now);
  return result.changes;
}

export function renewJobLease(
  db: Database.Database,
  jobId: number,
  workerId: string,
  leaseMs: number,
): JobRow | null {
  if (typeof jobId !== 'number' || !Number.isFinite(jobId) || !Number.isInteger(jobId)) {
    throw new ValidationError('jobId must be a positive integer');
  }
  if (jobId <= 0) {
    throw new ValidationError('jobId must be a positive integer');
  }

  if (typeof workerId !== 'string') {
    throw new ValidationError('workerId must be a string');
  }
  if (workerId.length < 1 || workerId.length > 256) {
    throw new ValidationError('workerId must be 1..256 characters');
  }

  if (typeof leaseMs !== 'number' || !Number.isFinite(leaseMs) || !Number.isInteger(leaseMs)) {
    throw new ValidationError('leaseMs must be a finite integer');
  }
  if (leaseMs < 1 || leaseMs > 3_600_000) {
    throw new ValidationError('leaseMs must be 1..3600000');
  }

  const now = dbNow();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString().replace('T', ' ').slice(0, 19);

  const row = db
    .prepare(
      `UPDATE jobs
       SET lease_until = ?,
           updated_at = ?
       WHERE id = ?
         AND status = 'running'
         AND worker_id = ?
       RETURNING *`,
    )
    .get(leaseUntil, now, jobId, workerId) as Record<string, unknown> | undefined;

  return row ? rowToJob(row) : null;
}
