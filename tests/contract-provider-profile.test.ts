import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderProfileV1 } from '../src/contract/provider-profile.js';

describe('ProviderProfileV1', () => {
  it('accepts valid minimal anthropic profile', () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'test-profile',
      provider: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
    });
    assert.equal(profile.profile_id, 'test-profile');
    assert.equal(profile.provider, 'anthropic');
    assert.equal(profile.api_key_env, 'ANTHROPIC_API_KEY');
    assert.equal(profile.schema_version, 1);
  });

  it('accepts openai provider type', () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'openai-profile',
      provider: 'openai',
      api_key_env: 'OPENAI_API_KEY',
    });
    assert.equal(profile.provider, 'openai');
  });

  it('accepts custom provider type', () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'custom-profile',
      provider: 'custom',
      api_key_env: 'CUSTOM_KEY',
    });
    assert.equal(profile.provider, 'custom');
  });

  it('rejects unknown provider types', () => {
    assert.throws(
      () =>
        ProviderProfileV1.parse({
          profile_id: 'p',
          provider: 'unknown',
          api_key_env: 'KEY',
        }),
      /provider/,
    );
  });

  it('accepts optional provider_metadata', () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'meta-profile',
      provider: 'anthropic',
      api_key_env: 'KEY',
      provider_metadata: { region: 'us-east', tier: 'enterprise' },
    });
    assert.deepEqual(profile.provider_metadata, {
      region: 'us-east',
      tier: 'enterprise',
    });
  });

  it('accepts full profile with all optional fields', () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'full-profile',
      provider: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
      base_url_env: 'ANTHROPIC_BASE_URL',
      default_model: 'claude-sonnet-5',
      schema_version: 1,
    });
    assert.equal(profile.base_url_env, 'ANTHROPIC_BASE_URL');
    assert.equal(profile.default_model, 'claude-sonnet-5');
  });

  it('rejects missing api_key_env', () => {
    assert.throws(
      () => ProviderProfileV1.parse({ profile_id: 'p', provider: 'anthropic' }),
      /api_key_env/,
    );
  });

  it('rejects empty profile_id', () => {
    assert.throws(
      () =>
        ProviderProfileV1.parse({
          profile_id: '',
          provider: 'anthropic',
          api_key_env: 'KEY',
        }),
      /profile_id/,
    );
  });

  it('serializes and deserializes predictably', () => {
    const input = {
      profile_id: 'round-trip',
      provider: 'anthropic' as const,
      api_key_env: 'ANTHROPIC_API_KEY',
      base_url_env: 'ANTHROPIC_BASE_URL',
    };
    const parsed = ProviderProfileV1.parse(input);
    const json = JSON.stringify(parsed);
    const round = ProviderProfileV1.parse(JSON.parse(json));
    assert.equal(round.profile_id, input.profile_id);
    assert.equal(round.api_key_env, input.api_key_env);
    assert.equal(round.base_url_env, input.base_url_env);
  });
});
