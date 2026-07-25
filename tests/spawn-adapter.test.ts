import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import { createExecution } from '../src/state/execution-repository.js';
import type { ExecutionRow } from '../src/state/execution-repository.js';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';
import { SpawnAdapter } from '../src/claude/adapter.js';
import type { ProcessAttempt, ClaudeCodeAdapter } from '../src/claude/adapter.js';
import type { ProcessRunner, RunOptions, RunResult } from '../src/claude/runner.js';

const TEST_DB_DIR = join(tmpdir(), 'hco-test-spawn-adapter');

// Capturing runner — records RunOptions without spawning a real process
class CaptureRunner implements ProcessRunner {
  public lastRunOpts: RunOptions | null = null;
  public lastCommand: string | null = null;
  public lastArgs: string[] | null = null;

  private readonly result: RunResult;

  constructor(result?: Partial<RunResult>) {
    this.result = {
      exitCode: 0,
      outputPath: null,
      stderrPath: null,
      error: null,
      timedOut: false,
      aborted: false,
      ...result,
    };
  }

  run(command: string, args: string[], opts: RunOptions, onExit: (r: RunResult) => void): ChildProcess {
    this.lastCommand = command;
    this.lastArgs = args;
    this.lastRunOpts = opts;
    setImmediate(() => { onExit(this.result); });
    return { pid: 9999 } as ChildProcess;
  }

  abort(_process: ChildProcess): void {
    /* noop */
  }
}

function freshDb(): Database.Database {
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
  return openDb(TEST_DB_DIR);
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hco-spawn-test-repo-'));
  writeFileSync(join(dir, 'README.md'), '# test');
  return dir;
}

function validRequest(repoPath: string) {
  return ExecutionRequestV1.parse({
    brief: {
      original_request: 'Create a file.',
      objective: 'Test.',
      context: '',
      constraints: [],
      acceptance_criteria: [],
      requested_validation: [],
    },
    claude_config: {},
    repository: { owner: 'test', repo: 'test', path: repoPath },
    policy_ref: 'test',
  });
}

function profileWithBinary(binaryPath: string) {
  return ExecutionProfileV1.parse({
    profile_id: 'test',
    claude_defaults: {
      binary_path: binaryPath,
      default_timeout_ms: 30_000,
      session_dir: join(tmpdir(), 'hco-spawn-sessions'),
    },
    repository_allowlist: [{ owner: 'test', repo: 'test' }],
  });
}

function profileWithoutBinary() {
  return ExecutionProfileV1.parse({
    profile_id: 'test-no-bin',
    claude_defaults: {
      default_timeout_ms: 30_000,
      session_dir: join(tmpdir(), 'hco-spawn-sessions'),
    },
    repository_allowlist: [{ owner: 'test', repo: 'test' }],
  });
}

function validPolicy(repoPath: string) {
  return PolicySnapshotV1.parse({
    repository_boundary: { owner: 'test', repo: 'test', local_path: repoPath },
    permission_limits: { allowed_tools: ['Read', 'Write', 'Edit', 'Bash'], deny_shell_access: true },
    timeout_ceiling_ms: 600_000,
    max_concurrency: 4,
    approval_required: true,
  });
}

function persistedExecution(db: Database.Database, execRequest: ReturnType<typeof validRequest>, profile: ReturnType<typeof profileWithBinary>, policy: ReturnType<typeof validPolicy>): ExecutionRow {
  return createExecution(db, execRequest, profile, policy);
}

describe('SpawnAdapter repository path resolution', () => {
  let db: Database.Database;
  let repoPath: string;

  before(() => {
    db = freshDb();
    repoPath = tempRepo();
  });

  after(() => {
    db?.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  function freshState(): { runner: CaptureRunner; adapter: ClaudeCodeAdapter } {
    const r = new CaptureRunner();
    return { runner: r, adapter: new SpawnAdapter(r) };
  }

  it('uses validated repository path as cwd', async () => {
    const { runner: r, adapter: a } = freshState();
    const exec = persistedExecution(db, validRequest(repoPath), profileWithBinary('echo'), validPolicy(repoPath));

    await new Promise<ProcessAttempt>((resolve) => {
      a.launch(exec, profileWithBinary('echo'), (attempt) => {
        resolve(attempt);
      });
    });

    assert.ok(r.lastRunOpts, 'SpawnRunner.run should have been called');
    assert.equal(r.lastRunOpts.cwd, repoPath);
  });

  it('produces error signal for non-existent repository path', async () => {
    const { runner: r, adapter: a } = freshState();
    const exec = persistedExecution(
      db,
      validRequest('/nonexistent/path/12345'),
      profileWithBinary('echo'),
      validPolicy('/nonexistent/path/12345'),
    );

    const attempt = await new Promise<ProcessAttempt>((resolve) => {
      a.launch(exec, profileWithBinary('echo'), (att) => { resolve(att); });
    });

    assert.equal(attempt.signal, 'error');
    assert.equal(attempt.exitCode, -1);
    assert.equal(r.lastRunOpts, null, 'SpawnRunner.run should NOT have been called');
  });

  it('produces error signal for file path instead of directory', async () => {
    const { runner: r, adapter: a } = freshState();
    const filePath = join(repoPath, 'README.md');
    const exec = persistedExecution(db, validRequest(filePath), profileWithBinary('echo'), validPolicy(filePath));

    const attempt = await new Promise<ProcessAttempt>((resolve) => {
      a.launch(exec, profileWithBinary('echo'), (att) => { resolve(att); });
    });

    assert.equal(attempt.signal, 'error');
    assert.equal(attempt.exitCode, -1);
    assert.equal(r.lastRunOpts, null, 'SpawnRunner.run should NOT have been called');
  });
});

describe('SpawnAdapter binary precedence', () => {
  let db: Database.Database;
  let repoPath: string;

  before(() => {
    db = freshDb();
    repoPath = tempRepo();
  });

  after(() => {
    db?.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    rmSync(repoPath, { recursive: true, force: true });
  });

  function freshState(): { runner: CaptureRunner; adapter: ClaudeCodeAdapter } {
    const r = new CaptureRunner();
    return { runner: r, adapter: new SpawnAdapter(r) };
  }

  it('profile binary wins over CLAUDE_BIN env', async () => {
    const { runner: r, adapter: a } = freshState();
    const exec = persistedExecution(db, validRequest(repoPath), profileWithBinary('/custom/bin/claude'), validPolicy(repoPath));

    const prev = process.env.CLAUDE_BIN;
    process.env.CLAUDE_BIN = '/usr/bin/claude';
    try {
      await new Promise<ProcessAttempt>((resolve) => {
        a.launch(exec, profileWithBinary('/custom/bin/claude'), (att) => { resolve(att); });
      });
    } finally {
      if (prev !== undefined) process.env.CLAUDE_BIN = prev;
      else delete process.env.CLAUDE_BIN;
    }

    assert.equal(r.lastCommand, '/custom/bin/claude');
  });

  it('CLAUDE_BIN wins when profile has no binary', async () => {
    const { runner: r, adapter: a } = freshState();
    const exec = persistedExecution(db, validRequest(repoPath), profileWithoutBinary(), validPolicy(repoPath));

    const prev = process.env.CLAUDE_BIN;
    process.env.CLAUDE_BIN = '/env/bin/claude';
    try {
      await new Promise<ProcessAttempt>((resolve) => {
        a.launch(exec, profileWithoutBinary(), (att) => { resolve(att); });
      });
    } finally {
      if (prev !== undefined) process.env.CLAUDE_BIN = prev;
      else delete process.env.CLAUDE_BIN;
    }

    assert.equal(r.lastCommand, '/env/bin/claude');
  });

  it('defaults to "claude" when neither profile nor CLAUDE_BIN set', async () => {
    const { runner: r, adapter: a } = freshState();
    const exec = persistedExecution(db, validRequest(repoPath), profileWithoutBinary(), validPolicy(repoPath));

    const prev = process.env.CLAUDE_BIN;
    delete process.env.CLAUDE_BIN;
    try {
      await new Promise<ProcessAttempt>((resolve) => {
        a.launch(exec, profileWithoutBinary(), (att) => { resolve(att); });
      });
    } finally {
      if (prev !== undefined) process.env.CLAUDE_BIN = prev;
    }

    assert.equal(r.lastCommand, 'claude');
  });
});
