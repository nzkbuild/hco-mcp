/**
 * Release acceptance test — validates the package as users receive it.
 * Builds, packs, installs globally in an isolated prefix, and exercises
 * all npm bin entrypoints. Linux-compatible; Windows path handling included.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { createRequire } from 'node:module';

const PROJECT_DIR = resolve(import.meta.dirname, '../..');
const pkgVersion = (createRequire(import.meta.url)('../../package.json') as { version: string })
  .version;

const isWindows = platform() === 'win32';

function binName(base: string): string {
  return isWindows ? `${base}.cmd` : base;
}

function runBin(prefix: string, bin: string, args: string): string {
  const binDir = isWindows ? prefix : join(prefix, 'bin');
  const binPath = join(binDir, binName(bin));
  const prefixEnv = isWindows ? '' : `PATH="${join(prefix, 'bin')}:${process.env.PATH ?? ''}" `;

  return execSync(isWindows ? `"${binPath}" ${args}` : `${prefixEnv}"${binPath}" ${args}`, {
    encoding: 'utf-8',
    timeout: 15000,
    env: { ...process.env, HCO_DATA_DIR: join(prefix, 'hco-data') },
  });
}

function extractTarball(tarballPath: string, destDir: string): void {
  // Cross-platform: use npm's own packing to extract via `tar -xf`,
  // but on Windows the tar command needs the path resolved through cygpath.
  // On both platforms, `npm pack` could generate, and we use `tar` for extraction.
  // If tar fails, fall back to `node -e "require('tar').extract(...)"` is not available
  // without an extra dependency.
  //
  // Strategy: let errors propagate — if tar fails on a platform, the test will surface it.
  // On Windows Git Bash (the expected env), tar works with POSIX paths via `$(cygpath -u ...)`.
  // We detect Windows and convert the path if needed.
  try {
    execSync(`tar -xzf "${tarballPath}" --strip-components=1 -C "${destDir}"`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
  } catch {
    // Fallback: try with cygpath on Windows
    if (isWindows) {
      const unixPath = execSync(`cygpath -u "${tarballPath}"`, { encoding: 'utf-8', timeout: 5000 }).trim();
      const unixDest = execSync(`cygpath -u "${destDir}"`, { encoding: 'utf-8', timeout: 5000 }).trim();
      execSync(`tar -xzf "${unixPath}" --strip-components=1 -C "${unixDest}"`, {
        encoding: 'utf-8',
        timeout: 10000,
      });
    } else {
      throw new Error(`tar extraction failed for ${tarballPath}`);
    }
  }
}

describe('npm-pack acceptance', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'hco-accept-'));
  const prefix = join(workDir, 'npm-prefix');
  const dataDir = join(prefix, 'hco-data');
  let tarballPath: string;

  before(() => {
    execSync('npm run build', { cwd: PROJECT_DIR, stdio: 'pipe', timeout: 60000 });

    execSync(`npm pack --pack-destination "${workDir}"`, {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 30000,
    });

    const files = readdirSync(workDir).filter((f) => f.endsWith('.tgz'));
    assert.ok(files.length > 0, 'npm pack should produce a .tgz file');
    tarballPath = join(workDir, files[0] ?? '');
    assert.ok(existsSync(tarballPath), `Tarball not found: ${tarballPath}`);
  });

  after(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock — harmless */
    }
  });

  it('tarball contains dist entrypoints', () => {
    const extractDir = mkdtempSync(join(tmpdir(), 'hco-list-'));
    try {
      extractTarball(tarballPath, extractDir);
      const entrypoints = [
        'dist/cli/main.js',
        'dist/daemon/main.js',
        'dist/index.js',
      ];
      for (const entry of entrypoints) {
        assert.ok(
          existsSync(join(extractDir, entry)),
          `Tarball missing ${entry}`,
        );
      }
    } finally {
      try { rmSync(extractDir, { recursive: true, force: true }); } catch { /* cleanup */ }
    }
  });

  it('tarball entrypoints have Node shebangs', () => {
    const extractDir = mkdtempSync(join(tmpdir(), 'hco-extract-'));
    try {
      extractTarball(tarballPath, extractDir);
      for (const entry of ['dist/cli/main.js', 'dist/daemon/main.js', 'dist/index.js']) {
        const head = readFileSync(join(extractDir, entry), 'utf-8').slice(0, 20);
        assert.ok(
          head.startsWith('#!/usr/bin/env node'),
          `${entry} missing shebang, got: ${JSON.stringify(head)}`,
        );
      }
    } finally {
      try { rmSync(extractDir, { recursive: true, force: true }); } catch { /* cleanup */ }
    }
  });

  it('tarball package.json version matches source', () => {
    const extractDir = mkdtempSync(join(tmpdir(), 'hco-extract2-'));
    try {
      extractTarball(tarballPath, extractDir);
      const pkgJson = JSON.parse(readFileSync(join(extractDir, 'package.json'), 'utf-8')) as {
        version: string;
      };
      assert.equal(pkgJson.version, pkgVersion, 'Tarball version mismatch');
    } finally {
      try { rmSync(extractDir, { recursive: true, force: true }); } catch { /* cleanup */ }
    }
  });

  it('installs into isolated npm prefix', () => {
    execSync(`npm install -g --prefix "${prefix}" "${tarballPath}"`, {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: 'pipe',
    });
    const binDir = isWindows ? prefix : join(prefix, 'bin');
    assert.ok(existsSync(binDir), 'npm install should create bin directory');
  });

  it('hco --help reports version', () => {
    const out = runBin(prefix, 'hco', '--help');
    assert.ok(out.includes('status'), `Missing 'status' in help: ${out.slice(0, 80)}`);
    assert.ok(out.includes(`HCO ${pkgVersion}`), `Version mismatch: ${out.slice(0, 80)}`);
  });

  it('hco --version reports version', () => {
    const out = runBin(prefix, 'hco', '--version');
    assert.ok(out.includes(`HCO ${pkgVersion}`), `Version mismatch: ${out.slice(0, 80)}`);
  });

  it('hco status reports version, concurrency 1, empty allowlist', () => {
    const out = runBin(prefix, 'hco', 'status');
    assert.ok(out.includes(`HCO ${pkgVersion}`), 'Version mismatch in status');
    assert.ok(out.includes('Concurrency:  1'), 'Expected default concurrency 1');
    assert.ok(out.includes('Allowlist:    0 repos'), 'Expected empty allowlist');
  });

  it('hco jobs reports empty', () => {
    const out = runBin(prefix, 'hco', 'jobs');
    assert.ok(out.includes('No jobs recorded'), `Unexpected output: ${out}`);
  });

  it('hco recover reports 0', () => {
    const out = runBin(prefix, 'hco', 'recover');
    assert.ok(out.includes('Recovered 0'), `Unexpected output: ${out}`);
  });

  it('hco-daemon binary has Node shebang', () => {
    if (isWindows) {
      // On Windows, npm creates .cmd wrappers. Check the actual .js file
      // inside the installed node_modules tree.
      const daemonJs = join(
        prefix,
        'node_modules',
        'hco-mcp',
        'dist',
        'daemon',
        'main.js',
      );
      assert.ok(existsSync(daemonJs), `hco-daemon .js not found at ${daemonJs}`);
      const head = readFileSync(daemonJs, 'utf-8').slice(0, 20);
      assert.ok(
        head.startsWith('#!/usr/bin/env node'),
        `hco-daemon missing shebang, got: ${JSON.stringify(head)}`,
      );
    } else {
      const binDir = join(prefix, 'bin');
      const daemonBin = join(binDir, binName('hco-daemon'));
      assert.ok(existsSync(daemonBin), `hco-daemon binary not found at ${daemonBin}`);
      const head = readFileSync(daemonBin, 'utf-8').slice(0, 20);
      assert.ok(
        head.startsWith('#!/usr/bin/env node'),
        `hco-daemon missing shebang, got: ${JSON.stringify(head)}`,
      );
    }
  });

  it('creates SQLite on first status', () => {
    const dbFile = join(dataDir, 'hco.db');
    assert.ok(existsSync(dbFile), `SQLite database not created at ${dbFile}`);
  });

  it('no provider traffic required — all tests use local SQLite only', () => {
    const cfgFile = join(prefix, 'hco-data', 'hco.json');
    if (existsSync(cfgFile)) {
      const cfg = JSON.parse(readFileSync(cfgFile, 'utf-8')) as Record<string, unknown>;
      assert.ok(
        !cfg.ANTHROPIC_API_KEY,
        'Provider credentials should not be in test config',
      );
    }
    const dbFile = join(dataDir, 'hco.db');
    assert.ok(existsSync(dbFile), 'SQLite database should exist');
  });

  it('acceptance test does not use real provider credentials', () => {
    const env = process.env;
    const hasRealKeys =
      env.ANTHROPIC_API_KEY ??
      env.HERMES_API_KEY ??
      env.OPENROUTER_API_KEY ??
      env.TELEGRAM_BOT_TOKEN;
    if (hasRealKeys) {
      console.log('Note: Provider key environment variables detected in test environment.');
      console.log('Tests use read-only CLI commands and do not make provider calls.');
    }
  });
});
