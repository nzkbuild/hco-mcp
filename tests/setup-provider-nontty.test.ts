import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readEnvCredentials } from '../src/setup/prompts.js';

const TEST_DATA_DIR = join(tmpdir(), 'hco-test-setup-provider-nontty');

describe('Provider stage — non-TTY credential fallback', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('readEnvCredentials returns null apiKey when env vars missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    const creds = readEnvCredentials();
    assert.equal(creds.apiKey, null);
    assert.equal(creds.baseUrl, null);
  });

  it('reads credentials from env when available', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-nontty-test';
    process.env.ANTHROPIC_BASE_URL = 'https://nontty.example.com';

    const creds = readEnvCredentials();
    assert.equal(creds.apiKey, 'sk-ant-nontty-test');
    assert.equal(creds.baseUrl, 'https://nontty.example.com');
  });

  it('env ANTHROPIC_API_KEY set but empty string returns empty (not null)', () => {
    process.env.ANTHROPIC_API_KEY = '';
    const creds = readEnvCredentials();
    // `?? null` only fires on null/undefined, not empty string
    // This test documents the behavior: empty string is falsy, but the
    // consumer (runProviderStage) checks `!envCreds.apiKey` which catches it.
    assert.equal(creds.apiKey, '');
    assert.equal(creds.baseUrl, null);
  });
});

describe('Provider stage — failed vs skipped', () => {
  it('readEnvCredentials returns null apiKey when not set (verifying non-TTY path guard)', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    const creds = readEnvCredentials();
    assert.equal(creds.apiKey, null);
  });
});
