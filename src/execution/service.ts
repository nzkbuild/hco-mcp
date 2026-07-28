import type Database from 'better-sqlite3';
import type { ExecutionRequestV1 } from '../contract/execution-request.js';
import type { ExecutionProfileV1 } from '../contract/execution-profile.js';
import type { PolicySnapshotV1 } from '../contract/policy-snapshot.js';
import { ExecutionResultV1 } from '../contract/execution-result.js';
import {
  createExecution,
  getExecution,
  transitionToQueued,
  transitionToRunning,
  transitionToCompleted,
  transitionToFailed,
  transitionToCancelled,
  transitionToTimedOut,
  transitionToAwaitingInput,
  isTerminal,
  createProcessAttempt,
  finishProcessAttempt,
  getLatestProcessAttempt,
} from '../state/execution-repository.js';
import type { ExecutionRow } from '../state/execution-repository.js';
import type { ClaudeCodeAdapter } from '../claude/adapter.js';
import { runValidation } from '../validation/runner.js';
import { getValidationProfile } from '../validation/profile.js';
import { logDebug } from '../mcp/logging.js';

// ─── Submit result ─────────────────────────────────────────────────────────

export interface SubmitResult {
  execution_id: string;
  status: string;
  accepted_at: string;
}

// ─── Error types ───────────────────────────────────────────────────────────

export class ExecutionLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionLifecycleError';
  }
}

// ─── ExecutionService ──────────────────────────────────────────────────────

export class ExecutionService {
  constructor(
    private readonly db: Database.Database,
    private readonly adapter: ClaudeCodeAdapter,
  ) {}

  submit(
    request: ExecutionRequestV1,
    profile: ExecutionProfileV1,
    policy: PolicySnapshotV1,
  ): SubmitResult {
    logDebug(`ExecutionService.submit: request_id=${request.request_id}`);

    const exec = createExecution(this.db, request, profile, policy);

    return {
      execution_id: exec.executionId,
      status: exec.status,
      accepted_at: exec.createdAt,
    };
  }

  start(executionId: string): ExecutionRow {
    const exec = getExecution(this.db, executionId);
    if (!exec) {
      throw new ExecutionLifecycleError(`Execution "${executionId}" not found`);
    }
    if (exec.status !== 'accepted') {
      throw new ExecutionLifecycleError(
        `Cannot start execution "${executionId}" in status "${exec.status}" (expected "accepted")`,
      );
    }

    transitionToQueued(this.db, executionId);
    const running = transitionToRunning(this.db, executionId);
    if (!running) {
      throw new ExecutionLifecycleError(`Failed to transition "${executionId}" to running`);
    }

    const profile = JSON.parse(running.profileSnapshotJson) as ExecutionProfileV1;

    // Validate overrides against ExecutionProfile.allowed_overrides
    const request = JSON.parse(running.requestJson) as ExecutionRequestV1;
    const overrides = request.claude_config.overrides;
    if (overrides) {
      const allowed = profile.allowed_overrides;
      const overrideKeys = Object.keys(overrides).filter(
        (k) => overrides[k as keyof typeof overrides] !== undefined,
      );
      for (const key of overrideKeys) {
        if (!allowed.includes(key)) {
          throw new ExecutionLifecycleError(
            `Override "${key}" is not in the allowed overrides list for profile "${profile.profile_id}"`,
          );
        }
      }
    }

    const latest = getLatestProcessAttempt(this.db, executionId);
    const nextNumber = latest ? latest.attemptNumber + 1 : 1;
    const attemptId = `attempt-${executionId}-${String(nextNumber)}`;

    const persistedAttempt = createProcessAttempt(
      this.db,
      attemptId,
      executionId,
      nextNumber,
      null,
    );

    const currentAttemptId = persistedAttempt.attemptId;

    const onExit = (attempt: ReturnType<ClaudeCodeAdapter['launch']>): void => {
      logDebug(`ExecutionService.onExit: ${executionId} exitCode=${String(attempt.exitCode)}`);

      if (attempt.signal === 'awaiting_input') {
        transitionToAwaitingInput(this.db, executionId);
        return;
      }

      finishProcessAttempt(
        this.db,
        currentAttemptId,
        attempt.exitCode ?? -1,
        attempt.timedOut,
        attempt.aborted,
      );

      if (attempt.aborted) {
        return;
      }
      if (attempt.timedOut) {
        transitionToTimedOut(this.db, executionId);
        return;
      }
      if (attempt.exitCode === 0) {
        transitionToCompleted(this.db, executionId, attempt.exitCode);
        void this.runPostValidation(executionId, request, profile).catch((err: unknown) => {
          logDebug(`ExecutionService.runPostValidation unhandled: ${String(err)}`);
        });
      } else {
        transitionToFailed(
          this.db,
          executionId,
          `Process exited with code ${String(attempt.exitCode)}`,
        );
      }
    };

    const adapterAttempt = this.adapter.launch(running, profile, onExit);

    if (adapterAttempt.pid !== null) {
      this.db
        .prepare('UPDATE process_attempts SET pid = ? WHERE attempt_id = ?')
        .run(adapterAttempt.pid, persistedAttempt.attemptId);
    }

    return getExecution(this.db, executionId) ?? running;
  }

  private async runPostValidation(
    executionId: string,
    request: ExecutionRequestV1,
    profile: ExecutionProfileV1,
  ): Promise<void> {
    if (!profile.validation_defaults?.post_execution) return;
    const validationProfile = request.claude_config.validation_profile;
    if (!validationProfile) return;

    try {
      const profile = getValidationProfile(validationProfile);
      const cwd = request.repository.path;
      const result = await runValidation(profile, cwd);

      this.db
        .prepare('INSERT INTO execution_events (execution_id, type, payload) VALUES (?, ?, ?)')
        .run(
          executionId,
          'validation_ran',
          JSON.stringify({
            profile: result.profile,
            passed: result.passed,
            command_results: result.results.map((r) => ({
              command: r.command,
              args: r.args,
              exitCode: r.exitCode,
              stdout: r.stdout.slice(0, 1024),
              stderr: r.stderr.slice(0, 1024),
              timedOut: r.timedOut,
              error: r.error,
            })),
            error: result.error,
          }),
        );

      if (!result.passed) {
        transitionToFailed(this.db, executionId, result.error ?? 'Validation failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      transitionToFailed(this.db, executionId, `Validation error: ${msg}`);
    }
  }

  cancel(executionId: string, reason?: string): ExecutionRow {
    const exec = getExecution(this.db, executionId);
    if (!exec) {
      throw new ExecutionLifecycleError(`Execution "${executionId}" not found`);
    }
    if (
      exec.status !== 'accepted' &&
      exec.status !== 'queued' &&
      exec.status !== 'running' &&
      exec.status !== 'awaiting_input'
    ) {
      throw new ExecutionLifecycleError(
        `Cannot cancel execution "${executionId}" in status "${exec.status}"`,
      );
    }

    if (exec.status === 'running' || exec.status === 'awaiting_input') {
      this.adapter.abort(executionId);
    }

    const result = transitionToCancelled(this.db, executionId, reason ?? 'Cancelled');
    if (!result) {
      throw new ExecutionLifecycleError(`Failed to cancel execution "${executionId}"`);
    }
    return result;
  }

  getStatus(executionId: string): ExecutionRow | null {
    return getExecution(this.db, executionId);
  }

  getResult(executionId: string): ReturnType<typeof ExecutionResultV1.parse> {
    const exec = getExecution(this.db, executionId);
    if (!exec) {
      throw new ExecutionLifecycleError(`Execution "${executionId}" not found`);
    }
    if (!isTerminal(exec.status)) {
      throw new ExecutionLifecycleError(
        `Cannot get result for execution "${executionId}" in non-terminal status "${exec.status}"`,
      );
    }

    const events = this.db
      .prepare('SELECT * FROM execution_events WHERE execution_id = ? ORDER BY id')
      .all(executionId) as Record<string, unknown>[];

    const startedEvent = events.find((e) => e.type === 'started');
    const finishedEvent = events.find((e) =>
      ['completed', 'failed', 'cancelled', 'timed_out'].includes(e.type as string),
    );
    const createdEvent = events.find((e) => e.type === 'created');
    let hermesTraceId: string | undefined;
    if (createdEvent) {
      try {
        const payload = JSON.parse(createdEvent.payload as string) as Record<string, unknown>;
        if (typeof payload.hermes_trace_id === 'string') {
          hermesTraceId = payload.hermes_trace_id;
        }
      } catch {
        // ignore parse errors
      }
    }

    const validationEvent = events.find((e) => e.type === 'validation_ran');
    let validationResults: Record<string, unknown>[] | undefined;
    if (validationEvent) {
      try {
        const payload = JSON.parse(validationEvent.payload as string) as Record<string, unknown>;
        const profile = typeof payload.profile === 'string' ? payload.profile : '';
        const passed = typeof payload.passed === 'boolean' ? payload.passed : false;
        const commandResults = Array.isArray(payload.command_results)
          ? (payload.command_results as Record<string, unknown>[]).map((cr) => ({
              command: typeof cr.command === 'string' ? cr.command : '',
              exit_code: typeof cr.exitCode === 'number' ? cr.exitCode : -1,
              passed: cr.exitCode === 0,
            }))
          : [];
        validationResults = [{ profile, passed, command_results: commandResults }];
      } catch {
        // ignore parse errors
      }
    }

    return ExecutionResultV1.parse({
      execution_id: exec.executionId,
      status: exec.status,
      claude_session_id: exec.executionId,
      summary: {
        exit_code: 0,
        duration_ms: 0,
        artifacts: [],
      },
      validation_results: validationResults,
      submitted_at: exec.createdAt,
      started_at: startedEvent?.recorded_at ?? null,
      finished_at: finishedEvent?.recorded_at ?? exec.updatedAt,
      hermes_trace_id: hermesTraceId,
    });
  }

  async wait(executionId: string, timeoutMs?: number): Promise<ExecutionRow | null> {
    const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
    const pollMs = 200;

    for (;;) {
      const s = getExecution(this.db, executionId);
      if (!s) return null;

      if (isTerminal(s.status)) {
        return s;
      }

      if (deadline !== undefined && Date.now() >= deadline) {
        return s;
      }

      const attached = this.adapter.attach(executionId);
      if (attached) {
        // Process is still alive — wait for it
        await new Promise<void>((resolve) => {
          setTimeout(resolve, pollMs);
        });
      } else {
        // No live process — just poll DB
        await new Promise((r) => setTimeout(r, pollMs));
      }
    }
  }

  continue(executionId: string, prompt: string): ExecutionRow {
    const exec = getExecution(this.db, executionId);
    if (!exec) {
      throw new ExecutionLifecycleError(`Execution "${executionId}" not found`);
    }
    if (exec.status !== 'awaiting_input') {
      throw new ExecutionLifecycleError(
        `Cannot continue execution "${executionId}" in status "${exec.status}" (expected "awaiting_input")`,
      );
    }

    if (!this.adapter.sendInput) {
      throw new ExecutionLifecycleError('Adapter does not support sendInput');
    }

    const running = transitionToRunning(this.db, executionId);
    if (!running) {
      throw new ExecutionLifecycleError(
        `Failed to transition "${executionId}" from awaiting_input to running`,
      );
    }

    this.adapter.sendInput(executionId, prompt);

    return running;
  }
}
