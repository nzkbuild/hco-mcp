import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainJs = join(__dirname, '..', 'dist', 'cli', 'main.js');

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [mainJs, ...args], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  return {
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    status: result.status,
  };
}

describe('CLI entrypoint (via npm bin path)', () => {
  it('hco --version prints version', () => {
    const { stdout, stderr, status } = runCli(['--version']);
    assert.equal(stderr, '', `stderr should be empty, got: ${stderr}`);
    assert.equal(status, 0);
    assert.match(stdout, /^HCO \d+\.\d+\.\d+/);
  });

  it('hco -v prints version', () => {
    const { stdout, stderr, status } = runCli(['-v']);
    assert.equal(stderr, '', `stderr should be empty, got: ${stderr}`);
    assert.equal(status, 0);
    assert.match(stdout, /^HCO \d+\.\d+\.\d+/);
  });

  it('hco --help prints help text with setup commands', () => {
    const { stdout, stderr, status } = runCli(['--help']);
    assert.equal(stderr, '', `stderr should be empty, got: ${stderr}`);
    assert.equal(status, 0);
    assert.ok(stdout.includes('hco setup'), 'help should include hco setup');
    assert.ok(stdout.includes('hco setup --status'), 'help should include hco setup --status');
    assert.ok(stdout.includes('hco setup --continue'), 'help should include hco setup --continue');
    assert.ok(stdout.includes('hco setup --repair'), 'help should include hco setup --repair');
    assert.ok(stdout.includes('hco setup --reset'), 'help should include hco setup --reset');
    assert.ok(stdout.includes('HCO '), 'help should print version');
  });

  it('hco help prints help text with setup commands', () => {
    const { stdout, stderr, status } = runCli(['help']);
    assert.equal(stderr, '', `stderr should be empty, got: ${stderr}`);
    assert.equal(status, 0);
    assert.ok(stdout.includes('hco setup'), 'help should include hco setup');
  });

  it('hco setup --status prints setup state (no error)', () => {
    const { stdout, status } = runCli(['setup', '--status']);
    assert.equal(status, 0);
    // Should print setup state; exact content depends on environment
    assert.ok(stdout.length > 0, 'setup --status should produce output');
  });

  it('hco without args prints usage', () => {
    const { stdout, stderr, status } = runCli([]);
    assert.equal(stderr, '', `stderr should be empty, got: ${stderr}`);
    assert.equal(status, 0);
    assert.ok(stdout.includes('Usage'), `should include usage, got: ${stdout}`);
  });

  it('hco unknown command prints error', () => {
    const { stdout, stderr, status } = runCli(['nonexistent-command-xyz']);
    assert.equal(stderr, '', `stderr should be empty, got: ${stderr}`);
    assert.notEqual(status, 0);
    assert.ok(stdout.includes('Unknown command') || stdout.includes('hco help'));
  });
});
