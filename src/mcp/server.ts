import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import type { AppContext } from '../core/context.js';
import { openDb } from '../state/db.js';
import { loadConfig } from '../config/schema.js';
import type { HcoConfig } from '../config/schema.js';
import type Database from 'better-sqlite3';
import type { ClaudeLauncher } from '../claude/launcher.js';
import {
  getSession,
  listSessions,
  getSessionEvents,
  SESSION_ID_SCHEMA,
  CLAUDE_SESSION_STATUS_SCHEMA,
  SESSION_LIMIT_SCHEMA,
  SESSION_TIMEOUT_MS_SCHEMA,
  SESSION_REASON_SCHEMA,
  type ClaudeSessionStatus,
} from '../claude/session.js';
import {
  error,
  success,
  sanitizedError,
  type McpErrorResponse,
  type McpSuccessResponse,
  ErrorCode,
} from './errors.js';
import { logDebug } from './logging.js';
import { ExecutionService } from '../execution/service.js';
import { ExecutionRequestV1 } from '../contract/execution-request.js';
import { ExecutionProfileV1 } from '../contract/execution-profile.js';
import { PolicySnapshotV1 } from '../contract/policy-snapshot.js';
import { FakeClaudeCodeAdapter, SpawnAdapter } from '../claude/adapter.js';
import type { ClaudeCodeAdapter } from '../claude/adapter.js';
import { ArtifactStorage, ARTIFACT_LIMITS } from '../state/artifact-store.js';
import { getExecution } from '../state/execution-repository.js';
import { ProviderService } from '../provider/service.js';
import { ProviderProfileV1 } from '../contract/provider-profile.js';

// ─── Re-export for tests ─────────────────────────────────────────────────────

export { ErrorCode };
export type { McpErrorResponse, McpSuccessResponse };
export { error, success, sanitizedError };

// ─── Shared state (set during server creation) ───────────────────────────────

interface ServerState {
  db: Database.Database;
  launcher: ClaudeLauncher | undefined;
  executionService: ExecutionService;
  providerService: ProviderService;
}

let state: ServerState;

// ─── Input schemas ───────────────────────────────────────────────────────────

const OWNER_SCHEMA = z.string().min(1).max(256);
const REPO_SCHEMA = z.string().min(1).max(256);
const REPO_PATH_SCHEMA = z.string().min(1).max(4096);
const PROMPT_SCHEMA = z.string().min(1).max(65536);
const JOB_STATUS_SCHEMA = z.enum([
  'pending',
  'running',
  'paused',
  'complete',
  'failed',
  'cancelled',
]);
const JOB_LIMIT_SCHEMA = z.number().int().positive().max(200);
const EXTERNAL_ID_SCHEMA = z.string().min(1).max(256);

// ─── Execution schemas ─────────────────────────────────────────────────────

const EXECUTION_ID_SCHEMA = z.string().min(1).max(256);
const CONTINUE_PROMPT_SCHEMA = z.string().min(1).max(65536);
const EXECUTION_REASON_SCHEMA = z.string().min(1).max(1024).optional();
const EXECUTION_TIMEOUT_MS_SCHEMA = z.number().int().min(1).max(3600000).optional();

// ─── Status handler ──────────────────────────────────────────────────────────

export function handleStatus(): McpSuccessResponse {
  const jobCounts = state.db
    .prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status')
    .all();
  const milestoneCounts = state.db
    .prepare('SELECT status, COUNT(*) AS count FROM milestones GROUP BY status')
    .all();
  const sessionCount = (
    state.db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }
  ).count;
  const claudeCount = (
    state.db.prepare('SELECT COUNT(*) AS count FROM claude_sessions').get() as { count: number }
  ).count;

  return success({
    jobs: jobCounts,
    milestones: milestoneCounts,
    sessions: sessionCount,
    claude_sessions: claudeCount,
  });
}

// ─── Job handlers ────────────────────────────────────────────────────────────

export function handleListJobs(args: {
  status: string | undefined;
  limit: number | undefined;
}): McpSuccessResponse {
  const status = args.status !== undefined ? JOB_STATUS_SCHEMA.safeParse(args.status) : undefined;
  const limit = JOB_LIMIT_SCHEMA.safeParse(args.limit ?? 50);

  const safeStatus = status?.success ? status.data : undefined;
  const safeLimit = limit.success ? limit.data : 50;

  let rows: unknown[];
  if (safeStatus) {
    rows = state.db
      .prepare(
        'SELECT external_id, kind, status, created_at, started_at, finished_at FROM jobs WHERE status = ? ORDER BY id DESC LIMIT ?',
      )
      .all(safeStatus, safeLimit);
  } else {
    rows = state.db
      .prepare(
        'SELECT external_id, kind, status, created_at, started_at, finished_at FROM jobs ORDER BY id DESC LIMIT ?',
      )
      .all(safeLimit);
  }

  return success(rows);
}

export function handleInspectJob(args: {
  external_id: string;
}): McpErrorResponse | McpSuccessResponse {
  const { external_id: externalId } = args;
  if (!externalId || externalId.length > 256) {
    return error(ErrorCode.VALIDATION_ERROR, 'external_id is required (1-256 characters)');
  }

  const job = state.db.prepare('SELECT * FROM jobs WHERE external_id = ?').get(externalId) as
    Record<string, unknown> | undefined;
  if (!job) {
    return error(ErrorCode.VALIDATION_ERROR, `Job "${externalId}" not found`);
  }

  const validations = state.db
    .prepare(
      'SELECT kind, status, summary, created_at, finished_at FROM validations WHERE job_id = ?',
    )
    .all(job.id);

  const prs = state.db
    .prepare('SELECT number, title, branch, base, state, url FROM pull_requests WHERE job_id = ?')
    .all(job.id);

  const approvals = state.db
    .prepare('SELECT approver, decision, reason, created_at FROM approvals WHERE job_id = ?')
    .all(job.id);

  return success({
    ...job,
    validations,
    pull_requests: prs,
    approvals,
  });
}

export function handleListMilestones(): McpSuccessResponse {
  const rows = state.db
    .prepare(
      'SELECT name, phase, status, description, created_at, updated_at FROM milestones ORDER BY id',
    )
    .all();
  return success(rows);
}

// ─── Session lifecycle handlers ──────────────────────────────────────────────

export function handleSessionList(args: {
  status?: string | undefined;
  limit?: number | undefined;
}): McpSuccessResponse {
  logDebug('DEPRECATED: hco_session_list — use hco_execution_status');
  const sessions = listSessions(state.db, {
    ...(args.status ? { status: args.status as ClaudeSessionStatus } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
  });
  return success(sessions);
}

export function handleSessionStatus(args: {
  session_id: string;
}): McpErrorResponse | McpSuccessResponse {
  logDebug('DEPRECATED: hco_session_status — use hco_execution_status');
  const session = getSession(state.db, args.session_id);
  if (!session) {
    return error(ErrorCode.UNKNOWN_SESSION, `Session "${args.session_id}" not found`);
  }
  const events = getSessionEvents(state.db, args.session_id);
  return success({ session, events });
}

export async function handleSessionWait(args: {
  session_id: string;
  timeout_ms?: number | undefined;
}): Promise<McpErrorResponse | McpSuccessResponse> {
  logDebug('DEPRECATED: hco_session_wait — use hco_execution_wait');
  if (!state.launcher) {
    return error(ErrorCode.LAUNCHER_UNAVAILABLE, 'Launcher not available');
  }
  const result = await state.launcher.wait(args.session_id, args.timeout_ms);
  if (!result) {
    return error(ErrorCode.UNKNOWN_SESSION, `Session "${args.session_id}" not found`);
  }
  return success(result);
}

export function handleSessionStop(args: {
  session_id: string;
  reason?: string | undefined;
}): McpErrorResponse | McpSuccessResponse {
  logDebug('DEPRECATED: hco_session_stop — use hco_execution_cancel');
  if (!state.launcher) {
    return error(ErrorCode.LAUNCHER_UNAVAILABLE, 'Launcher not available');
  }
  const current = getSession(state.db, args.session_id);
  if (!current) {
    return error(ErrorCode.UNKNOWN_SESSION, `Session "${args.session_id}" not found`);
  }
  if (current.status !== 'running') {
    return error(
      ErrorCode.INVALID_LIFECYCLE,
      `Session "${args.session_id}" is not running (current: ${current.status})`,
    );
  }
  const result = state.launcher.abort(args.session_id, args.reason);
  if (!result) {
    return error(ErrorCode.INVALID_LIFECYCLE, `Failed to stop session "${args.session_id}"`);
  }
  return success(result);
}

export function handleSessionArchive(args: {
  session_id: string;
}): McpErrorResponse | McpSuccessResponse {
  logDebug('DEPRECATED: hco_session_archive');
  if (!state.launcher) {
    return error(ErrorCode.LAUNCHER_UNAVAILABLE, 'Launcher not available');
  }
  const current = getSession(state.db, args.session_id);
  if (!current) {
    return error(ErrorCode.UNKNOWN_SESSION, `Session "${args.session_id}" not found`);
  }
  if (!isTerminal(current.status)) {
    return error(
      ErrorCode.INVALID_LIFECYCLE,
      `Session "${args.session_id}" is not terminal (current: ${current.status})`,
    );
  }
  const result = state.launcher.archive(args.session_id);
  if (!result) {
    return error(ErrorCode.INVALID_LIFECYCLE, `Failed to archive session "${args.session_id}"`);
  }
  return success(result);
}

// ─── Session start handler ───────────────────────────────────────────────────

export function handleSessionStart(args: {
  owner: string;
  repo: string;
  repo_path: string;
  prompt: string;
}): McpErrorResponse | McpSuccessResponse {
  logDebug('DEPRECATED: hco_session_start — use hco_execution_submit + hco_execution_start');
  if (!state.launcher) {
    return error(ErrorCode.LAUNCHER_UNAVAILABLE, 'Launcher not available');
  }

  try {
    const { session } = state.launcher.launch({
      owner: args.owner,
      repo: args.repo,
      repoPath: args.repo_path,
      prompt: args.prompt,
    });
    return success({
      session_id: session.id,
      status: session.status,
      repo_owner: session.repoOwner,
      repo_name: session.repoName,
      repo_path: session.repoPath,
      created_at: session.createdAt,
      started_at: session.startedAt,
    });
  } catch (err: unknown) {
    const errName = err instanceof Error ? err.name : 'Error';

    if (errName === 'RepoNotAllowedError') {
      return sanitizedError(ErrorCode.REPO_NOT_ALLOWED, 'Repository is not in the allowlist.');
    }
    if (errName === 'InvalidRepoPathError') {
      return error(ErrorCode.INVALID_REPO, 'Invalid repository path.');
    }
    return sanitizedError(ErrorCode.SPAWN_FAILED, 'Claude Code process failed to start.');
  }
}

// ─── Util ────────────────────────────────────────────────────────────────────

function isTerminal(status: string): boolean {
  return (
    status === 'exited' || status === 'failed' || status === 'stopped' || status === 'archived'
  );
}

// ─── Execution submit handler ─────────────────────────────────────────────────

const EXECUTION_REQUEST_JSON_SCHEMA = z.string().min(1).max(200_000);

const EXECUTION_PROFILE_JSON_SCHEMA = z.string().min(1).max(100_000);

const EXECUTION_POLICY_JSON_SCHEMA = z.string().min(1).max(100_000);

export function handleExecutionSubmit(args: {
  request_json: string;
  profile_json: string;
  policy_json: string;
}): McpErrorResponse | McpSuccessResponse {
  let requestParsed: unknown;
  let profileParsed: unknown;
  let policyParsed: unknown;

  try {
    requestParsed = JSON.parse(args.request_json) as unknown;
  } catch {
    return error(ErrorCode.VALIDATION_ERROR, 'request_json is not valid JSON');
  }
  try {
    profileParsed = JSON.parse(args.profile_json) as unknown;
  } catch {
    return error(ErrorCode.VALIDATION_ERROR, 'profile_json is not valid JSON');
  }
  try {
    policyParsed = JSON.parse(args.policy_json) as unknown;
  } catch {
    return error(ErrorCode.VALIDATION_ERROR, 'policy_json is not valid JSON');
  }

  const request = ExecutionRequestV1.safeParse(requestParsed);
  if (!request.success) {
    return error(
      ErrorCode.VALIDATION_ERROR,
      `Invalid ExecutionRequest: ${request.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }

  const profile = ExecutionProfileV1.safeParse(profileParsed);
  if (!profile.success) {
    return error(
      ErrorCode.VALIDATION_ERROR,
      `Invalid ExecutionProfile: ${profile.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }

  const policy = PolicySnapshotV1.safeParse(policyParsed);
  if (!policy.success) {
    return error(
      ErrorCode.VALIDATION_ERROR,
      `Invalid PolicySnapshot: ${policy.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }

  try {
    const result = state.executionService.submit(request.data, profile.data, policy.data);
    return success(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ConflictingExecutionError') {
      return error(ErrorCode.VALIDATION_ERROR, err.message);
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Execution submission failed: ${msg}`);
  }
}

// ─── Execution start handler ──────────────────────────────────────────────────

export function handleExecutionStart(args: {
  execution_id: string;
}): McpErrorResponse | McpSuccessResponse {
  try {
    const result = state.executionService.start(args.execution_id);
    return success(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ExecutionLifecycleError') {
      return error(ErrorCode.INVALID_LIFECYCLE, err.message);
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Execution start failed: ${msg}`);
  }
}

// ─── Execution status handler ─────────────────────────────────────────────────

export function handleExecutionStatus(args: {
  execution_id: string;
}): McpErrorResponse | McpSuccessResponse {
  const exec = state.executionService.getStatus(args.execution_id);
  if (!exec) {
    return error(ErrorCode.VALIDATION_ERROR, `Execution "${args.execution_id}" not found`);
  }
  return success(exec);
}

// ─── Execution wait handler ───────────────────────────────────────────────────

export async function handleExecutionWait(args: {
  execution_id: string;
  timeout_ms?: number | undefined;
}): Promise<McpErrorResponse | McpSuccessResponse> {
  const result = await state.executionService.wait(args.execution_id, args.timeout_ms);
  if (!result) {
    return error(ErrorCode.VALIDATION_ERROR, `Execution "${args.execution_id}" not found`);
  }
  return success(result);
}

// ─── Execution cancel handler ─────────────────────────────────────────────────

export function handleExecutionCancel(args: {
  execution_id: string;
  reason?: string | undefined;
}): McpErrorResponse | McpSuccessResponse {
  try {
    const result = state.executionService.cancel(args.execution_id, args.reason);
    return success(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ExecutionLifecycleError') {
      return error(ErrorCode.INVALID_LIFECYCLE, err.message);
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Execution cancel failed: ${msg}`);
  }
}

// ─── Execution result handler ─────────────────────────────────────────────────

export function handleExecutionResult(args: {
  execution_id: string;
}): McpErrorResponse | McpSuccessResponse {
  try {
    const result = state.executionService.getResult(args.execution_id);
    return success(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ExecutionLifecycleError') {
      return error(ErrorCode.INVALID_LIFECYCLE, err.message);
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Execution result failed: ${msg}`);
  }
}

// ─── Artifact schemas ────────────────────────────────────────────────────────

const ARTIFACT_EXECUTION_ID_SCHEMA = z.string().min(1).max(256);
const ARTIFACT_ID_SCHEMA = z.string().min(1).max(256);
const ARTIFACT_OFFSET_SCHEMA = z.number().int().min(0).max(100_000_000).default(0);
const ARTIFACT_LIMIT_SCHEMA = z.number().int().min(1).max(65536).default(65536);

// ─── Execution artifact handler ───────────────────────────────────────────────

export function handleExecutionArtifact(args: {
  execution_id: string;
  artifact_id: string;
  offset?: number | undefined;
  limit?: number | undefined;
}): McpErrorResponse | McpSuccessResponse {
  const exec = getExecution(state.db, args.execution_id);
  if (!exec) {
    return error(ErrorCode.VALIDATION_ERROR, `Execution "${args.execution_id}" not found`);
  }

  const storage = new ArtifactStorage(state.db);

  // Validate artifact belongs to this execution via listing
  const all = storage.listArtifacts(args.execution_id);
  const meta = all.find((m) => m.artifact_id === args.artifact_id);
  if (!meta) {
    return error(
      ErrorCode.VALIDATION_ERROR,
      `Artifact "${args.artifact_id}" not found for execution "${args.execution_id}"`,
    );
  }

  const offset = args.offset ?? 0;
  if (offset >= meta.byte_length) {
    return error(
      ErrorCode.VALIDATION_ERROR,
      `Offset ${String(offset)} exceeds artifact size ${String(meta.byte_length)}`,
    );
  }

  const requestLimit = args.limit ?? 65536;
  const effectiveLimit = Math.min(requestLimit, ARTIFACT_LIMITS.maxInlineBytes);

  const raw = storage.retrieve(args.execution_id, meta.key);
  if (!raw) {
    return error(ErrorCode.VALIDATION_ERROR, `Artifact "${args.artifact_id}" data not retrievable`);
  }

  const end = Math.min(offset + effectiveLimit, raw.length);
  const chunk = raw.subarray(offset, end);
  const hasMore = end < raw.length;

  // For textual content types, ensure we don't split a UTF-8 code point
  let returnedBuf = chunk;
  if (meta.content_type.startsWith('text/') || meta.content_type === 'application/json') {
    while (returnedBuf.length > 0 && (returnedBuf[returnedBuf.length - 1] ?? 0) > 0x7f) {
      // Check if the last byte is a continuation byte (10xxxxxx)
      const b = returnedBuf[returnedBuf.length - 1] ?? 0;
      if ((b & 0xc0) === 0x80) {
        returnedBuf = returnedBuf.subarray(0, returnedBuf.length - 1);
      } else {
        break;
      }
    }
  }

  const content = returnedBuf.toString('utf-8');

  return success({
    artifact_id: meta.artifact_id,
    execution_id: args.execution_id,
    key: meta.key,
    content_type: meta.content_type,
    size_bytes: meta.byte_length,
    offset,
    returned_bytes: returnedBuf.length,
    has_more: hasMore,
    next_offset: hasMore ? offset + returnedBuf.length : null,
    content,
  });
}

// ─── Health handler ──────────────────────────────────────────────────────────

export function handleHealth(): McpSuccessResponse {
  const migrationCount = (
    state.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number }
  ).v;
  const dbSize = (
    state.db
      .prepare('SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()')
      .get() as { size: number }
  ).size;

  const execCounts: Record<string, number> = {};
  const rows = state.db
    .prepare('SELECT status, COUNT(*) AS c FROM executions GROUP BY status')
    .all() as { status: string; c: number }[];
  let total = 0;
  let terminal = 0;
  for (const r of rows) {
    execCounts[r.status] = r.c;
    total += r.c;
    if (['completed', 'failed', 'cancelled', 'timed_out', 'archived'].includes(r.status)) {
      terminal += r.c;
    }
  }

  const jobCount = (state.db.prepare('SELECT COUNT(*) AS c FROM jobs').get() as { c: number }).c;
  const sessionCount = (
    state.db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }
  ).c;

  return success({
    status: 'operational',
    uptime: process.uptime(),
    db: {
      size_bytes: dbSize,
      schema_version: migrationCount,
      migration_count: migrationCount,
    },
    executions: {
      total,
      accepted: execCounts.accepted ?? 0,
      queued: execCounts.queued ?? 0,
      running: execCounts.running ?? 0,
      awaiting_input: execCounts.awaiting_input ?? 0,
      terminal,
    },
    legacy: {
      jobs_count: jobCount,
      sessions_count: sessionCount,
    },
  });
}

// ─── Compatibility handler ───────────────────────────────────────────────────

export function handleCompatibility(): McpSuccessResponse {
  const legacyJobs = (
    state.db
      .prepare("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('pending', 'running', 'paused')")
      .get() as { c: number }
  ).c;
  const legacySessions = (
    state.db.prepare('SELECT COUNT(*) AS c FROM claude_sessions').get() as { c: number }
  ).c;
  const warnings: string[] = [];
  if (legacyJobs > 0) {
    warnings.push(`${String(legacyJobs)} legacy jobs are still in non-terminal state`);
  }
  if (legacySessions > 0) {
    warnings.push(`${String(legacySessions)} legacy claude_sessions exist`);
  }
  const canMigrate = legacyJobs === 0;
  const action = canMigrate ? 'migrate' : 'wait';

  return success({
    legacy_jobs_pending: legacyJobs,
    legacy_sessions_active: legacySessions,
    can_migrate: canMigrate,
    warnings,
    recommended_action: action,
  });
}

// ─── Provider handlers ────────────────────────────────────────────────────────

export function handleProviderRegister(args: {
  profile_json: string;
}): McpErrorResponse | McpSuccessResponse {
  let profileParsed: unknown;
  try {
    profileParsed = JSON.parse(args.profile_json) as unknown;
  } catch {
    return error(ErrorCode.VALIDATION_ERROR, 'profile_json is not valid JSON');
  }

  const profile = ProviderProfileV1.safeParse(profileParsed);
  if (!profile.success) {
    return error(
      ErrorCode.VALIDATION_ERROR,
      `Invalid ProviderProfile: ${profile.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }

  try {
    const result = state.providerService.register(profile.data);
    return success({ provider_id: result.providerId, status: result.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Provider registration failed: ${msg}`);
  }
}

export async function handleProviderValidate(args: {
  provider_id: string;
}): Promise<McpErrorResponse | McpSuccessResponse> {
  try {
    const result = await state.providerService.validate(args.provider_id);
    return success(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Provider validation failed: ${msg}`);
  }
}

export async function handleProviderModels(args: {
  provider_id: string;
}): Promise<McpErrorResponse | McpSuccessResponse> {
  try {
    const models = await state.providerService.discoverModels(args.provider_id);
    return success({ models });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Model discovery failed: ${msg}`);
  }
}

export function handleProviderMappingRecommend(args: {
  provider_id: string;
  model_ids: string[];
}): McpErrorResponse | McpSuccessResponse {
  try {
    const models = args.model_ids.map((id) => ({
      model_id: id,
      display_name: id,
      provider: 'anthropic' as const,
      capabilities: [] as string[],
    }));
    const recommendations = state.providerService.recommendMappings(args.provider_id, models);
    return success({ recommendations });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Mapping recommendation failed: ${msg}`);
  }
}

export function handleProviderActivate(args: {
  provider_id: string;
  mapping_ids: string[];
}): McpErrorResponse | McpSuccessResponse {
  try {
    const result = state.providerService.activate(args.provider_id, args.mapping_ids);
    return success({
      provider_id: result.provider.providerId,
      status: result.provider.status,
      activated_mappings: result.activated.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Provider activation failed: ${msg}`);
  }
}

export function handleProviderStatus(args: {
  provider_id: string;
}): McpErrorResponse | McpSuccessResponse {
  try {
    const status = state.providerService.getStatus(args.provider_id);
    if (!status) {
      return error(ErrorCode.VALIDATION_ERROR, `Provider "${args.provider_id}" not found`);
    }
    return success(status);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Provider status failed: ${msg}`);
  }
}

export function handleProviderRollback(args: {
  provider_id: string;
}): McpErrorResponse | McpSuccessResponse {
  try {
    const result = state.providerService.rollback(args.provider_id);
    return success({ provider_id: result.providerId, status: result.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Provider rollback failed: ${msg}`);
  }
}

export function handleProviderList(): McpErrorResponse | McpSuccessResponse {
  try {
    const providers = state.providerService.listProviders();
    return success({ providers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Provider list failed: ${msg}`);
  }
}

// ─── Execution continue handler ───────────────────────────────────────────────

export function handleExecutionContinue(args: {
  execution_id: string;
  prompt: string;
}): McpErrorResponse | McpSuccessResponse {
  try {
    const result = state.executionService.continue(args.execution_id, args.prompt);
    return success(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ExecutionLifecycleError') {
      return error(ErrorCode.INVALID_LIFECYCLE, err.message);
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return sanitizedError(ErrorCode.SPAWN_FAILED, `Execution continue failed: ${msg}`);
  }
}

// ─── Server factory ──────────────────────────────────────────────────────────

function createServerState(opts: HcoConfig | AppContext | McpOptionsWithLauncher): void {
  let db: Database.Database;
  let launcher: ClaudeLauncher | undefined;

  if ('db' in opts && 'config' in opts) {
    db = opts.db;
    launcher = undefined;
  } else if ('ctx' in opts) {
    db = opts.ctx.db;
    launcher = opts.launcher;
  } else if ('launcher' in opts) {
    if (opts.config) {
      db = openDb(opts.config.dataDir);
    } else {
      const cfg = loadConfig();
      db = openDb(cfg.dataDir);
    }
    launcher = opts.launcher;
  } else if ('dataDir' in opts) {
    db = openDb(opts.dataDir);
    launcher = undefined;
  } else {
    if (opts.config) {
      db = openDb(opts.config.dataDir);
    } else {
      const cfg = loadConfig();
      db = openDb(cfg.dataDir);
    }
    launcher = undefined;
  }

  state = {
    db,
    launcher,
    executionService: new ExecutionService(db, createAdapter()),
    providerService: new ProviderService(db),
  };
}

function createAdapter(): ClaudeCodeAdapter {
  if (process.env.HCO_ADAPTER === 'spawn') {
    return new SpawnAdapter();
  }
  return new FakeClaudeCodeAdapter();
}

function registerAllTools(server: McpServer): void {
  server.registerTool(
    'hco_status',
    {
      description: 'Get HCO system status: job counts, milestone progress, session info.',
    },
    () => ({
      content: [{ type: 'text', text: JSON.stringify(handleStatus()) }],
    }),
  );

  server.registerTool(
    'hco_list_jobs',
    {
      description: 'List jobs with optional filtering by status.',
      inputSchema: {
        status: JOB_STATUS_SCHEMA.optional().describe(
          'Filter by job status (pending, running, paused, complete, failed, cancelled)',
        ),
        limit: JOB_LIMIT_SCHEMA.optional().describe('Maximum results (1-200, default 50)'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleListJobs(args)) }],
    }),
  );

  server.registerTool(
    'hco_inspect_job',
    {
      description: 'Get full details for a specific job including validations, PRs, and approvals.',
      inputSchema: {
        external_id: EXTERNAL_ID_SCHEMA.describe('The job external ID to inspect (1-256 chars)'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleInspectJob(args)) }],
    }),
  );

  server.registerTool(
    'hco_list_milestones',
    {
      description: 'List all milestones and their status.',
    },
    () => ({
      content: [{ type: 'text', text: JSON.stringify(handleListMilestones()) }],
    }),
  );

  // ─── Lifecycle tools: H1B + H1C ───────────────────────────────────────────

  server.registerTool(
    'hco_session_list',
    {
      description: 'List Claude Code sessions with optional status filter.',
      inputSchema: {
        status: CLAUDE_SESSION_STATUS_SCHEMA.optional().describe(
          'Filter by session status (start, running, exited, failed, stopped, archived)',
        ),
        limit: SESSION_LIMIT_SCHEMA.optional().describe('Maximum results (1-200, default 50)'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleSessionList(args)) }],
    }),
  );

  server.registerTool(
    'hco_session_status',
    {
      description: 'Get full status for a Claude session including lifecycle event log.',
      inputSchema: {
        session_id: SESSION_ID_SCHEMA.describe('The session ID to inspect'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleSessionStatus(args)) }],
    }),
  );

  server.registerTool(
    'hco_session_wait',
    {
      description:
        'Wait for a Claude session to reach a terminal state (exited/failed/stopped/archived).',
      inputSchema: {
        session_id: SESSION_ID_SCHEMA.describe('The session ID to wait for'),
        timeout_ms: SESSION_TIMEOUT_MS_SCHEMA.optional().describe(
          'Optional timeout in milliseconds (1-3600000)',
        ),
      },
    },
    async (args) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleSessionWait(args)) }],
    }),
  );

  server.registerTool(
    'hco_session_stop',
    {
      description: 'Abort a running Claude session by session ID.',
      inputSchema: {
        session_id: SESSION_ID_SCHEMA.describe('The session ID to abort'),
        reason: SESSION_REASON_SCHEMA.optional().describe(
          'Optional reason for stopping (1-1024 chars)',
        ),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleSessionStop(args)) }],
    }),
  );

  server.registerTool(
    'hco_session_archive',
    {
      description: 'Archive a terminal session — marks output for preservation.',
      inputSchema: {
        session_id: SESSION_ID_SCHEMA.describe('The terminal session ID to archive'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleSessionArchive(args)) }],
    }),
  );

  server.registerTool(
    'hco_session_start',
    {
      description:
        'Launch a new Claude Code session in an allowlisted repository. ' +
        'Uses configured Claude binary, bounded prompt, validated repo, and durable session record.',
      inputSchema: {
        owner: OWNER_SCHEMA.describe('Repository owner (must be in allowlist)'),
        repo: REPO_SCHEMA.describe('Repository name (must be in allowlist)'),
        repo_path: REPO_PATH_SCHEMA.describe('Absolute local filesystem path to the repository'),
        prompt: PROMPT_SCHEMA.describe(
          'Initial prompt for Claude Code (1-65536 chars). No secrets in prompts.',
        ),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleSessionStart(args)) }],
    }),
  );

  server.registerTool(
    'hco_task_start',
    {
      description: 'Start a durable Claude Code task using safe session controls.',
      inputSchema: {
        owner: OWNER_SCHEMA,
        repo: REPO_SCHEMA,
        repo_path: REPO_PATH_SCHEMA,
        prompt: PROMPT_SCHEMA,
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleSessionStart(args)) }],
    }),
  );

  // ─── Provider tools: 2.1-A4 ──────────────────────────────────────────────

  const PROVIDER_ID_SCHEMA = z.string().min(1).max(256);

  server.registerTool(
    'hco_provider_register',
    {
      description: 'Register a new provider profile. Persists the provider with status "registered".',
      inputSchema: {
        profile_json: z
          .string()
          .min(1)
          .max(65536)
          .describe('JSON string of the ProviderProfile v1 contract'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleProviderRegister(args)) }],
    }),
  );

  server.registerTool(
    'hco_provider_validate',
    {
      description:
        'Validate a provider: verify credentials, discover available models. Transitions registered → validated or failed.',
      inputSchema: {
        provider_id: PROVIDER_ID_SCHEMA.describe('The provider ID to validate'),
      },
    },
    async (args) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleProviderValidate(args)) }],
    }),
  );

  server.registerTool(
    'hco_provider_models',
    {
      description: 'List available models from a provider via API discovery.',
      inputSchema: {
        provider_id: PROVIDER_ID_SCHEMA.describe('The provider ID to query'),
      },
    },
    async (args) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleProviderModels(args)) }],
    }),
  );

  server.registerTool(
    'hco_provider_mapping_recommend',
    {
      description:
        'Recommend HCO role mappings for provider models based on model name heuristics.',
      inputSchema: {
        provider_id: PROVIDER_ID_SCHEMA.describe('The provider ID'),
        model_ids: z
          .array(z.string().min(1).max(256))
          .min(0)
          .max(200)
          .describe('Provider model IDs to map'),
      },
    },
    (args) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(handleProviderMappingRecommend(args)),
        },
      ],
    }),
  );

  server.registerTool(
    'hco_provider_activate',
    {
      description:
        'Activate a validated provider and mark selected mappings as active. Transitions validated → active.',
      inputSchema: {
        provider_id: PROVIDER_ID_SCHEMA.describe('The provider ID to activate'),
        mapping_ids: z
          .array(z.string().min(1).max(256))
          .min(0)
          .max(200)
          .describe('Mapping IDs to activate'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleProviderActivate(args)) }],
    }),
  );

  server.registerTool(
    'hco_provider_status',
    {
      description: 'Get full status of a provider: state, models, and mappings.',
      inputSchema: {
        provider_id: PROVIDER_ID_SCHEMA.describe('The provider ID to query'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleProviderStatus(args)) }],
    }),
  );

  server.registerTool(
    'hco_provider_list',
    {
      description: 'List all registered providers with their current status.',
    },
    () => ({
      content: [{ type: 'text', text: JSON.stringify(handleProviderList()) }],
    }),
  );

  server.registerTool(
    'hco_provider_rollback',
    {
      description: 'Rollback a provider to failed status. Transitions active/validated → failed.',
      inputSchema: {
        provider_id: PROVIDER_ID_SCHEMA.describe('The provider ID to rollback'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleProviderRollback(args)) }],
    }),
  );

  // ─── Execution tools: 2.0-A3 ───────────────────────────────────────────

  server.registerTool(
    'hco_execution_submit',
    {
      description:
        'Submit a new execution request. Persists the execution durably and returns the execution ID. Does NOT launch Claude Code.',
      inputSchema: {
        request_json: EXECUTION_REQUEST_JSON_SCHEMA.describe(
          'JSON string of the ExecutionRequest v1 contract',
        ),
        profile_json: EXECUTION_PROFILE_JSON_SCHEMA.describe(
          'JSON string of the ExecutionProfile v1 contract',
        ),
        policy_json: EXECUTION_POLICY_JSON_SCHEMA.describe(
          'JSON string of the PolicySnapshot v1 contract',
        ),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleExecutionSubmit(args)) }],
    }),
  );

  // Phase 3 execution lifecycle tools

  server.registerTool(
    'hco_execution_start',
    {
      description: 'Start a previously submitted execution. Transitions accepted to running.',
      inputSchema: {
        execution_id: EXECUTION_ID_SCHEMA.describe('The execution ID to start'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleExecutionStart(args)) }],
    }),
  );

  server.registerTool(
    'hco_execution_status',
    {
      description: 'Get current status and metadata for an execution.',
      inputSchema: {
        execution_id: EXECUTION_ID_SCHEMA.describe('The execution ID to query'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleExecutionStatus(args)) }],
    }),
  );

  server.registerTool(
    'hco_execution_wait',
    {
      description: 'Wait for an execution to reach a terminal state.',
      inputSchema: {
        execution_id: EXECUTION_ID_SCHEMA.describe('The execution ID to wait for'),
        timeout_ms: EXECUTION_TIMEOUT_MS_SCHEMA.describe('Optional timeout (1-3600000 ms)'),
      },
    },
    async (args) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleExecutionWait(args)) }],
    }),
  );

  server.registerTool(
    'hco_execution_cancel',
    {
      description: 'Cancel a running, queued, or awaiting_input execution.',
      inputSchema: {
        execution_id: EXECUTION_ID_SCHEMA.describe('The execution ID to cancel'),
        reason: EXECUTION_REASON_SCHEMA.describe('Optional reason (1-1024 chars)'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleExecutionCancel(args)) }],
    }),
  );

  server.registerTool(
    'hco_execution_result',
    {
      description: 'Get the structured ExecutionResult for a terminal execution.',
      inputSchema: {
        execution_id: EXECUTION_ID_SCHEMA.describe('The execution ID to get results for'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleExecutionResult(args)) }],
    }),
  );

  server.registerTool(
    'hco_execution_artifact',
    {
      description:
        'Retrieve a stored execution artifact by artifact ID. Returns chunked content with offset/limit.',
      inputSchema: {
        execution_id: ARTIFACT_EXECUTION_ID_SCHEMA.describe(
          'The execution ID that owns the artifact',
        ),
        artifact_id: ARTIFACT_ID_SCHEMA.describe('The artifact ID to retrieve'),
        offset: ARTIFACT_OFFSET_SCHEMA.describe('Byte offset (0-based, default 0)'),
        limit: ARTIFACT_LIMIT_SCHEMA.describe('Max bytes to return (1-65536, default 65536)'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleExecutionArtifact(args)) }],
    }),
  );

  server.registerTool(
    'hco_execution_continue',
    {
      description: 'Resume an execution paused at awaiting_input with a continuation prompt.',
      inputSchema: {
        execution_id: EXECUTION_ID_SCHEMA.describe('The execution ID to continue'),
        prompt: CONTINUE_PROMPT_SCHEMA.describe('Continuation prompt (1-65536 chars)'),
      },
    },
    (args) => ({
      content: [{ type: 'text', text: JSON.stringify(handleExecutionContinue(args)) }],
    }),
  );

  // ─── Health + compatibility tools ────────────────────────────────────────

  server.registerTool(
    'hco_health',
    {
      description: 'Get HCO system health: DB stats, execution counts, and uptime.',
    },
    () => ({
      content: [{ type: 'text', text: JSON.stringify(handleHealth()) }],
    }),
  );

  server.registerTool(
    'hco_compatibility',
    {
      description:
        'Check readiness for v1-to-v2 migration. Reports legacy jobs, sessions, and recommended action.',
    },
    () => ({
      content: [{ type: 'text', text: JSON.stringify(handleCompatibility()) }],
    }),
  );
}

// ─── Create server (exported for tests) ──────────────────────────────────────

interface McpOptionsWithLauncher {
  config?: HcoConfig;
  ctx?: AppContext;
  launcher?: ClaudeLauncher;
}

export function createMcpServer(
  opts: HcoConfig | AppContext | McpOptionsWithLauncher,
): Promise<McpServer> {
  createServerState(opts);
  const server = new McpServer(
    { name: 'hco-mcp', version: '2.0.0' },
    { capabilities: { tools: {} } },
  );
  registerAllTools(server);
  return Promise.resolve(server);
}

export async function startMcpServer(
  opts: HcoConfig | AppContext | McpOptionsWithLauncher,
  transport?: Transport,
): Promise<McpServer> {
  const server = await createMcpServer(opts);
  const t = transport ?? new StdioServerTransport();
  await server.connect(t);
  return server;
}

// ─── Export for test injection ───────────────────────────────────────────────

export function _testSetState(s: ServerState): void {
  state = s;
}
