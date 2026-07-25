import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { ClaudeConfigurationV1 } from '../src/contract/claude-configuration.js';

describe('ClaudeConfigurationV1', () => {
  it('accepts empty object with defaults', () => {
    const cfg = ClaudeConfigurationV1.parse({});
    assert.equal(cfg.profile, undefined);
    assert.equal(cfg.provider_profile, undefined);
    assert.equal(cfg.model, undefined);
    assert.equal(cfg.thinking_effort, undefined);
    assert.equal(cfg.permission_mode, undefined);
    assert.equal(cfg.validation_profile, undefined);
    assert.equal(cfg.session_mode, 'default');
    assert.equal(cfg.skills.length, 0);
    assert.equal(cfg.overrides, undefined);
  });

  it('accepts all fields when valid', () => {
    const cfg = ClaudeConfigurationV1.parse({
      profile: 'toche-builder',
      provider_profile: 'toche-creds',
      model: 'claude-sonnet-5',
      thinking_effort: 'high',
      skills: ['rust', 'release-audit'],
      permission_mode: 'acceptEdits',
      validation_profile: 'standard',
      session_mode: 'continue',
      continuation_session_id: 'claude-alice-demo-l2k3j4',
      timeout_ms: 300_000,
      overrides: { model: 'claude-opus-5' },
    });

    assert.equal(cfg.profile, 'toche-builder');
    assert.equal(cfg.provider_profile, 'toche-creds');
    assert.equal(cfg.model, 'claude-sonnet-5');
    assert.equal(cfg.thinking_effort, 'high');
    assert.deepEqual(cfg.skills, ['rust', 'release-audit']);
    assert.equal(cfg.permission_mode, 'acceptEdits');
    assert.equal(cfg.validation_profile, 'standard');
    assert.equal(cfg.session_mode, 'continue');
    assert.equal(cfg.continuation_session_id, 'claude-alice-demo-l2k3j4');
    assert.equal(cfg.timeout_ms, 300_000);
    assert.deepEqual(cfg.overrides, { model: 'claude-opus-5' });
  });

  it('rejects invalid profile (empty string)', () => {
    const r = ClaudeConfigurationV1.safeParse({ profile: '' });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some((i) => i.path.includes('profile')));
    }
  });

  it('rejects invalid profile (too long)', () => {
    const r = ClaudeConfigurationV1.safeParse({ profile: 'a'.repeat(257) });
    assert.equal(r.success, false);
  });

  it('rejects invalid provider_profile (empty string)', () => {
    const r = ClaudeConfigurationV1.safeParse({ provider_profile: '' });
    assert.equal(r.success, false);
  });

  it('rejects invalid model (empty string)', () => {
    const r = ClaudeConfigurationV1.safeParse({ model: '' });
    assert.equal(r.success, false);
  });

  it('rejects thinking_effort with unknown value', () => {
    const r = ClaudeConfigurationV1.safeParse({ thinking_effort: 'super-max' });
    assert.equal(r.success, false);
  });

  it('rejects skills array with empty string element', () => {
    const r = ClaudeConfigurationV1.safeParse({ skills: ['valid', ''] });
    assert.equal(r.success, false);
  });

  it('rejects skills array exceeding max length', () => {
    const r = ClaudeConfigurationV1.safeParse({
      skills: Array.from({ length: 51 }, (_, i) => `skill-${String(i)}`),
    });
    assert.equal(r.success, false);
  });

  it('rejects invalid permission_mode', () => {
    const r = ClaudeConfigurationV1.safeParse({ permission_mode: 'dangerousMode' });
    assert.equal(r.success, false);
  });

  it('rejects invalid validation_profile', () => {
    const r = ClaudeConfigurationV1.safeParse({ validation_profile: 'extreme' });
    assert.equal(r.success, false);
  });

  it('rejects invalid session_mode', () => {
    const r = ClaudeConfigurationV1.safeParse({ session_mode: 'restart' });
    assert.equal(r.success, false);
  });

  it('rejects continuation_session_id when session_mode is default without continue', () => {
    // session_mode 'default' should not be paired with a continuation_session_id
    const r = ClaudeConfigurationV1.safeParse({
      session_mode: 'default',
      continuation_session_id: 'some-session',
    });
    assert.equal(r.success, false);
  });

  it('requires continuation_session_id when session_mode is continue', () => {
    const r = ClaudeConfigurationV1.safeParse({ session_mode: 'continue' });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some((i) => i.path.includes('continuation_session_id')));
    }
  });

  it('rejects timeout_ms below minimum', () => {
    const r = ClaudeConfigurationV1.safeParse({ timeout_ms: 0 });
    assert.equal(r.success, false);
  });

  it('rejects timeout_ms above maximum', () => {
    const r = ClaudeConfigurationV1.safeParse({ timeout_ms: 3_600_001 });
    assert.equal(r.success, false);
  });

  it('rejects overrides with unknown keys', () => {
    // overrides should only allow known keys
    const r = ClaudeConfigurationV1.safeParse({
      overrides: { api_key: 'sk-secret', unknown_field: true },
    });
    // Open question: should we strip unknowns or reject? The roadmap says reject.
    // For strict contract: reject unknown override keys.
    assert.equal(r.success, false);
  });

  it('rejects null input', () => {
    const r = ClaudeConfigurationV1.safeParse(null);
    assert.equal(r.success, false);
  });

  it('rejects string input', () => {
    const r = ClaudeConfigurationV1.safeParse('not-an-object');
    assert.equal(r.success, false);
  });

  it('serializes to JSON and parses back', () => {
    const original = ClaudeConfigurationV1.parse({
      profile: 'test',
      model: 'claude-haiku-4-5',
      skills: ['rust'],
      timeout_ms: 60_000,
    });
    const json = JSON.stringify(original);
    const roundTripped = ClaudeConfigurationV1.parse(JSON.parse(json) as unknown);
    assert.deepEqual(roundTripped, original);
  });

  it('infers correct TypeScript type (compile-time check)', () => {
    // Type-level test: if this compiles, the inferred type is correct.
    // Use z.infer<typeof schema> in an explicit type annotation.
    type Inferred = z.infer<typeof ClaudeConfigurationV1>;
    const cfg: Inferred = {
      profile: undefined,
      provider_profile: undefined,
      model: undefined,
      thinking_effort: undefined,
      skills: [],
      permission_mode: undefined,
      validation_profile: undefined,
      session_mode: 'default',
      continuation_session_id: undefined,
      timeout_ms: undefined,
      overrides: undefined,
    };
    assert.equal(cfg.session_mode, 'default');
  });
});
