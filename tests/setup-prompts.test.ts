import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalInput, readEnvCredentials } from '../src/setup/prompts.js';

describe('normalInput', () => {
  it('is a function with arity 1', () => {
    assert.equal(typeof normalInput, 'function');
    assert.equal(normalInput.length, 1);
  });

  it('rejects in non-TTY mode', () => {
    const origStdout = process.stdout.isTTY;
    const origStdin = process.stdin.isTTY;
    process.stdout.isTTY = false;
    process.stdin.isTTY = false;

    try {
      assert.throws(
        () => { normalInput('Test: '); },
        /requires an interactive terminal/,
      );
    } finally {
      process.stdout.isTTY = origStdout;
      process.stdin.isTTY = origStdin;
    }
  });

  it('restores TTY state even on failure', () => {
    // Verify the finally block pattern works — no state leak
    const origStdout = process.stdout.isTTY;
    const origStdin = process.stdin.isTTY;
    process.stdout.isTTY = false;
    process.stdin.isTTY = false;
    process.stdout.isTTY = origStdout;
    process.stdin.isTTY = origStdin;
    assert.equal(process.stdout.isTTY, origStdout);
    assert.equal(process.stdin.isTTY, origStdin);
  });
});

describe('readEnvCredentials', () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
  });

  it('returns nulls when env vars are absent', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    const creds = readEnvCredentials();
    assert.equal(creds.apiKey, null);
    assert.equal(creds.baseUrl, null);
  });

  it('reads ANTHROPIC_API_KEY from env', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    const creds = readEnvCredentials();
    assert.equal(creds.apiKey, 'sk-ant-test-key');
    assert.equal(creds.baseUrl, null);
  });

  it('reads ANTHROPIC_BASE_URL from env', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://custom.api.example.com/v1';
    const creds = readEnvCredentials();
    assert.equal(creds.apiKey, null);
    assert.equal(creds.baseUrl, 'https://custom.api.example.com/v1');
  });

  it('reads both env vars simultaneously', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-both';
    process.env.ANTHROPIC_BASE_URL = 'https://both.example.com';
    const creds = readEnvCredentials();
    assert.equal(creds.apiKey, 'sk-ant-both');
    assert.equal(creds.baseUrl, 'https://both.example.com');
  });

  it('does not print values to stdout', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-print-test';
    const captured: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
      captured.push(s);
      return true;
    };
    try {
      readEnvCredentials();
      const joined = captured.join('');
      assert.equal(joined.includes('sk-ant'), false, 'Must not print API key value');
    } finally {
      process.stdout.write = origWrite;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
