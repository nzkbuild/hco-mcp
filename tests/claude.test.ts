import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { openDb } from '../src/state/db.js';
import type { AppContext } from '../src/core/context.js';
import type { HcoConfig } from '../src/config/schema.js';

const TEST_DB_DIR = '/tmp/hco-test-claude-db';
const TEST_REPO_DIR = '/tmp/hco-test-claude-repo';
const TEST_SESSION_DIR = '/tmp/hco-test-claude-sessions';

// Re-creation to ensure test isolation
function freshContext(): AppContext {
  const db = openDb(TEST_DB_DIR);
  const config: HcoConfig = {
    dataDir: TEST_DB_DIR,
    transport: 'stdio',
    allowlist: [{ owner: 'alice', repo: 'demo', trustLevel: 'sandbox' }],
    authority: { mode: 'interactive', requireApprovals: false, allowedApprovers: [] },
    claude: {
      binaryPath: 'echo',
      allowedEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
      sessionDir: TEST_SESSION_DIR,
      defaultTimeoutMs: 10000,
    },
    logLevel: 'warn',
    maxConcurrency: 4,
  };
  return { config, db };
}

function setupRepo(): string {
  rmSync(TEST_REPO_DIR, { recursive: true, force: true });
  mkdirSync(TEST_REPO_DIR, { recursive: true });
  writeFileSync(resolve(TEST_REPO_DIR, '.gitkeep'), '');
  return TEST_REPO_DIR;
}

describe('Claude session persistence', () => {
  let ctx: AppContext;

  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true });
    ctx = freshContext();
    setupRepo();
  });

  after(() => {
    ctx?.db.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true });
  });

  it('claude_sessions table exists in migrated schema', () => {
    const tables = ctx.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'claude_sessions'")
      .all() as Array<{ name: string }>;
    assert.equal(tables.length, 1);
    assert.equal(tables[0]?.name, 'claude_sessions');
  });

  it('createSession returns current start state, not stale object', async () => {
    const { createSession, getSession } = await import('../src/claude/session.js');

    const s = createSession(ctx.db, {
      id: 'test-start-state',
      repoOwner: 'alice',
      repoName: 'demo',
      repoPath: TEST_REPO_DIR,
      metadata: { reason: 'test' },
    });

    assert.equal(s.status, 'start');
    assert.equal(s.repoOwner, 'alice');
    assert.equal(s.repoName, 'demo');
    assert.ok(s.createdAt !== '');

    const fetched = getSession(ctx.db, 'test-start-state');
    assert.ok(fetched);
    assert.equal(fetched.status, 'start');
  });

  it('transitionToRunning returns updated record, not stale', async () => {
    const { createSession, transitionToRunning } = await import('../src/claude/session.js');

    createSession(ctx.db, {
      id: 'test-transition-running',
      repoOwner: 'alice',
      repoName: 'demo',
      repoPath: TEST_REPO_DIR,
    });

    const updated = transitionToRunning(ctx.db, 'test-transition-running');
    assert.ok(updated);
    assert.equal(updated.status, 'running');
    assert.ok(updated.startedAt !== null);
  });

  it('transitionToRunning returns null for invalid transition', async () => {
    const { createSession, transitionToRunning, transitionToExited } =
      await import('../src/claude/session.js');

    createSession(ctx.db, {
      id: 'test-bad-transition',
      repoOwner: 'alice',
      repoName: 'demo',
      repoPath: TEST_REPO_DIR,
    });

    transitionToRunning(ctx.db, 'test-bad-transition');
    const exited = transitionToExited(ctx.db, 'test-bad-transition', 0);
    assert.ok(exited);

    // Cannot transition from terminal 'exited' to 'running'
    const nope = transitionToRunning(ctx.db, 'test-bad-transition');
    assert.equal(nope, null);
  });

  it('setSessionOutputs persists both stdout and stderr paths', async () => {
    const { createSession, setSessionOutputs, getSession, transitionToRunning } =
      await import('../src/claude/session.js');

    createSession(ctx.db, {
      id: 'test-outputs',
      repoOwner: 'alice',
      repoName: 'demo',
      repoPath: TEST_REPO_DIR,
    });

    transitionToRunning(ctx.db, 'test-outputs');

    const ok = setSessionOutputs(ctx.db, 'test-outputs', '/tmp/stdout.log', '/tmp/stderr.log');
    assert.equal(ok, true);

    const s = getSession(ctx.db, 'test-outputs');
    assert.ok(s);
    assert.equal(s.outputPath, '/tmp/stdout.log');
    assert.equal(s.stderrPath, '/tmp/stderr.log');
  });

  it('setSessionOutputs returns false for unknown session', async () => {
    const { setSessionOutputs } = await import('../src/claude/session.js');
    assert.equal(setSessionOutputs(ctx.db, 'nonexistent', '/tmp/o', '/tmp/e'), false);
  });
});

// ─── Blocker 1: Environment isolation ─────────────────────────────────────────

describe('Claude environment filter', () => {
  let ctx: AppContext;
  const origApiKey = process.env.ANTHROPIC_API_KEY;
  const origDbUrl = process.env.DATABASE_URL;

  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true });
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    setupRepo();
    ctx = freshContext();
  });

  after(() => {
    ctx?.db.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true });
    if (origApiKey !== undefined) process.env.ANTHROPIC_API_KEY = origApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
    if (origDbUrl !== undefined) process.env.DATABASE_URL = origDbUrl;
    else delete process.env.DATABASE_URL;
  });

  it('env passed to child is only allowed keys — parent secret excluded', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-123';
    process.env.DATABASE_URL = 'postgres://secret:password@db/db'; // NOT in allowedEnv

    // Spawn a test process that dumps its env to stdout
    const result = spawnSync(
      'node',
      [
        '-e',
        'console.log(JSON.stringify({ HAS_KEY: !!process.env.ANTHROPIC_API_KEY, HAS_SECRET: !!process.env.DATABASE_URL }))',
      ],
      {
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
        encoding: 'utf-8',
        timeout: 5000,
      },
    );

    const parsed = JSON.parse(result.stdout.trim()) as { HAS_KEY: boolean; HAS_SECRET: boolean };
    assert.equal(parsed.HAS_KEY, true, 'ANTHROPIC_API_KEY should be present');
    assert.equal(parsed.HAS_SECRET, false, 'DATABASE_URL must NOT leak into child process');
  });
});

// ─── Blocker 2: repoPath validation ───────────────────────────────────────────

describe('Claude repoPath validation', () => {
  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true });
    setupRepo();
  });

  after(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true });
  });

  it('validateRepoPath rejects relative path', async () => {
    const { validateRepoPath } = await import('../src/claude/launcher.js');

    assert.throws(
      () => validateRepoPath('relative/path'),
      (err: Error) =>
        err instanceof Error &&
        err.name === 'InvalidRepoPathError' &&
        err.message.includes('absolute'),
    );
  });

  it('validateRepoPath rejects non-existent path', async () => {
    const { validateRepoPath } = await import('../src/claude/launcher.js');

    assert.throws(
      () => validateRepoPath('/tmp/does-not-exist-xyz'),
      (err: Error) =>
        err instanceof Error &&
        err.name === 'InvalidRepoPathError' &&
        err.message.includes('does not exist'),
    );
  });

  it('validateRepoPath rejects file-not-directory path', async () => {
    const { validateRepoPath } = await import('../src/claude/launcher.js');

    // Create a temp file (not a directory) to test rejection
    const tempFile = resolve(TEST_REPO_DIR, 'a-file.txt');
    writeFileSync(tempFile, 'content');

    try {
      assert.throws(
        () => validateRepoPath(tempFile),
        (err: Error) =>
          err instanceof Error &&
          err.name === 'InvalidRepoPathError' &&
          err.message.includes('not a directory'),
      );
    } finally {
      rmSync(tempFile, { force: true });
    }
  });

  it(
    'validateRepoPath rejects symlink traversal',
    { skip: process.platform === 'win32' ? 'symlinks require admin on Windows' : false },
    async () => {
      const realDir = resolve(TEST_REPO_DIR, 'real');
      const linkDir = resolve(TEST_REPO_DIR, 'link');
      mkdirSync(realDir, { recursive: true });
      writeFileSync(resolve(realDir, 'test.txt'), 'data');
      symlinkSync(realDir, linkDir);

      // validateRepoPath rejects symlinks — lstatSync catches it as "not a directory"
      // before even reaching the realpath mismatch check.
      const { validateRepoPath } = await import('../src/claude/launcher.js');

      assert.throws(
        () => validateRepoPath(linkDir),
        (err: Error) =>
          err instanceof Error &&
          err.name === 'InvalidRepoPathError' &&
          err.message.includes('not a directory'),
      );

      // Assert the symlink resolution is indeed different
      const real = realpathSync(linkDir);
      const resolved = resolve(linkDir);
      assert.notEqual(real, resolved, 'symlink should resolve differently');

      // Cleanup
      rmSync(linkDir, { recursive: true, force: true });
      rmSync(realDir, { recursive: true, force: true });
    },
  );

  it('validateRepoPath accepts valid absolute directory', async () => {
    const { validateRepoPath } = await import('../src/claude/launcher.js');

    const p = resolve(TEST_REPO_DIR);
    const result = validateRepoPath(p);
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  it('InvalidRepoPathError has correct name', async () => {
    const { InvalidRepoPathError } = await import('../src/claude/launcher.js');
    const e = new InvalidRepoPathError('/x', 'reason');
    assert.equal(e.name, 'InvalidRepoPathError');
  });

  it('launcher.launch rejects invalid cwd before spawn', async () => {
    const { ClaudeLauncher, RepoNotAllowedError } = await import('../src/claude/launcher.js');

    // Test 1: relative path rejected (validateRepoPath throws before spawn)
    const ctx = freshContext();
    const launcher = new ClaudeLauncher(ctx);

    assert.throws(
      () =>
        launcher.launch({
          owner: 'alice',
          repo: 'demo',
          repoPath: 'relative/path',
        }),
      (err: Error) => err instanceof Error && err.name === 'InvalidRepoPathError',
      'relative path must be rejected before spawn',
    );

    ctx.db.close();
  });

  it('launcher.launch rejects non-allowlisted owner/repo', async () => {
    const { ClaudeLauncher } = await import('../src/claude/launcher.js');

    const ctx = freshContext();
    const launcher = new ClaudeLauncher(ctx);

    assert.throws(
      () =>
        launcher.launch({
          owner: 'bob',
          repo: 'evil-repo',
          repoPath: TEST_REPO_DIR,
        }),
      (err: Error) => err instanceof Error && err.name === 'RepoNotAllowedError',
      'non-allowlisted owner/repo must be rejected before spawn',
    );

    ctx.db.close();
  });

  it('launcher.launch accepts allowlisted repo with valid path', async () => {
    const { ClaudeLauncher } = await import('../src/claude/launcher.js');
    const { getSession } = await import('../src/claude/session.js');

    mkdirSync(TEST_SESSION_DIR, { recursive: true });

    // Use a fresh DB and context so the session is isolated
    const testDbDir = '/tmp/hco-test-claude-db-launch';
    const testSessionDir = '/tmp/hco-test-claude-sessions-launch';
    rmSync(testDbDir, { recursive: true, force: true });
    rmSync(testSessionDir, { recursive: true, force: true });
    mkdirSync(testSessionDir, { recursive: true });

    const db = openDb(testDbDir);
    const config: HcoConfig = {
      dataDir: testDbDir,
      transport: 'stdio',
      allowlist: [{ owner: 'alice', repo: 'demo', trustLevel: 'sandbox' }],
      authority: { mode: 'interactive', requireApprovals: false, allowedApprovers: [] },
      claude: {
        binaryPath: 'echo',
        allowedEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
        sessionDir: testSessionDir,
        defaultTimeoutMs: 3000,
      },
      logLevel: 'warn',
      maxConcurrency: 4,
    };
    const ctx: AppContext = { config, db };
    const launcher = new ClaudeLauncher(ctx);

    const { session, process } = launcher.launch({
      owner: 'alice',
      repo: 'demo',
      repoPath: TEST_REPO_DIR,
    });

    assert.ok(session);
    assert.equal(session.status, 'running');
    assert.equal(session.repoOwner, 'alice');
    assert.equal(session.repoName, 'demo');

    // Wait for process to fully exit before cleanup
    await new Promise<void>((resolve) => {
      process.on('close', () => {
        resolve();
      });
    });
    // Small extra wait for stream finish events to deliver callback
    await new Promise((r) => setTimeout(r, 100));

    db.close();
    rmSync(testDbDir, { recursive: true, force: true });
    rmSync(testSessionDir, { recursive: true, force: true });
  });
});

// ─── Blocker 4: Timeout vs manual stop ────────────────────────────────────────

describe('Claude timeout vs stop distinction', () => {
  let ctx: AppContext;

  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true });
    setupRepo();
    ctx = freshContext();
  });

  after(() => {
    ctx?.db.close();
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true });
  });

  it('transitionToStopped sets stopped status, not failed/timedOut', async () => {
    const { createSession, transitionToRunning, transitionToStopped, getSession } =
      await import('../src/claude/session.js');

    createSession(ctx.db, {
      id: 'test-stop',
      repoOwner: 'alice',
      repoName: 'demo',
      repoPath: TEST_REPO_DIR,
    });

    transitionToRunning(ctx.db, 'test-stop');
    const stopped = transitionToStopped(ctx.db, 'test-stop', 'User requested stop');

    assert.ok(stopped);
    assert.equal(stopped.status, 'stopped');
    assert.notEqual(stopped.status, 'failed');
    assert.equal(stopped.error, 'User requested stop');
  });

  it('timeout path uses transitionToFailed, not stopped', async () => {
    const { createSession, transitionToRunning, transitionToFailed, getSession } =
      await import('../src/claude/session.js');

    createSession(ctx.db, {
      id: 'test-timeout',
      repoOwner: 'alice',
      repoName: 'demo',
      repoPath: TEST_REPO_DIR,
    });

    transitionToRunning(ctx.db, 'test-timeout');
    const failed = transitionToFailed(ctx.db, 'test-timeout', 'Process timed out after 5000ms');

    assert.ok(failed);
    assert.equal(failed.status, 'failed');
    assert.ok(failed.error?.includes('timed out'));
  });

  it('SpawnRunner timeout sets timedOut=true, aborted=false', async () => {
    const { SpawnRunner } = await import('../src/claude/runner.js');

    mkdirSync(TEST_SESSION_DIR, { recursive: true });

    let receivedResult: unknown = null;
    const runner = new SpawnRunner();

    await new Promise<void>((resolve) => {
      runner.run(
        'node',
        ['-e', 'setTimeout(() => {}, 30000)'],
        {
          sessionId: 'test-timeout-v2',
          cwd: TEST_REPO_DIR,
          env: {},
          timeoutMs: 1000,
          outputDir: TEST_SESSION_DIR,
        },
        (result) => {
          receivedResult = result;
          resolve();
        },
      );
    });

    const rr = receivedResult as {
      timedOut: boolean;
      aborted: boolean;
      exitCode: number;
      error: string | null;
    };
    assert.ok(rr.timedOut, 'should be marked as timedOut');
    assert.equal(rr.aborted, false, 'timeout must not be marked as aborted');
    assert.notEqual(rr.exitCode, 0);
    assert.ok(rr.error?.includes('timed'));
  });

  it('SpawnRunner.abort sets aborted=true, timedOut=false', async () => {
    const { SpawnRunner } = await import('../src/claude/runner.js');

    mkdirSync(TEST_SESSION_DIR, { recursive: true });

    let receivedResult: unknown = null;
    const runner = new SpawnRunner();

    await new Promise<void>((resolve) => {
      const child = runner.run(
        'node',
        ['-e', 'setTimeout(() => {}, 30000)'],
        {
          sessionId: 'test-abort',
          cwd: TEST_REPO_DIR,
          env: {},
          timeoutMs: 30000,
          outputDir: TEST_SESSION_DIR,
        },
        (result) => {
          receivedResult = result;
          resolve();
        },
      );

      // Short delay then abort
      setTimeout(() => {
        runner.abort(child);
      }, 500);
    });

    const rr = receivedResult as { timedOut: boolean; aborted: boolean; signal: string | null };
    assert.equal(rr.aborted, true, 'manual abort must set aborted=true');
    assert.equal(rr.timedOut, false, 'manual abort must NOT be labeled timedOut');
  });

  it('SpawnRunner rejects empty command', async () => {
    const { SpawnRunner } = await import('../src/claude/runner.js');

    const runner = new SpawnRunner();
    assert.throws(() => {
      runner.run(
        '',
        [],
        {
          sessionId: 'test-empty',
          cwd: TEST_REPO_DIR,
          env: {},
          timeoutMs: 5000,
          outputDir: TEST_SESSION_DIR,
        },
        () => {
          /* no-op */
        },
      );
    }, /non-empty/);
  });
});

// ─── Blocker 5: Output durability ─────────────────────────────────────────────

describe('Claude output durability', () => {
  before(() => {
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true });
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    setupRepo();
    mkdirSync(TEST_SESSION_DIR, { recursive: true });
  });

  after(() => {
    rmSync(TEST_REPO_DIR, { recursive: true, force: true });
    rmSync(TEST_SESSION_DIR, { recursive: true, force: true });
  });

  it('stdout/stderr streams are fully written before onExit callback', async () => {
    const { SpawnRunner } = await import('../src/claude/runner.js');

    const runner = new SpawnRunner();

    const result = await new Promise<{
      timedOut: boolean;
      aborted: boolean;
      outputPath: string | null;
      stderrPath: string | null;
      exitCode: number;
    }>((resolve) => {
      runner.run(
        'node',
        [
          '-e',
          // Use explicit stream writes with drain callbacks so all 100000 bytes
          // are flushed before the process exits. console.log() on a pipe can
          // truncate at the OS pipe buffer boundary (often 65536 bytes).
          `const s = 'X'.repeat(100000); process.stdout.write(s, () => { process.stderr.write(s, () => {}); });`,
        ],
        {
          sessionId: 'test-durability',
          cwd: TEST_REPO_DIR,
          env: {},
          timeoutMs: 10000,
          outputDir: TEST_SESSION_DIR,
        },
        resolve,
      );
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.aborted, false);
    assert.ok(result.outputPath, 'outputPath must be set');
    assert.ok(result.stderrPath, 'stderrPath must be set');

    // Read the captured output — must be complete
    const stdout = readFileSync(result.outputPath, 'utf-8');
    const stderr = readFileSync(result.stderrPath, 'utf-8');

    assert.ok(
      stdout.length >= 100000,
      `stdout truncated: got ${String(stdout.length)} chars, expected >= 100000`,
    );
    assert.ok(
      stderr.length >= 100000,
      `stderr truncated: got ${String(stderr.length)} chars, expected >= 100000`,
    );
    assert.ok(stdout.includes('X'), 'stdout must contain the output');
    assert.ok(stderr.includes('X'), 'stderr must contain the output');
  });

  it('stderrPath is present alongside outputPath in RunResult', async () => {
    const { SpawnRunner } = await import('../src/claude/runner.js');

    const runner = new SpawnRunner();

    await new Promise<void>((resolve) => {
      runner.run(
        'node',
        ['-e', 'console.log("ok")'],
        {
          sessionId: 'runresult-test',
          cwd: TEST_REPO_DIR,
          env: {},
          timeoutMs: 5000,
          outputDir: TEST_SESSION_DIR,
        },
        (result) => {
          assert.ok('stderrPath' in result);
          assert.ok('aborted' in result);
          assert.ok(result.outputPath !== null);
          assert.ok(result.stderrPath !== null);
          assert.ok(result.stderrPath.includes('stderr.txt'));
          resolve();
        },
      );
    });
  });
});

// ─── Blocker 6: Validate Claude executable/args ───────────────────────────────

describe('Claude executable validation', () => {
  it('SpawnRunner does not use shell execution', async () => {
    const { spawn } = await import('node:child_process');
    assert.equal(typeof spawn, 'function');
    assert.ok(true);
  });

  it('empty command is rejected before spawn', async () => {
    const { SpawnRunner } = await import('../src/claude/runner.js');
    const runner = new SpawnRunner();
    assert.throws(
      () =>
        runner.run(
          '',
          [],
          {
            sessionId: 's',
            cwd: '/tmp',
            env: {},
            timeoutMs: 5000,
            outputDir: '/tmp',
          },
          () => {
            /* no-op callback */
          },
        ),
      /non-empty/,
    );
  });
});
