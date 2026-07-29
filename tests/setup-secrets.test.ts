import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactForDisplay } from '../src/setup/redact.js';

describe('Secret sanitization', () => {
  it('redacts Anthropic API key in error messages', () => {
    const msg = 'Validation failed: ANTHROPIC_API_KEY=sk-ant-api03-abc123xyz';
    const result = redact(msg);
    assert.equal(result.includes('sk-ant'), false);
    assert.ok(result.includes('[REDACTED]'));
  });

  it('redacts base URL env assignments', () => {
    const msg = 'ANTHROPIC_BASE_URL=https://custom.api.example.com/v1';
    const result = redact(msg);
    assert.equal(result.includes('https://custom.api.example.com'), false);
    assert.ok(result.includes('[REDACTED]'));
  });

  it('redacts any env-file line containing KEY/SECRET/TOKEN/PASSWORD', () => {
    const cases = [
      'MY_API_KEY=secret123',
      'DATABASE_SECRET=dbpass',
      'GITHUB_TOKEN=ghp_abc123',
      'DB_PASSWORD=supersecret',
    ];
    for (const c of cases) {
      const result = redact(c);
      assert.equal(result.includes('secret123'), false, `Failed for: ${c}`);
      assert.ok(result.includes('[REDACTED]'), `Failed for: ${c}`);
    }
  });

  it('redacts Bearer token auth headers', () => {
    const msg = 'Authorization: Bearer sk-ant-api03-deadbeef';
    const result = redact(msg);
    assert.equal(result.includes('sk-ant'), false);
  });

  it('redacts provider API key in validation error', () => {
    const err = 'Provider validation failed: Invalid API key: sk-ant-api03-abcdefghijklmnopqrstuv';
    const result = redactForDisplay(err);
    assert.equal(result.includes('sk-ant'), false);
  });

  it('redacts secrets in multi-line output', () => {
    const multi = 'Line 1: safe\nANTHROPIC_API_KEY=sk-ant-secret123\nLine 3: safe';
    const result = redact(multi);
    assert.ok(result.includes('Line 1: safe'));
    assert.ok(result.includes('Line 3: safe'));
    assert.equal(result.includes('sk-ant'), false);
    assert.ok(result.includes('[REDACTED]'));
  });

  it('does not redact safe content', () => {
    const safe = 'This is a normal message about provider configuration.';
    assert.equal(redact(safe), safe);
  });

  it('passes through empty string unchanged', () => {
    assert.equal(redact(''), '');
  });

  it('redacts executable path env vars but not safe env vars', () => {
    const msg = 'PATH=/usr/bin\nANTHROPIC_API_KEY=sk-ant-deadbeef\nHOME=/root';
    const result = redact(msg);
    assert.ok(result.includes('PATH=/usr/bin'));
    assert.ok(result.includes('HOME=/root'));
    assert.equal(result.includes('sk-ant'), false);
  });

  it('redacts export-prefixed secret assignments', () => {
    const msg = 'export ANTHROPIC_API_KEY=sk-ant-exported';
    const result = redact(msg);
    assert.equal(result.includes('sk-ant'), false);
  });

  it('redactForDisplay returns unchanged text when nothing redacted', () => {
    const safe = 'All systems operational.';
    assert.equal(redactForDisplay(safe), safe);
  });

  it('redactForDisplay returns redacted text when secrets found', () => {
    const secret = 'Key: sk-ant-api03-abcdefghijklmnopqrstuv';
    const result = redactForDisplay(secret);
    assert.notEqual(result, secret);
    assert.equal(result.includes('sk-ant'), false);
  });

  it('redacts raw API key in setup error messages', () => {
    const err =
      'Setup failed during provider stage: Failed to validate key sk-ant-api03-abcdefghijklmnopqrstuv';
    const result = redactForDisplay(err);
    assert.equal(result.includes('sk-ant'), false);
    assert.ok(result.includes('provider stage'));
  });
});
