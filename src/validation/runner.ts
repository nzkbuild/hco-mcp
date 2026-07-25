import { spawn } from 'node:child_process';
import type { ValidationProfile } from './profile.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error: string | null;
}

export interface RunResult {
  profile: ValidationProfile;
  cwd: string;
  results: CommandResult[];
  passed: boolean;
  error: string | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_OUTPUT = 65536;
const TIMEOUT_MS = 600_000; // 10 minutes per command

interface CommandSpec {
  command: string;
  args: string[];
}

export const PROFILE_COMMANDS: Record<ValidationProfile, readonly CommandSpec[]> = {
  quick: [{ command: 'npm', args: ['run', 'build'] }],
  standard: [
    { command: 'npm', args: ['run', 'build'] },
    { command: 'npm', args: ['run', 'test'] },
  ],
  strict: [
    { command: 'npm', args: ['run', 'build'] },
    { command: 'npm', args: ['run', 'test'] },
    { command: 'npm', args: ['run', 'lint'] },
    { command: 'npm', args: ['run', 'format'] },
    { command: 'npm', args: ['run', 'diff:check'] },
  ],
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return 'Unknown error';
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: TIMEOUT_MS,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutTotal = 0;
    let stderrTotal = 0;
    let settled = false;

    function settle(result: CommandResult): void {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutTotal += chunk.length;
      if (stdoutTotal > MAX_OUTPUT) {
        child.kill();
        settle({
          command,
          args,
          exitCode: -1,
          stdout: Buffer.concat(stdoutChunks).toString('utf-8').slice(0, MAX_OUTPUT),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
          timedOut: false,
          error: `stdout exceeded ${String(MAX_OUTPUT)} bytes`,
        });
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrTotal += chunk.length;
      if (stderrTotal > MAX_OUTPUT) {
        child.kill();
        settle({
          command,
          args,
          exitCode: -1,
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8').slice(0, MAX_OUTPUT),
          timedOut: false,
          error: `stderr exceeded ${String(MAX_OUTPUT)} bytes`,
        });
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      child.stdout.destroy();
      child.stderr.destroy();
      settle({
        command,
        args,
        exitCode: -1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        timedOut: false,
        error: sanitizeError(err),
      });
    });

    child.on('close', (code, signal) => {
      const timedOut = signal !== null;
      settle({
        command,
        args,
        exitCode: code ?? (signal !== null ? -1 : 0),
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        timedOut,
        error: timedOut ? `Process timed out after ${String(TIMEOUT_MS)}ms` : null,
      });
    });
  });
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function runValidation(profile: ValidationProfile, cwd: string): Promise<RunResult> {
  const commands = PROFILE_COMMANDS[profile];
  const results: CommandResult[] = [];

  for (const cmd of commands) {
    const result = await runCommand(cmd.command, cmd.args, cwd);
    results.push(result);
    if (result.exitCode !== 0) {
      return {
        profile,
        cwd,
        results,
        passed: false,
        error: `Command "${cmd.command} ${cmd.args.join(' ')}" failed with exit code ${String(result.exitCode)}`,
      };
    }
  }

  return {
    profile,
    cwd,
    results,
    passed: true,
    error: null,
  };
}
