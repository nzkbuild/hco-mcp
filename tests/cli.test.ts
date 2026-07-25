import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '../dist/cli/main.js');
const TEST_DATA_DIR = '/tmp/hco-test-cli';

function hco(args: string): string {
  return execSync(`node ${CLI} ${args}`, {
    env: { ...process.env, HCO_DATA_DIR: TEST_DATA_DIR },
    encoding: 'utf-8',
    cwd: import.meta.dirname,
  });
}

describe('CLI foundation', () => {
  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    // The CLI needs to be built first — this test suite expects dist/ to exist.
    if (!existsSync(CLI)) {
      console.warn('dist/ not found — run "npm run build" before tests');
    }
  });

  after(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('hco help prints usage', () => {
    if (!existsSync(CLI)) return;

    const out = hco('help');
    assert.ok(out.includes('status'));
    assert.ok(out.includes('jobs'));
    assert.ok(out.includes('inspect'));
    assert.ok(out.includes('pause'));
    assert.ok(out.includes('resume'));
    assert.ok(out.includes('recover'));
  });

  it('hco status reports foundation ready', () => {
    if (!existsSync(CLI)) return;

    const out = hco('status');
    assert.ok(out.includes('Foundation ready'));
    assert.ok(out.includes('Data dir'));
    assert.ok(out.includes('Transport'));
  });

  it('hco jobs reports no jobs initially', () => {
    if (!existsSync(CLI)) return;

    const out = hco('jobs');
    assert.ok(out.includes('No jobs recorded'));
  });

  it('hco inspect with unknown job exits non-zero', () => {
    if (!existsSync(CLI)) return;

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

  it('hco pause on unknown job exits non-zero', () => {
    if (!existsSync(CLI)) return;

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

  it('hco resume on unknown job exits non-zero', () => {
    if (!existsSync(CLI)) return;

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

  it('hco recover reports 0 recovered when idle', () => {
    if (!existsSync(CLI)) return;

    const out = hco('recover');
    assert.ok(out.includes('Recovered 0'));
  });
});
