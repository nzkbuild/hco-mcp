import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

// ─── Missing-binary diagnostics ─────────────────────────────────────────────────

export class MissingClaudeError extends Error {
  public readonly binary: string;
  public readonly diagnostic: string;

  constructor(binary: string) {
    const diagnostic =
      isAbsolute(binary) || binary.includes('/') || binary.includes('\\')
        ? `Check that the binary exists and is executable.`
        : `Install Claude Code (https://docs.anthropic.com/en/docs/claude-code) ` +
          `or set CLAUDE_BIN to the correct path.`;

    super(`Claude Code executable not found: "${binary}". ${diagnostic}`);
    this.name = 'MissingClaudeError';
    this.binary = binary;
    this.diagnostic = diagnostic;
  }
}

// ─── Binary verification ────────────────────────────────────────────────────────

function verifyBinaryExists(command: string): void {
  if (command.length === 0) {
    throw new Error('command must be non-empty');
  }
  try {
    spawn(command, ['--version'], {
      stdio: 'ignore',
      timeout: 3000,
    }).on('error', (err) => {
      throw err;
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new MissingClaudeError(command);
    }
    throw err;
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Unique session ID for output directory naming */
  sessionId: string;
  /** Absolute path to the repository working directory */
  cwd: string;
  /** Environment variables to pass to the child process */
  env: Record<string, string>;
  /** Timeout in milliseconds before SIGTERM */
  timeoutMs: number;
  /** Base directory for writing stdout/stderr output files */
  outputDir: string;
}

export interface RunResult {
  exitCode: number;
  outputPath: string | null;
  stderrPath: string | null;
  error: string | null;
  /** Whether the process was killed due to timeout (not external stop) */
  timedOut: boolean;
  /** Whether the process was killed by an explicit abort (manual stop) */
  aborted: boolean;
}

// ─── ProcessRunner interface ───────────────────────────────────────────────────

export interface ProcessRunner {
  run(
    command: string,
    args: string[],
    opts: RunOptions,
    onExit: (result: RunResult) => void,
  ): ChildProcess;
  abort(process: ChildProcess): void;
}

// ─── Real spawn runner ─────────────────────────────────────────────────────────

export class SpawnRunner implements ProcessRunner {
  private readonly _abortedPids = new Set<number>();

  abort(process: ChildProcess): void {
    if (process.pid !== undefined) {
      this._abortedPids.add(process.pid);
    }
    process.kill('SIGTERM');
  }

  run(
    command: string,
    args: string[],
    opts: RunOptions,
    onExit: (result: RunResult) => void,
  ): ChildProcess {
    if (command.length === 0) {
      throw new Error('command must be non-empty');
    }

    verifyBinaryExists(command);

    const sessionDir = resolve(opts.outputDir, opts.sessionId);
    mkdirSync(sessionDir, { recursive: true });

    const stdoutPath = resolve(sessionDir, 'stdout.txt');
    const stderrPath = resolve(sessionDir, 'stderr.txt');

    const stdoutStream = createWriteStream(stdoutPath, { flags: 'w' });
    const stderrStream = createWriteStream(stderrPath, { flags: 'w' });

    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeoutMs,
    });

    // stdout/stderr are non-null per stdio: ['ignore', 'pipe', 'pipe']
    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);

    let timedOut = false;
    let exited = false;

    const abortedPids = this._abortedPids;

    // Track pending stream finalization for output durability.
    // Use a Set so that a 'finish' event firing and endStreams() calling
    // streamFinished for the same stream cannot double-count.
    const pendingStreams = new Set(['stdout', 'stderr']);
    let pendingResult: RunResult | null = null;

    function streamFinished(name: string): void {
      pendingStreams.delete(name);
      if (pendingStreams.size === 0 && pendingResult) {
        deliverResult();
      }
    }

    stdoutStream.on('finish', () => {
      streamFinished('stdout');
    });
    stderrStream.on('finish', () => {
      streamFinished('stderr');
    });

    function deliverResult(): void {
      if (!pendingResult) return;
      if (child.pid !== undefined) {
        abortedPids.delete(child.pid);
      }
      onExit(pendingResult);
      pendingResult = null;
    }

    function finalize(result: RunResult): void {
      pendingResult = result;
      endStreams();
    }

    child.on('error', (err) => {
      if (exited) return;
      exited = true;
      finalize({
        exitCode: -1,
        outputPath: stdoutPath,
        stderrPath,
        error: err.message,
        timedOut: false,
        aborted: false,
      });
    });

    child.on('close', (code, signal) => {
      if (exited) return;
      exited = true;
      const aborted = child.pid !== undefined ? abortedPids.has(child.pid) : false;
      timedOut = signal !== null && !aborted;
      finalize({
        exitCode: code ?? (signal !== null ? -1 : 0),
        outputPath: stdoutPath,
        stderrPath,
        error: timedOut ? `Process timed out after ${String(opts.timeoutMs)}ms` : null,
        timedOut,
        aborted,
      });
    });

    return child;

    function endStreams(): void {
      if (!stdoutStream.writableEnded) {
        try {
          stdoutStream.end();
        } catch {
          pendingStreams.delete('stdout');
        }
      }
      if (!stderrStream.writableEnded) {
        try {
          stderrStream.end();
        } catch {
          pendingStreams.delete('stderr');
        }
      }
      if (pendingStreams.size === 0 && pendingResult) {
        deliverResult();
      }
    }
  }
}
