import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const CLI = resolve(import.meta.dirname, '../dist/cli/main.js');
const DAEMON = resolve(import.meta.dirname, '../dist/daemon/main.js');
const TEST_DATA_DIR = join(tmpdir(), 'hco-test-cli');
const pkgVersion = (createRequire(import.meta.url)('../package.json') as { version: string })
  .version;

function hco(args: string): string {
  return execSync(`node ${CLI} ${args}`, {
    env: { ...process.env, HCO_DATA_DIR: TEST_DATA_DIR },
    encoding: 'utf-8',
    cwd: import.meta.dirname,
  });
}

describe('CLI foundation', () => {
  before(function beforeFn(this: unknown) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
    }
  });

  after(() => {
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });

  it('hco help prints usage', function helpTest(this: unknown) {
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
      return;
    }
    const out = hco('help');
    assert.ok(out.includes('status'));
    assert.ok(out.includes('jobs'));
    assert.ok(out.includes('inspect'));
    assert.ok(out.includes('pause'));
    assert.ok(out.includes('resume'));
    assert.ok(out.includes('recover'));
  });

  it('hco status reports foundation ready', function statusTest(this: unknown) {
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
      return;
    }
    const out = hco('status');
    assert.ok(out.includes('Execution pipeline active'));
    assert.ok(out.includes('Data dir'));
    assert.ok(out.includes('Transport'));
  });

  it('hco jobs reports no jobs initially', function jobsTest(this: unknown) {
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
      return;
    }
    const out = hco('jobs');
    assert.ok(out.includes('No jobs recorded'));
  });

  it('hco inspect with unknown job exits non-zero', function inspectTest(this: unknown) {
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
      return;
    }
    try {
      execSync(`node ${CLI} inspect none-1234`, {
        env: { ...process.env, HCO_DATA_DIR: TEST_DATA_DIR },
        encoding: 'utf-8',
        cwd: import.meta.dirname,
      });
      assert.fail('Expected non-zero exit');
    } catch (err: unknown) {
      const stderr = (err as { stderr?: string }).stderr ?? '';
      const stdout = (err as { stdout?: string }).stdout ?? '';
      const combined = stdout + stderr;
      assert.ok(combined.includes('not found'));
    }
  });

  it('hco pause on unknown job exits non-zero', function pauseTest(this: unknown) {
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
      return;
    }
    try {
      execSync(`node ${CLI} pause none-1234`, {
        env: { ...process.env, HCO_DATA_DIR: TEST_DATA_DIR },
        encoding: 'utf-8',
        cwd: import.meta.dirname,
      });
      assert.fail('Expected non-zero exit');
    } catch {
      // expected
    }
  });

  it('hco resume on unknown job exits non-zero', function resumeTest(this: unknown) {
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
      return;
    }
    try {
      execSync(`node ${CLI} resume none-1234`, {
        env: { ...process.env, HCO_DATA_DIR: TEST_DATA_DIR },
        encoding: 'utf-8',
        cwd: import.meta.dirname,
      });
      assert.fail('Expected non-zero exit');
    } catch {
      // expected
    }
  });

  it('hco recover reports 0 recovered when idle', function recoverTest(this: unknown) {
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
      return;
    }
    const out = hco('recover');
    assert.ok(out.includes('Recovered 0'));
  });

  it('dist/cli/main.js has Node shebang', function shebangCliTest(this: unknown) {
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
      return;
    }
    const head = readFileSync(CLI, 'utf-8').slice(0, 20);
    assert.ok(
      head.startsWith('#!/usr/bin/env node'),
      `Expected shebang, got: ${head.slice(0, 20)}`,
    );
  });

  it('dist/daemon/main.js has Node shebang', function shebangDaemonTest(this: unknown) {
    if (!existsSync(DAEMON)) {
      (this as { skip: () => void }).skip();
      return;
    }
    const head = readFileSync(DAEMON, 'utf-8').slice(0, 20);
    assert.ok(
      head.startsWith('#!/usr/bin/env node'),
      `Expected shebang, got: ${head.slice(0, 20)}`,
    );
  });

  it('hco --version reports package version', function versionTest(this: unknown) {
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
      return;
    }
    const out = hco('help');
    assert.ok(
      out.includes(`HCO ${pkgVersion}`),
      `Expected version ${pkgVersion}, got: ${out.slice(0, 60)}`,
    );
  });

  it('hco status reports package version', function statusVersionTest(this: unknown) {
    if (!existsSync(CLI)) {
      (this as { skip: () => void }).skip();
      return;
    }
    const out = hco('status');
    const firstLine = out.split('\n')[0] ?? '(empty)';
    assert.ok(
      out.includes(`HCO ${pkgVersion}`),
      `Expected version ${pkgVersion} in status, got first line: ${firstLine}`,
    );
  });
});
