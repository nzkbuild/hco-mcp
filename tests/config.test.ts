import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HcoConfig, defaultConfig } from '../src/config/schema.js';

describe('HcoConfig schema', () => {
  it('accepts empty input with defaults', () => {
    const cfg = HcoConfig.parse({});
    assert.equal(cfg.transport, 'stdio');
    assert.equal(cfg.logLevel, 'info');
    assert.equal(cfg.maxConcurrency, 1);
    assert.equal(cfg.allowlist.length, 0);
    assert.equal(cfg.authority.mode, 'interactive');
  });

  it('defaultConfig returns valid config', () => {
    const cfg = defaultConfig();
    assert.equal(cfg.transport, 'stdio');
  });

  it('rejects invalid transport', () => {
    const result = HcoConfig.safeParse({ transport: 'unix' });
    assert.equal(result.success, false);
  });

  it('rejects invalid log level', () => {
    const result = HcoConfig.safeParse({ logLevel: 'verbose' });
    assert.equal(result.success, false);
  });

  it('rejects negative maxConcurrency', () => {
    const result = HcoConfig.safeParse({ maxConcurrency: -1 });
    assert.equal(result.success, false);
  });

  it('rejects maxConcurrency 0', () => {
    const result = HcoConfig.safeParse({ maxConcurrency: 0 });
    assert.equal(result.success, false);
  });

  it('accepts valid allowlist entries', () => {
    const cfg = HcoConfig.parse({
      allowlist: [{ owner: 'nzkbuild', repo: 'hco-mcp', trustLevel: 'trusted' }],
    });
    assert.equal(cfg.allowlist.length, 1);
    assert.equal(cfg.allowlist[0]?.owner, 'nzkbuild');
  });

  it('rejects allowlist entry with missing owner', () => {
    const result = HcoConfig.safeParse({
      allowlist: [{ repo: 'hco-mcp' }],
    });
    assert.equal(result.success, false);
  });

  it('accepts authority policy', () => {
    const cfg = HcoConfig.parse({
      authority: { mode: 'auto', requireApprovals: true, allowedApprovers: ['alice'] },
    });
    assert.equal(cfg.authority.mode, 'auto');
    assert.equal(cfg.authority.requireApprovals, true);
  });
});
