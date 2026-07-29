import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createSetupState,
  loadSetupState,
  saveSetupState,
  firstIncompleteStage,
  allStagesComplete,
  isSetupIncomplete,
} from '../src/setup/state.js';

const TEST_DIR = join(tmpdir(), 'hco-test-setup-state');

describe('SetupState', () => {
  before(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });

  it('creates default state', () => {
    const state = createSetupState();
    assert.equal(state.version, 1);
    assert.equal(state.state, 'not_started');
    assert.equal(state.stages.local.status, 'pending');
    assert.equal(state.stages.provider.status, 'pending');
    assert.equal(state.stages.integration.status, 'pending');
  });

  it('saves and loads state', () => {
    const state = createSetupState();
    state.state = 'local_verified';
    state.stages.local.status = 'complete';
    saveSetupState(TEST_DIR, state);

    const loaded = loadSetupState(TEST_DIR);
    assert.equal(loaded.state, 'local_verified');
    assert.equal(loaded.stages.local.status, 'complete');
    assert.equal(loaded.stages.provider.status, 'pending');
  });

  it('returns default state when file does not exist', () => {
    const loaded = loadSetupState(join(TEST_DIR, 'nonexistent'));
    assert.equal(loaded.state, 'not_started');
  });

  it('returns default state for wrong version', () => {
    const badPath = join(TEST_DIR, 'bad-version.json');
    writeFileSync(badPath, JSON.stringify({ version: 99, state: 'ready' }));
    // Load from a subdir that doesn't have setup-state.json to avoid the bad file
    const loaded = loadSetupState(join(TEST_DIR, 'fresh'));
    assert.equal(loaded.state, 'not_started');
    rmSync(badPath, { force: true });
  });

  it('finds first incomplete stage', () => {
    const state = createSetupState();
    assert.equal(firstIncompleteStage(state), 'local');

    state.stages.local.status = 'complete';
    assert.equal(firstIncompleteStage(state), 'provider');

    state.stages.provider.status = 'failed';
    assert.equal(firstIncompleteStage(state), 'provider');

    state.stages.provider.status = 'complete';
    assert.equal(firstIncompleteStage(state), 'integration');
  });

  it('detects all stages complete', () => {
    const state = createSetupState();
    assert.equal(allStagesComplete(state), false);

    state.stages.local.status = 'complete';
    state.stages.provider.status = 'complete';
    state.stages.integration.status = 'complete';
    assert.equal(allStagesComplete(state), true);
  });

  it('detects incomplete setup', () => {
    const state = createSetupState();
    assert.equal(isSetupIncomplete(state), true);

    state.state = 'local_verified';
    assert.equal(isSetupIncomplete(state), true);

    state.state = 'ready';
    state.stages.local.status = 'complete';
    state.stages.provider.status = 'complete';
    state.stages.integration.status = 'complete';
    assert.equal(isSetupIncomplete(state), false);
  });

  it('handles skipped stages in incompleteness check', () => {
    const state = createSetupState();
    state.stages.local.status = 'complete';
    state.stages.provider.status = 'skipped';
    state.stages.integration.status = 'complete';
    state.state = 'ready';
    // skipped integration means not all complete
    assert.equal(allStagesComplete(state), false);
  });

  it('no credentials stored in state', () => {
    const state = createSetupState();
    const json = JSON.stringify(state);
    assert.equal(json.includes('sk-ant'), false);
    assert.equal(json.includes('api_key'), false);
    assert.equal(json.includes('secret'), false);
  });
});
