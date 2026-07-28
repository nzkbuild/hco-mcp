import { randomUUID } from 'node:crypto';
import { openDb } from '../state/db.js';
import { createExecution } from '../state/execution-repository.js';
import { ExecutionRequestV1 } from '../contract/execution-request.js';
import { ExecutionProfileV1 } from '../contract/execution-profile.js';
import { PolicySnapshotV1 } from '../contract/policy-snapshot.js';
import { createProcessAttempt } from '../state/execution-repository.js';
import type { ExecutionRequestV1 as ExecutionRequestV1Type } from '../contract/execution-request.js';

interface MigrationOptions {
  dataDir: string;
  dryRun: boolean;
}

interface MigrationResult {
  jobsScanned: number;
  sessionsScanned: number;
  executionsCreated: number;
  attemptsCreated: number;
  errors: string[];
}

function buildExecutionRequestFromLegacyJob(
  job: Record<string, unknown>,
): ExecutionRequestV1Type | null {
  try {
    const input = JSON.parse(job.input as string) as Record<string, unknown>;
    const repoPath =
      (typeof input.path === 'string' ? input.path : '/tmp') ||
      (typeof input.repo_path === 'string' ? input.repo_path : '/tmp');
    const owner = typeof input.owner === 'string' ? input.owner : 'unknown';
    const repo = typeof input.repo === 'string' ? input.repo : 'unknown';
    const prompt =
      typeof input.prompt === 'string'
        ? input.prompt
        : typeof input.original_request === 'string'
          ? input.original_request
          : 'legacy job';

    return ExecutionRequestV1.parse({
      brief: {
        original_request: prompt,
        objective: prompt.slice(0, 256),
        context: `Migrated from legacy job ${job.external_id as string}`,
        constraints: [],
        acceptance_criteria: [],
        requested_validation: [],
      },
      claude_config: {},
      repository: {
        owner,
        repo,
        path:
          repoPath.startsWith('/') || /^[A-Za-z]:[/\\]/.test(repoPath) ? repoPath : `/${repoPath}`,
      },
      policy_ref: `migrated-legacy-${String(job.id)}`,
    });
  } catch {
    return null;
  }
}

function buildDefaultProfile(): ReturnType<typeof ExecutionProfileV1.parse> {
  return ExecutionProfileV1.parse({
    profile_id: 'migrated-default',
    claude_defaults: {
      binary_path: 'claude',
      default_timeout_ms: 600_000,
      session_dir: '/tmp/hco-claude',
    },
    repository_allowlist: [{ owner: 'unknown', repo: 'unknown' }],
    validation_defaults: {
      post_execution: false,
    },
  });
}

function buildDefaultPolicy(): ReturnType<typeof PolicySnapshotV1.parse> {
  return PolicySnapshotV1.parse({
    repository_boundary: {
      owner: 'unknown',
      repo: 'unknown',
      local_path: '/tmp',
    },
    permission_limits: {
      allowed_tools: ['Read', 'Write', 'Edit', 'Bash'],
      deny_shell_access: true,
    },
    timeout_ceiling_ms: 3_600_000,
    max_concurrency: 1,
    approval_required: false,
  });
}

export function migrateV1toV2(opts: MigrationOptions): MigrationResult {
  const result: MigrationResult = {
    jobsScanned: 0,
    sessionsScanned: 0,
    executionsCreated: 0,
    attemptsCreated: 0,
    errors: [],
  };

  const db = openDb(opts.dataDir);

  // 1. Scan legacy jobs in non-terminal state
  const jobs = db
    .prepare("SELECT * FROM jobs WHERE status IN ('pending', 'running', 'paused')")
    .all() as Record<string, unknown>[];

  result.jobsScanned = jobs.length;

  const defaultProfile = buildDefaultProfile();
  const defaultPolicy = buildDefaultPolicy();

  for (const job of jobs) {
    const execRequest = buildExecutionRequestFromLegacyJob(job);
    if (!execRequest) {
      result.errors.push(`Failed to parse job ${String(job.id)} (${String(job.external_id)})`);
      continue;
    }

    if (opts.dryRun) {
      result.executionsCreated++;
      continue;
    }

    try {
      createExecution(db, execRequest, defaultProfile, defaultPolicy);
      result.executionsCreated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(`Failed to create execution for job ${String(job.id)}: ${msg}`);
    }
  }

  // 2. Scan legacy claude_sessions and map to ProcessAttempts
  const sessions = db.prepare('SELECT * FROM claude_sessions').all() as Record<string, unknown>[];

  result.sessionsScanned = sessions.length;

  for (const session of sessions) {
    const sessionId = session.id as string;
    // Check if this session already has an execution
    const existingExec = db
      .prepare('SELECT execution_id FROM executions WHERE execution_id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!existingExec) {
      // Session without corresponding execution — skip for now
      continue;
    }

    if (opts.dryRun) {
      result.attemptsCreated++;
      continue;
    }

    try {
      const attemptId = `attempt-${randomUUID()}`;
      const pid = typeof session.pid === 'number' ? session.pid : null;
      createProcessAttempt(db, attemptId, sessionId, 1, pid);
      result.attemptsCreated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push(
        `Failed to create ProcessAttempt for session ${session.id as string}: ${msg}`,
      );
    }
  }

  db.close();
  return result;
}

// ─── CLI entrypoint ──────────────────────────────────────────────────────────

export function runMigrationCli(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  let dataDir = '/tmp/hco-data';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) {
      dataDir = args[i + 1] ?? dataDir;
    }
  }

  const result = migrateV1toV2({ dataDir, dryRun });

  if (dryRun) {
    console.log('[DRY RUN] No changes were made.');
  }
  console.log(`Jobs scanned:         ${String(result.jobsScanned)}`);
  console.log(`Sessions scanned:     ${String(result.sessionsScanned)}`);
  console.log(`Executions created:   ${String(result.executionsCreated)}`);
  console.log(`Attempts created:     ${String(result.attemptsCreated)}`);
  console.log(`Errors:               ${String(result.errors.length)}`);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
  }
}
