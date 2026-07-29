import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactForDisplay } from '../src/setup/redact.js';

describe('Redact', () => {
  it('redacts Anthropic API key patterns', () => {
    const input = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456';
    const result = redact(input);
    assert.equal(result.includes('sk-ant'), false);
    assert.ok(result.includes('[REDACTED]'));
  });

  it('redacts env-file style API key assignments', () => {
    const input = 'ANTHROPIC_API_KEY=sk-ant-something';
    const result = redact(input);
    assert.equal(result.includes('sk-ant'), false);
    assert.ok(result.includes('[REDACTED]'));
  });

  it('redacts base URL env assignments', () => {
    const input = 'ANTHROPIC_BASE_URL=https://example.com/v1';
    const result = redact(input);
    assert.ok(result.includes('[REDACTED]'));
  });

  it('redacts generic KEY/SECRET/TOKEN env assignments', () => {
    assert.ok(redact('SOME_SECRET=abc').includes('[REDACTED]'));
    assert.ok(redact('API_TOKEN=abc').includes('[REDACTED]'));
    assert.ok(redact('ENCRYPTION_KEY=abc').includes('[REDACTED]'));
  });

  it('does not redact safe content', () => {
    const safe = 'HCO_DATA_DIR=/root/.hco';
    assert.equal(redact(safe), safe);
  });

  it('passes through safe strings unchanged', () => {
    const safe = 'Setup complete. HCO is ready.';
    assert.equal(redactForDisplay(safe), safe);
  });

  it('redacts secrets in display output', () => {
    const input = 'Error: ANTHROPIC_API_KEY=sk-ant-deadbeef';
    const result = redactForDisplay(input);
    assert.equal(result.includes('sk-ant'), false);
    assert.equal(result.includes('deadbeef'), false);
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const result = redact(input);
    assert.equal(result.includes('Bearer'), false);
  });

  it('no secrets in empty string', () => {
    assert.equal(redact(''), '');
  });

  it('redacts multiple patterns in one string', () => {
    const input = 'Config: ANTHROPIC_API_KEY=sk-ant-foo, url=https://bar.com/v1, bearer=abc';
    const result = redact(input);
    assert.equal(result.includes('sk-ant'), false);
    assert.equal(result.includes('[REDACTED]'), true);
  });
});
