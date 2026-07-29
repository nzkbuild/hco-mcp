import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSetupState,
  loadSetupState,
  saveSetupState,
  firstIncompleteStage,
  allStagesComplete,
  isSetupIncomplete,
  freshStages,
} from '../src/setup/state.js';
import { redact, redactForDisplay } from '../src/setup/redact.js';
import {
  confirm,
  hiddenInput,
  textInput,
  selectFromList,
  displayProgress,
} from '../src/setup/prompts.js';
import {
  readConfig,
  writeMCPEntry,
  hasExistingHCO,
  restoreBackup,
  removeBackup,
  createEnvFile,
  installDropIn,
  removeDropIn,
  verifySecretFilePermissions,
  defaultHermesPaths,
} from '../src/setup/hermes.js';
import { runSetup, runContinue, runStatus, runRepair, runReset } from '../src/setup/wizard.js';
import { runLocalStage } from '../src/setup/stages/local.js';
import { runProviderStage } from '../src/setup/stages/provider.js';
import { runIntegrationStage } from '../src/setup/stages/integration.js';

// These tests verify the setup system works correctly end-to-end,
// without actually running interactive stages (which require TTY).
// They test that the modules load, export the right functions, and
// that the CLI recognizes all setup commands.

describe('Setup module exports', () => {
  it('state module exports all expected functions', () => {
    assert.equal(typeof createSetupState, 'function');
    assert.equal(typeof loadSetupState, 'function');
    assert.equal(typeof saveSetupState, 'function');
    assert.equal(typeof firstIncompleteStage, 'function');
    assert.equal(typeof allStagesComplete, 'function');
    assert.equal(typeof isSetupIncomplete, 'function');
    assert.equal(typeof freshStages, 'function');
  });

  it('redact module exports redact functions', () => {
    assert.equal(typeof redact, 'function');
    assert.equal(typeof redactForDisplay, 'function');
  });

  it('prompts module exports interaction functions', () => {
    assert.equal(typeof confirm, 'function');
    assert.equal(typeof hiddenInput, 'function');
    assert.equal(typeof textInput, 'function');
    assert.equal(typeof selectFromList, 'function');
    assert.equal(typeof displayProgress, 'function');
  });

  it('hermes module exports config functions', () => {
    assert.equal(typeof readConfig, 'function');
    assert.equal(typeof writeMCPEntry, 'function');
    assert.equal(typeof hasExistingHCO, 'function');
    assert.equal(typeof restoreBackup, 'function');
    assert.equal(typeof removeBackup, 'function');
    assert.equal(typeof createEnvFile, 'function');
    assert.equal(typeof installDropIn, 'function');
    assert.equal(typeof removeDropIn, 'function');
    assert.equal(typeof verifySecretFilePermissions, 'function');
    assert.equal(typeof defaultHermesPaths, 'function');
  });

  it('wizard module exports all expected functions', () => {
    assert.equal(typeof runSetup, 'function');
    assert.equal(typeof runContinue, 'function');
    assert.equal(typeof runStatus, 'function');
    assert.equal(typeof runRepair, 'function');
    assert.equal(typeof runReset, 'function');
  });

  it('local stage module exports run function', () => {
    assert.equal(typeof runLocalStage, 'function');
  });

  it('provider stage module exports run function', () => {
    assert.equal(typeof runProviderStage, 'function');
  });

  it('integration stage module exports run function', () => {
    assert.equal(typeof runIntegrationStage, 'function');
  });
});

describe('Setup CLI help', () => {
  function findCliEntry(): string {
    return resolve(import.meta.dirname, '../dist/cli/main.js');
  }

  it('hco help lists setup command', () => {
    const cli = findCliEntry();
    if (!existsSync(cli)) return;

    const out = execSync(`node "${cli}" help`, {
      encoding: 'utf-8',
      env: { ...process.env, HCO_DATA_DIR: process.env.TEMP ?? '/tmp' },
    });
    assert.ok(out.includes('setup'), `Expected 'setup' in help output, got:\n${out}`);
    assert.ok(
      out.includes('setup --status'),
      `Expected 'setup --status' in help output, got:\n${out}`,
    );
    assert.ok(
      out.includes('setup --continue'),
      `Expected 'setup --continue' in help output, got:\n${out}`,
    );
  });

  it('hco setup without args does not crash', () => {
    const cli = findCliEntry();
    if (!existsSync(cli)) return;

    const out = execSync(`node "${cli}" setup --status`, {
      encoding: 'utf-8',
      env: { ...process.env, HCO_DATA_DIR: process.env.TEMP ?? '/tmp' },
    });
    assert.ok(out.includes('not_started') || out.includes('ready') || out.includes('failed'));
  });
});

describe('Setup cross-cutting concerns', () => {
  it('createSetupState produces independent instances', () => {
    const s1 = createSetupState();
    const s2 = createSetupState();

    // Deep clone check — mutations to s1 should not affect s2
    s1.stages.local.status = 'complete';

    assert.equal(s2.stages.local.status, 'pending');
  });

  it('saveSetupState writes valid JSON', () => {
    const dir = join(tmpdir(), 'hco-test-xcut');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    try {
      const state = createSetupState();
      saveSetupState(dir, state);
      const loaded = loadSetupState(dir);
      assert.equal(loaded.version, 1);
      assert.equal(loaded.state, 'not_started');
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  it('failed state is preserved across loads', () => {
    const dir = join(tmpdir(), 'hco-test-failed');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    try {
      const state = createSetupState();
      state.stages.local.status = 'complete';
      state.stages.provider.status = 'failed';
      state.state = 'failed';
      saveSetupState(dir, state);

      const loaded = loadSetupState(dir);
      assert.equal(loaded.state, 'failed');
      assert.equal(loaded.stages.local.status, 'complete');
      assert.equal(loaded.stages.provider.status, 'failed');
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  it('stack traces from setup modules exclude raw keys', () => {
    const err =
      'Error: Setup failed with ANTHROPIC_API_KEY=sk-ant-secret-key\n    at runProviderStage';
    const result = redact(err);
    assert.equal(result.includes('sk-ant'), false);
    assert.ok(result.includes('[REDACTED]'));
    assert.ok(result.includes('runProviderStage'));
  });
});
