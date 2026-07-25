import type { ChildProcess } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { ExecutionRow } from '../state/execution-repository.js';
import type { ExecutionProfileV1 } from '../contract/execution-profile.js';
import { ExecutionRequestV1 } from '../contract/execution-request.js';
import type { PolicySnapshotV1 } from '../contract/policy-snapshot.js';
import type { ProcessRunner, RunOptions } from './runner.js';
import { SpawnRunner } from './runner.js';
import { filterEnv } from './launcher.js';

// ─── ProcessAttempt ───────────────────────────────────────────────────────────

export interface ProcessAttempt {
  id: string;
  executionId: string;
  attemptNumber: number;
  pid: number | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  signal?: 'awaiting_input' | 'completed' | 'error';
}

// ─── ClaudeCodeAdapter interface ─────────────────────────────────────────────

export interface ClaudeCodeAdapter {
  launch(
    execution: ExecutionRow,
    profile: ExecutionProfileV1,
    onExit: (attempt: ProcessAttempt) => void,
  ): ProcessAttempt;

  attach(executionId: string): ProcessAttempt | null;

  abort(executionId: string): void;

  sendInput?(executionId: string, prompt: string): void;
}

// ─── Fake adapter options ──────────────────────────────────────────────────

export interface FakeAdapterOptions {
  /** Number of times to emit awaiting_input before finally completing. 0 (default) means never. */
  awaitingInputCount?: number;
}

// ─── Fake adapter (tests only) ──────────────────────────────────────────────

export class FakeClaudeCodeAdapter implements ClaudeCodeAdapter {
  private attempts = new Map<string, ProcessAttempt>();
  private processes = new Map<string, ChildProcess>();
  private attemptCounters = new Map<string, number>();
  private onExitCallbacks = new Map<string, (attempt: ProcessAttempt) => void>();
  private awaitingInputSeen = new Map<string, number>();
  private readonly opts: FakeAdapterOptions;

  constructor(opts?: FakeAdapterOptions) {
    this.opts = opts ?? {};
  }

  launch(
    execution: ExecutionRow,
    _profile: ExecutionProfileV1,
    onExit: (attempt: ProcessAttempt) => void,
  ): ProcessAttempt {
    const counter = (this.attemptCounters.get(execution.executionId) ?? 0) + 1;
    this.attemptCounters.set(execution.executionId, counter);

    const attempt: ProcessAttempt = {
      id: `attempt-${execution.executionId}-${String(counter)}`,
      executionId: execution.executionId,
      attemptNumber: counter,
      pid: 1000 + counter,
      startedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      finishedAt: null,
      exitCode: null,
      timedOut: false,
      aborted: false,
    };

    this.attempts.set(execution.executionId, attempt);
    this.onExitCallbacks.set(execution.executionId, onExit);

    if (!this.awaitingInputSeen.has(execution.executionId)) {
      this.awaitingInputSeen.set(execution.executionId, 0);
    }

    // Simulate a process handle
    this.processes.set(execution.executionId, {
      kill: () => {
        attempt.aborted = true;
        this.processes.delete(execution.executionId);
      },
    } as unknown as ChildProcess);

    // Fire onExit asynchronously with a small delay to simulate real process
    setImmediate(() => {
      this.completeAttempt(execution.executionId);
    });

    return attempt;
  }

  private completeAttempt(executionId: string): void {
    const current = this.attempts.get(executionId);
    const onExit = this.onExitCallbacks.get(executionId);
    if (!current || !onExit) return;

    const count = this.opts.awaitingInputCount ?? 0;
    const seen = this.awaitingInputSeen.get(executionId) ?? 0;

    if (count > 0 && seen < count && !current.aborted) {
      current.signal = 'awaiting_input';
      this.awaitingInputSeen.set(executionId, seen + 1);
      onExit(current);
      return;
    }

    current.finishedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    if (current.aborted) {
      current.exitCode = -1;
      onExit(current);
      this.attempts.delete(executionId);
      this.processes.delete(executionId);
      this.onExitCallbacks.delete(executionId);
      return;
    }
    current.exitCode = 0;
    current.signal = 'completed';
    onExit(current);
    this.attempts.delete(executionId);
    this.processes.delete(executionId);
    this.onExitCallbacks.delete(executionId);
  }

  attach(executionId: string): ProcessAttempt | null {
    if (this.processes.has(executionId)) {
      return this.attempts.get(executionId) ?? null;
    }
    return null;
  }

  abort(executionId: string): void {
    const process = this.processes.get(executionId);
    if (process) {
      process.kill();
    }
  }

  sendInput(executionId: string, _prompt: string): void {
    const attempt = this.attempts.get(executionId);
    const onExit = this.onExitCallbacks.get(executionId);
    if (!attempt || !onExit) return;

    // Reset signal and fire completeAttempt again — it will check
    // awaitingInputSeen vs awaitingInputCount
    delete attempt.signal;
    this.completeAttempt(executionId);
  }
}

// ─── Repository path validation (reused from launcher contract) ─────────────

function validateRepositoryPath(raw: string): string {
  if (!isAbsolute(raw)) {
    throw new Error(`repository_not_found: "${raw}" is not an absolute path`);
  }
  if (!existsSync(raw)) {
    throw new Error(`repository_not_found: "${raw}" does not exist`);
  }
  if (!lstatSync(raw).isDirectory()) {
    throw new Error(`repository_not_found: "${raw}" is not a directory`);
  }
  const real = realpathSync(raw);
  return real;
}

// ─── Binary resolution ──────────────────────────────────────────────────────

function resolveBinary(profile: ExecutionProfileV1): string {
  if (profile.claude_defaults.binary_path) {
    return profile.claude_defaults.binary_path;
  }
  if (process.env.CLAUDE_BIN) {
    return process.env.CLAUDE_BIN;
  }
  return 'claude';
}

// ─── Spawn adapter (real Claude Code) ───────────────────────────────────────

export class SpawnAdapter implements ClaudeCodeAdapter {
  private runner: ProcessRunner;
  private attempts = new Map<string, ProcessAttempt>();
  private processes = new Map<string, ChildProcess>();

  constructor(runner?: ProcessRunner) {
    this.runner = runner ?? new SpawnRunner();
  }

  launch(
    execution: ExecutionRow,
    profile: ExecutionProfileV1,
    onExit: (attempt: ProcessAttempt) => void,
  ): ProcessAttempt {
    const executionId = execution.executionId;

    const attempt: ProcessAttempt = {
      id: `attempt-${executionId}-1`,
      executionId,
      attemptNumber: 1,
      pid: null,
      startedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      finishedAt: null,
      exitCode: null,
      timedOut: false,
      aborted: false,
    };

    this.attempts.set(executionId, attempt);

    // Validate request through the canonical contract
    let requestJson: unknown;
    try {
      requestJson = JSON.parse(execution.requestJson);
    } catch {
      attempt.signal = 'error';
      attempt.finishedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      attempt.exitCode = -1;
      setImmediate(() => {
	        onExit(attempt);
	      });
      return attempt;
    }

    const parsed = ExecutionRequestV1.safeParse(requestJson);
    if (!parsed.success) {
      attempt.signal = 'error';
      attempt.finishedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      attempt.exitCode = -1;
      setImmediate(() => {
	        onExit(attempt);
	      });
      return attempt;
    }

    const request = parsed.data;

    // Validate repository path
    let cwd: string;
    try {
      cwd = validateRepositoryPath(request.repository.path);
    } catch {
      attempt.signal = 'error';
      attempt.finishedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      attempt.exitCode = -1;
      setImmediate(() => {
	        onExit(attempt);
	      });
      return attempt;
    }

    // Validate against policy boundary
    let policy: PolicySnapshotV1 | undefined;
    try {
      const raw = JSON.parse(execution.policySnapshotJson) as unknown;
      if (raw && typeof raw === 'object') {
        policy = raw as PolicySnapshotV1;
      }
    } catch {
      // policy not parseable — allow through (boundary check is defense-in-depth)
    }

    if (policy?.repository_boundary.local_path) {
      const boundaryReal = realpathSync(policy.repository_boundary.local_path);
      if (!cwd.startsWith(boundaryReal)) {
        attempt.signal = 'error';
        attempt.finishedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
        attempt.exitCode = -1;
        setImmediate(() => {
	        onExit(attempt);
	      });
        return attempt;
      }
    }

    // Resolve binary: profile → CLAUDE_BIN → 'claude'
    const binaryPath = resolveBinary(profile);
    const sessionDir = profile.claude_defaults.session_dir;

    const prompt = request.brief.original_request;

    const args: string[] = [];
    if (prompt) {
      args.push('-p', prompt);
    }

    const envAllowlist = profile.environment_allowlist ?? [];
    const envFiltered = envAllowlist.length > 0 ? filterEnv(envAllowlist) : {};

    const runOpts: RunOptions = {
      sessionId: executionId,
      cwd,
      env: envFiltered,
      timeoutMs: profile.claude_defaults.default_timeout_ms,
      outputDir: sessionDir,
    };

    const child = this.runner.run(binaryPath, args, runOpts, (result) => {
      const current = this.attempts.get(executionId);
      if (!current) return;

      current.finishedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      current.exitCode = result.exitCode;
      current.timedOut = result.timedOut;
      current.aborted = result.aborted;
      onExit(current);
      this.attempts.delete(executionId);
      this.processes.delete(executionId);
    });

    attempt.pid = child.pid ?? null;
    this.processes.set(executionId, child);

    return attempt;
  }

  attach(_executionId: string): ProcessAttempt | null {
    return null;
  }

  abort(executionId: string): void {
    const process = this.processes.get(executionId);
    const attempt = this.attempts.get(executionId);
    if (process) {
      if (attempt) {
        attempt.aborted = true;
      }
      this.runner.abort(process);
    }
  }
}
