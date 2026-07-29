import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeMCPEntry,
  hasExistingHCO,
  readConfig,
  restoreBackup,
  removeBackup,
  defaultHermesPaths,
} from '../src/setup/hermes.js';

const TEST_DIR = join(tmpdir(), 'hco-test-setup-integration');

function setupTestDir() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

describe('Hermes MCP integration', () => {
  before(setupTestDir);
  after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('writeMCPEntry preserves unrelated MCP servers', () => {
    const configDir = join(TEST_DIR, 'preserve');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'config.yaml');
    writeFileSync(
      configPath,
      'mcp_servers:\n' +
        '  other-app:\n' +
        '    command: echo\n' +
        '    args: []\n' +
        '    env: {}\n' +
        'logging:\n' +
        '  level: debug\n',
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
    assert.ok(config.mcp_servers);
    assert.ok(config.mcp_servers['other-app']);
    assert.ok(config.mcp_servers.hco);
    assert.ok(config.logging);
    assert.equal((config.logging as Record<string, string>).level, 'debug');
  });

  it('backup is created before write when config exists', () => {
    const configDir = join(TEST_DIR, 'backup');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'config.yaml');
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

  it('backup is removed on success', () => {
    const configDir = join(TEST_DIR, 'remove-backup');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'config.yaml');
    writeFileSync(configPath, 'logging:\n  level: info\n');

    writeMCPEntry({
      configPath,
      hcoPackagePath: '/fake/hco/index.js',
      dataDir: '/fake/.hco',
      anthropicKeyRef: '${ANTHROPIC_API_KEY}',
      anthropicBaseUrlRef: '${ANTHROPIC_BASE_URL}',
      hcoEntry: { command: 'node', args: ['/fake/hco/index.js'], env: {} },
    });

    removeBackup(configPath);
    assert.equal(existsSync(configPath + '.hco-backup'), false);
  });

  it('restores backup on failure', () => {
    const configDir = join(TEST_DIR, 'restore');
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, 'config.yaml');
    const originalContent = 'logging:\n  level: info\n';
    writeFileSync(configPath, originalContent);
    const backupPath = configPath + '.hco-backup';
    writeFileSync(backupPath, originalContent);

    // Simulate broken file
    writeFileSync(configPath, 'broken: [');
    const restored = restoreBackup(configPath);
    assert.ok(restored);
    const content = readFileSync(configPath, 'utf-8');
    assert.ok(content.includes('logging'));
  });

  it('hasExistingHCO detects existing HCO MCP config', () => {
    const config = {
      mcp_servers: {
        hco: { command: 'node', args: [], env: {} },
        'other-app': { command: 'echo', args: [], env: {} },
      },
    };
    assert.ok(hasExistingHCO(config));
  });

  it('hasExistingHCO returns false when no HCO entry', () => {
    const config = {
      mcp_servers: {
        'other-app': { command: 'echo', args: [], env: {} },
      },
    };
    assert.equal(hasExistingHCO(config), false);
  });

  it('hasExistingHCO returns false when no mcp_servers at all', () => {
    const config = {};
    assert.equal(hasExistingHCO(config), false);
  });

  it('default paths include all expected paths', () => {
    const paths = defaultHermesPaths();
    assert.ok(paths.configPath.includes('.hermes'));
    assert.ok(paths.envFile.includes('hco.env'));
    assert.ok(paths.dropInFile.includes('hco-env.conf'));
    assert.ok(paths.envDir.includes('.config/hermes'));
    assert.ok(paths.dropInDir.includes('systemd'));
  });
});
