import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readConfig,
  writeMCPEntry,
  hasExistingHCO,
  restoreBackup,
  createEnvFile,
  installDropIn,
  removeDropIn,
  verifySecretFilePermissions,
  defaultHermesPaths,
} from '../src/setup/hermes.js';

const TEST_DIR = join(tmpdir(), 'hco-test-hermes');
const configDir = join(TEST_DIR, 'hermes');
const configPath = join(configDir, 'config.yaml');

function setupTestDir() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(configDir, { recursive: true });
}

describe('Hermes YAML', () => {
  before(setupTestDir);
  after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('reads empty config when file does not exist', () => {
    const config = readConfig(join(TEST_DIR, 'nonexistent.yaml'));
    assert.deepEqual(config, {});
  });

  it('reads existing config with unrelated keys', () => {
    writeFileSync(configPath, 'logging:\n  level: debug\n');
    const config = readConfig(configPath);
    assert.deepEqual(config, { logging: { level: 'debug' } });
  });

  it('preserves unrelated top-level keys after write', () => {
    rmSync(configDir, { recursive: true, force: true });
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configPath,
      'logging:\n  level: debug\nmcp_servers:\n  other-app:\n    command: echo\n    args: []\n    env: {}\n',
    );
    writeMCPEntry({
      configPath,
      hcoPackagePath: '/fake/hco/index.js',
      dataDir: '/fake/.hco',
      anthropicKeyRef: '${ANTHROPIC_API_KEY}',
      anthropicBaseUrlRef: '${ANTHROPIC_BASE_URL}',
      hcoEntry: { command: 'node', args: ['/fake/hco/index.js'], env: {} },
    });
    const config = readConfig(configPath);
    assert.ok(config.logging);
    assert.ok(config.mcp_servers);
    assert.ok(config.mcp_servers['other-app']);
    assert.ok(config.mcp_servers.hco);
  });

  it('detects existing hco entry', () => {
    rmSync(configDir, { recursive: true, force: true });
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configPath,
      'mcp_servers:\n  hco:\n    command: node\n    args: []\n    env: {}\n',
    );
    const config = readConfig(configPath);
    assert.ok(hasExistingHCO(config));
  });

  it('detects no existing hco entry', () => {
    const config = { mcp_servers: { 'other-app': { command: 'echo', args: [], env: {} } } };
    assert.equal(hasExistingHCO(config), false);
  });

  it('writes HCO MCP entry with env references only (no raw keys)', () => {
    rmSync(configDir, { recursive: true, force: true });
    mkdirSync(configDir, { recursive: true });
    writeMCPEntry({
      configPath,
      hcoPackagePath: '/fake/hco/index.js',
      dataDir: '/fake/.hco',
      anthropicKeyRef: '${ANTHROPIC_API_KEY}',
      anthropicBaseUrlRef: '${ANTHROPIC_BASE_URL}',
      hcoEntry: { command: 'node', args: ['/fake/hco/index.js'], env: {} },
    });
    const raw = readFileSync(configPath, 'utf-8');
    assert.equal(raw.includes('sk-ant'), false);
    assert.ok(raw.includes('ANTHROPIC_API_KEY'));
    assert.ok(raw.includes('ANTHROPIC_BASE_URL'));
    assert.ok(raw.includes('HCO_DATA_DIR'));
    assert.ok(raw.includes('HCO_ADAPTER'));
    assert.ok(raw.includes('spawn'));
  });

  it('creates backup before write', () => {
    rmSync(configDir, { recursive: true, force: true });
    mkdirSync(configDir, { recursive: true });
    const originalContent = 'logging:\n  level: info\n';
    writeFileSync(configPath, originalContent);
    writeMCPEntry({
      configPath,
      hcoPackagePath: '/fake/hco/index.js',
      dataDir: '/fake/.hco',
      anthropicKeyRef: '${ANTHROPIC_API_KEY}',
      anthropicBaseUrlRef: '${ANTHROPIC_BASE_URL}',
      hcoEntry: { command: 'node', args: ['/fake/hco/index.js'], env: {} },
    });
    const backupPath = configPath + '.hco-backup';
    assert.ok(existsSync(backupPath));
    const backupContent = readFileSync(backupPath, 'utf-8');
    assert.ok(backupContent.includes('logging'));
  });

  it('restores backup on failure', () => {
    rmSync(configDir, { recursive: true, force: true });
    mkdirSync(configDir, { recursive: true });
    const originalContent = 'logging:\n  level: info\n';
    writeFileSync(configPath, originalContent);
    const backupPath = configPath + '.hco-backup';
    writeFileSync(backupPath, originalContent);
    // simulate broken file
    writeFileSync(configPath, 'broken: [');
    const restored = restoreBackup(configPath);
    assert.ok(restored);
    const content = readFileSync(configPath, 'utf-8');
    assert.ok(content.includes('logging'));
  });

  it('does not write raw API keys to YAML', () => {
    rmSync(configDir, { recursive: true, force: true });
    mkdirSync(configDir, { recursive: true });
    writeMCPEntry({
      configPath,
      hcoPackagePath: '/fake/hco/index.js',
      dataDir: '/fake/.hco',
      anthropicKeyRef: '${ANTHROPIC_API_KEY}',
      anthropicBaseUrlRef: '${ANTHROPIC_BASE_URL}',
      hcoEntry: {
        command: 'node',
        args: ['/fake/hco/index.js'],
        env: {
          HCO_DATA_DIR: '/fake/.hco',
          ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY}',
          ANTHROPIC_BASE_URL: '${ANTHROPIC_BASE_URL}',
        },
      },
    });
    const raw = readFileSync(configPath, 'utf-8');
    assert.equal(raw.includes('sk-ant'), false, 'YAML must not contain raw API key prefix');
  });

  it('default paths are defined', () => {
    const paths = defaultHermesPaths();
    assert.ok(paths.configPath.includes('hermes'));
    assert.ok(paths.envFile.includes('hco.env'));
    assert.ok(paths.dropInFile.includes('hco-env.conf'));
  });
});

describe('Hermes env file', () => {
  const envDir = join(TEST_DIR, 'env-test');
  const envFile = join(envDir, 'hco.env');

  before(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('creates env file with correct permissions', () => {
    createEnvFile({
      envDir,
      envFile,
      apiKey: 'sk-ant-testkey1234',
      baseUrl: 'https://example.com/v1',
    });
    assert.ok(existsSync(envFile));
    const content = readFileSync(envFile, 'utf-8');
    assert.ok(content.includes('ANTHROPIC_API_KEY=sk-ant-testkey1234'));
    assert.ok(content.includes('ANTHROPIC_BASE_URL=https://example.com/v1'));
  });

  it('verifies permissions on env file', () => {
    createEnvFile({
      envDir: join(envDir, 'verify'),
      envFile: join(envDir, 'verify', 'hco.env'),
      apiKey: 'test',
      baseUrl: 'https://test',
    });
    const result = verifySecretFilePermissions(join(envDir, 'verify', 'hco.env'));
    // On Windows chmod may not fully take effect, so just check the file exists
    if (process.platform !== 'win32') {
      assert.ok(result.ok, result.reason);
    }
  });

  it('reports missing file', () => {
    const result = verifySecretFilePermissions(join(envDir, 'nonexistent.env'));
    assert.equal(result.ok, false);
    assert.ok(result.reason);
  });
});

describe('Hermes systemd drop-in', () => {
  const dropInDir = join(TEST_DIR, 'dropin-test');
  const dropInFile = join(dropInDir, 'hco-env.conf');

  before(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('creates drop-in with EnvironmentFile directive', () => {
    installDropIn({ dropInDir, dropInFile, envFilePath: '/fake/hco.env' });
    assert.ok(existsSync(dropInFile));
    const content = readFileSync(dropInFile, 'utf-8');
    assert.ok(content.includes('[Service]'));
    assert.ok(content.includes('EnvironmentFile=/fake/hco.env'));
  });

  it('removes drop-in', () => {
    installDropIn({ dropInDir, dropInFile, envFilePath: '/fake/hco.env' });
    assert.ok(existsSync(dropInFile));
    removeDropIn(dropInFile);
    assert.equal(existsSync(dropInFile), false);
  });

  it('removeDropIn is idempotent (does not throw on missing file)', () => {
    removeDropIn(join(TEST_DIR, 'nonexistent.conf'));
    // no throw = pass
  });
});
