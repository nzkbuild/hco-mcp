import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { AppContext } from '../core/context.js';
import type { ProcessRunner } from './runner.js';
import { SpawnRunner } from './runner.js';
import {
  createSession,
  transitionToRunning,
  transitionToExited,
  transitionToFailed,
  transitionToStopped,
  transitionToArchived,
  setSessionOutputs,
  setSessionPid,
  appendSessionEvent,
  getSession,
  type ClaudeSession,
} from './session.js';

// ─── Error types ───────────────────────────────────────────────────────────────

export class RepoNotAllowedError extends Error {
  constructor(owner: string, repo: string) {
    super(`Repository "${owner}/${repo}" is not in the allowlist`);
    this.name = 'RepoNotAllowedError';
  }
}

export class InvalidRepoPathError extends Error {
  constructor(repoPath: string, reason: string) {
    super(`Invalid repoPath "${repoPath}": ${reason}`);
    this.name = 'InvalidRepoPathError';
  }
}

export class SessionLifecycleError extends Error {
  constructor(sessionId: string, reason: string) {
    super(`Session "${sessionId}": ${reason}`);
    this.name = 'SessionLifecycleError';
  }
}

// ─── Launch options ────────────────────────────────────────────────────────────

export interface LaunchOptions {
  /** Owner/repo for allowlist lookup */
  owner: string;
  repo: string;
  /** Local filesystem path to the repository */
  repoPath: string;
  /** Initial prompt passed to Claude via -p/--print */
  prompt?: string;
  /** Optional extra args to pass to `claude` */
  args?: readonly string[];
  /** Optional metadata persisted on the session */
  metadata?: Record<string, unknown>;
}

// ─── Environment filtering ─────────────────────────────────────────────────────

function filterEnv(allowedKeys: readonly string[]): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const key of allowedKeys) {
    const val = process.env[key];
    if (val !== undefined) {
      filtered[key] = val;
    }
  }
  return filtered;
}

// ─── Allowlist validation ──────────────────────────────────────────────────────

function isRepoAllowed(ctx: AppContext, owner: string, repo: string): boolean {
  return ctx.config.allowlist.some((entry) => entry.owner === owner && entry.repo === repo);
}

// ─── Path validation ───────────────────────────────────────────────────────────

export function validateRepoPath(raw: string): string {
  if (!isAbsolute(raw)) {
    throw new InvalidRepoPathError(raw, 'must be an absolute path');
  }
  if (!existsSync(raw)) {
    throw new InvalidRepoPathError(raw, 'path does not exist');
  }
  if (!lstatSync(raw).isDirectory()) {
    throw new InvalidRepoPathError(raw, 'path is not a directory');
  }

  // Resolve symlinks and redundancies to a canonical absolute path
  const real = realpathSync(raw);

  // Reject if realpath differs from the resolved raw (catches symlink traversal)
  if (real !== resolve(raw)) {
    throw new InvalidRepoPathError(raw, 'realpath mismatch — symlink traversal rejected');
  }

  return real;
}

// ─── Launcher ──────────────────────────────────────────────────────────────────

export class ClaudeLauncher {
  private runner: ProcessRunner;
  private ctx: AppContext;
  private processes = new Map<string, ChildProcess>();

  constructor(ctx: AppContext, runner?: ProcessRunner) {
    this.ctx = ctx;
    this.runner = runner ?? new SpawnRunner();
  }

  /**
   * Launch a Claude Code session in the given repository, after allowlist
   * validation, path validation, and environment filtering.
   */
  launch(opts: LaunchOptions): { session: ClaudeSession; process: ChildProcess } {
    if (!isRepoAllowed(this.ctx, opts.owner, opts.repo)) {
      throw new RepoNotAllowedError(opts.owner, opts.repo);
    }

    const repoPath = validateRepoPath(opts.repoPath);

    const sessionId = `claude-${opts.owner}-${opts.repo}-${Date.now().toString(36)}`;
    const claudeConfig = this.ctx.config.claude;

    createSession(
      this.ctx.db,
      opts.metadata !== undefined
        ? {
            id: sessionId,
            repoOwner: opts.owner,
            repoName: opts.repo,
            repoPath,
            metadata: opts.metadata,
          }
        : {
            id: sessionId,
            repoOwner: opts.owner,
            repoName: opts.repo,
            repoPath,
          },
    );

    appendSessionEvent(this.ctx.db, sessionId, 'created', { owner: opts.owner, repo: opts.repo });

    const command = claudeConfig.binaryPath;
    const args: string[] = [];
    if (opts.prompt) {
      args.push('-p', opts.prompt);
    }
    if (opts.args) {
      args.push(...opts.args);
    }
    const env = filterEnv(claudeConfig.allowedEnv);

    const runningSession = transitionToRunning(this.ctx.db, sessionId);
    if (!runningSession) {
      throw new Error(`Failed to transition session ${sessionId} to running`);
    }

    appendSessionEvent(this.ctx.db, sessionId, 'started', {});

    const child = this.runner.run(
      command,
      args,
      {
        sessionId,
        cwd: repoPath,
        env,
        timeoutMs: claudeConfig.defaultTimeoutMs,
        outputDir: claudeConfig.sessionDir,
      },
      (result) => {
        if (result.outputPath && result.stderrPath) {
          setSessionOutputs(this.ctx.db, sessionId, result.outputPath, result.stderrPath);
        }

        if (result.aborted) {
          appendSessionEvent(this.ctx.db, sessionId, 'stopped', { reason: 'aborted' });
          // Status already set to 'stopped' by the abort/stop caller.
        } else if (result.timedOut) {
          transitionToFailed(this.ctx.db, sessionId, result.error ?? 'Timeout');
          appendSessionEvent(this.ctx.db, sessionId, 'failed', {
            reason: 'timeout',
            error: result.error,
          });
        } else if (result.exitCode === 0) {
          transitionToExited(this.ctx.db, sessionId, result.exitCode);
          appendSessionEvent(this.ctx.db, sessionId, 'exited', { exitCode: result.exitCode });
        } else {
          transitionToFailed(
            this.ctx.db,
            sessionId,
            result.error ?? `Process exited with code ${String(result.exitCode)}`,
          );
          appendSessionEvent(this.ctx.db, sessionId, 'failed', {
            exitCode: result.exitCode,
            error: result.error,
          });
        }

        this.processes.delete(sessionId);
      },
    );

    // Track PID for lifecyle control
    if (child.pid !== undefined) {
      setSessionPid(this.ctx.db, sessionId, child.pid);
    }
    this.processes.set(sessionId, child);

    return { session: runningSession, process: child };
  }

  /**
   * Stop a running session by killing its child process.
   * Uses 'stopped' status — distinct from timeout ('failed').
   */
  stop(process: ChildProcess, sessionId: string, reason?: string): ClaudeSession | null {
    const stopped = transitionToStopped(this.ctx.db, sessionId, reason ?? 'Stopped by user');
    if (stopped) {
      appendSessionEvent(this.ctx.db, sessionId, 'stop_requested', {
        reason: reason ?? 'Stopped by user',
      });
    }
    this.runner.abort(process);
    return stopped;
  }

  // ─── Lifecycle: abort by session ID ─────────────────────────────────────────

  /**
   * Abort a running session by its ID. Looks up the PID from the DB
   * and the process from the in-memory map.
   */
  abort(sessionId: string, reason?: string): ClaudeSession | null {
    const current = getSession(this.ctx.db, sessionId);
    if (!current) return null;

    if (current.status !== 'running') {
      return null;
    }

    const child = this.processes.get(sessionId);
    if (!child) {
      // No in-memory process handle — after a restart the DB PID no longer
      // identifies a live, owned process, so we must not kill by PID.
      return null;
    }

    const stopped = transitionToStopped(this.ctx.db, sessionId, reason ?? 'Aborted by user');
    if (stopped) {
      appendSessionEvent(this.ctx.db, sessionId, 'abort_requested', {
        reason: reason ?? 'Aborted by user',
      });
    }
    this.runner.abort(child);
    return stopped;
  }

  // ─── Lifecycle: wait for session completion ─────────────────────────────────

  /**
   * Wait for a session to reach a terminal state (exited/failed/stopped/archived).
   * Returns the updated session once it reaches terminal, or after the optional
   * timeoutMs (in which case it returns whatever the current state is).
   */
  async wait(sessionId: string, timeoutMs?: number): Promise<ClaudeSession | null> {
    const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
    const pollMs = 200;

    for (;;) {
      const s = getSession(this.ctx.db, sessionId);
      if (!s) return null;

      if (isTerminal(s.status)) {
        return s;
      }

      if (deadline !== undefined && Date.now() >= deadline) {
        return s;
      }

      // Wait for process close event or poll
      const process = this.processes.get(sessionId);
      if (process) {
        try {
          await new Promise<void>((resolve) => {
            process.once('close', resolve);
            // Safety timeout in case close event fires before listener
            setTimeout(resolve, pollMs);
          });
        } catch {
          // process gone
        }
      } else {
        await new Promise((r) => setTimeout(r, pollMs));
      }
    }
  }

  // ─── Lifecycle: archive ─────────────────────────────────────────────────────

  /**
   * Archive a terminal session — marks it as archived so output files are kept
   * even if session directories are cleaned up. No-op for non-terminal sessions.
   */
  archive(sessionId: string): ClaudeSession | null {
    const current = getSession(this.ctx.db, sessionId);
    if (!current) return null;

    if (!isTerminal(current.status)) {
      return null;
    }

    const archived = transitionToArchived(this.ctx.db, sessionId);
    if (archived) {
      appendSessionEvent(this.ctx.db, sessionId, 'archived', {});
    }
    return archived;
  }
}

function isTerminal(status: string): boolean {
  return (
    status === 'exited' || status === 'failed' || status === 'stopped' || status === 'archived'
  );
}
