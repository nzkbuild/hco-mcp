import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createContext } from '../src/core/context.js';
import { runStatus } from '../src/setup/wizard.js';
import { saveSetupState, createSetupState, allStagesComplete } from '../src/setup/state.js';

const TEST_DATA_DIR = join(tmpdir(), 'hco-test-setup-cli');

function captureStdout(fn: () => void): string {
  const orig = process.stdout.write.bind(process.stdout);
  let output = '';
  process.stdout.write = (s: string) => {
    output += s;
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return output;
}

describe('Setup CLI status', () => {
  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    process.env.HCO_DATA_DIR = TEST_DATA_DIR;
  });

  after(() => {
    delete process.env.HCO_DATA_DIR;
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });

  it('hco setup --status shows not_started by default', () => {
    const ctx = createContext();
    try {
      const output = captureStdout(() => {
        runStatus(ctx);
      });
      assert.ok(output.includes('not_started'), `Expected not_started, got: ${output}`);
      assert.ok(output.includes('local'), `Expected local, got: ${output}`);
      assert.ok(output.includes('provider'), `Expected provider, got: ${output}`);
      assert.ok(output.includes('integration'), `Expected integration, got: ${output}`);
    } finally {
      ctx.db.close();
    }
  });

  it('hco setup --status shows ready when all stages complete', () => {
    const state = createSetupState();
    state.stages.local.status = 'complete';
    state.stages.provider.status = 'complete';
    state.stages.integration.status = 'complete';
    state.state = 'ready';
    saveSetupState(TEST_DATA_DIR, state);

    const ctx = createContext();
    try {
      const output = captureStdout(() => {
        runStatus(ctx);
      });
      assert.ok(output.includes('ready'), `Expected ready, got: ${output}`);
      assert.ok(output.includes('complete'), `Expected complete, got: ${output}`);
    } finally {
      ctx.db.close();
    }
  });

  it('hco setup --status shows failed stage', () => {
    const state = createSetupState();
    state.stages.local.status = 'complete';
    state.stages.provider.status = 'failed';
    state.state = 'failed';
    saveSetupState(TEST_DATA_DIR, state);

    const ctx = createContext();
    try {
      const output = captureStdout(() => {
        runStatus(ctx);
      });
      assert.ok(output.includes('failed'), `Expected failed, got: ${output}`);
    } finally {
      ctx.db.close();
    }
  });

  it('all stages complete validation', () => {
    const state = createSetupState();
    assert.equal(allStagesComplete(state), false);

    state.stages.local.status = 'complete';
    state.stages.provider.status = 'complete';
    state.stages.integration.status = 'complete';
    assert.equal(allStagesComplete(state), true);
  });
});
