import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderProfileResolver,
  ProviderProfileResolutionError,
} from '../src/config/provider-resolver.js';
import { ProviderProfileV1 } from '../src/contract/provider-profile.js';
import type { ProviderProfileV1 as ProviderProfileV1Type } from '../src/contract/provider-profile.js';

describe('ProviderProfileResolver', () => {
  let resolver: ProviderProfileResolver;

  const validProfile: ProviderProfileV1Type = ProviderProfileV1.parse({
    profile_id: 'test-creds',
    provider: 'anthropic',
    api_key_env: 'TEST_ANTHROPIC_KEY',
    base_url_env: 'TEST_ANTHROPIC_URL',
  });

  before(() => {
    // Set up a test env var so validateEnv passes
    process.env.TEST_ANTHROPIC_KEY = 'sk-test-key';
    process.env.TEST_ANTHROPIC_URL = 'https://test.api.example.com';
    const profiles = new Map([[validProfile.profile_id, validProfile]]);
    resolver = new ProviderProfileResolver(profiles);
  });

  after(() => {
    delete process.env.TEST_ANTHROPIC_KEY;
    delete process.env.TEST_ANTHROPIC_URL;
  });

  it('resolve returns correct profile for known ID', () => {
    const resolved = resolver.resolve('test-creds');
    assert.equal(resolved.profile_id, 'test-creds');
    assert.equal(resolved.api_key_env, 'TEST_ANTHROPIC_KEY');
  });

  it('resolve throws for unknown ID', () => {
    assert.throws(() => resolver.resolve('unknown'), ProviderProfileResolutionError);
  });

  it('validateEnv passes when env var is set', () => {
    assert.doesNotThrow(() => {
      resolver.validateEnv(validProfile);
    });
  });

  it('validateEnv throws when env var is missing', () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'missing-key',
      provider: 'anthropic',
      api_key_env: 'MISSING_VAR_THAT_DOES_NOT_EXIST',
    });
    const r = new ProviderProfileResolver(new Map([[profile.profile_id, profile]]));
    assert.throws(() => {
      r.validateEnv(profile);
    }, ProviderProfileResolutionError);
  });

  it('filterEnvForProvider returns only provider keys', () => {
    const env = resolver.filterEnvForProvider(validProfile);
    assert.equal(env.TEST_ANTHROPIC_KEY, 'sk-test-key');
    assert.equal(env.TEST_ANTHROPIC_URL, 'https://test.api.example.com');
    // Should NOT include arbitrary env vars
    assert.equal(env.PATH, undefined);
    assert.equal(Object.keys(env).length, 2);
  });

  it('filterEnvForProvider omits unset optional keys', () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'no-url',
      provider: 'anthropic',
      api_key_env: 'TEST_ANTHROPIC_KEY',
    });
    const r = new ProviderProfileResolver(new Map([[profile.profile_id, profile]]));
    const env = r.filterEnvForProvider(profile);
    assert.equal(env.TEST_ANTHROPIC_KEY, 'sk-test-key');
    assert.equal(Object.keys(env).length, 1);
  });

  it('listProfiles returns all registered profiles', () => {
    const profiles = resolver.listProfiles();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].profile_id, 'test-creds');
  });
});
