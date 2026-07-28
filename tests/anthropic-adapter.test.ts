import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeProviderAdapter } from '../src/provider/fake-adapter.js';
import { createProviderAdapter } from '../src/provider/adapter-factory.js';
import { ProviderProfileV1 } from '../src/contract/provider-profile.js';

describe('FakeProviderAdapter', () => {
  it('validate returns valid by default', async () => {
    const adapter = new FakeProviderAdapter();
    const result = await adapter.validate({});
    assert.equal(result.valid, true);
    assert.ok(
      typeof result.provider_models_count === 'number',
    );
  });

  it('validate returns configured result', async () => {
    const adapter = new FakeProviderAdapter({
      validateResult: { valid: false, error: 'bad key' },
    });
    const result = await adapter.validate({});
    assert.equal(result.valid, false);
    assert.equal(result.error, 'bad key');
  });

  it('discoverModels returns sample models by default', async () => {
    const adapter = new FakeProviderAdapter();
    const models = await adapter.discoverModels({});
    assert.ok(models.length >= 3);
    assert.equal(models[0].provider, 'anthropic');
    assert.ok(models.every((m) => m.model_id.length > 0));
  });

  it('discoverModels returns configured models', async () => {
    const customModels = [
      { model_id: 'custom-1', display_name: 'Custom', provider: 'anthropic' as const, capabilities: [] },
    ];
    const adapter = new FakeProviderAdapter({ models: customModels });
    const models = await adapter.discoverModels({});
    assert.equal(models.length, 1);
    assert.equal(models[0].model_id, 'custom-1');
  });

  it('healthCheck returns healthy by default', async () => {
    const adapter = new FakeProviderAdapter();
    const result = await adapter.healthCheck({});
    assert.equal(result.healthy, true);
    assert.ok(typeof result.latency_ms === 'number');
  });

  it('healthCheck returns configured result', async () => {
    const adapter = new FakeProviderAdapter({
      healthResult: { healthy: false, error: 'timeout' },
    });
    const result = await adapter.healthCheck({});
    assert.equal(result.healthy, false);
    assert.equal(result.error, 'timeout');
  });
});

describe('ProviderAdapterFactory', () => {
  it('returns AnthropicProviderAdapter for anthropic', () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'test',
      provider: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
    });
    const adapter = createProviderAdapter(profile);
    assert.equal(adapter.providerType, 'anthropic');
  });

  it('returns stub adapter for openai', () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'test',
      provider: 'openai',
      api_key_env: 'OPENAI_API_KEY',
    });
    const adapter = createProviderAdapter(profile);
    assert.equal(adapter.providerType, 'openai');
  });

  it('returns stub adapter for custom', () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'test',
      provider: 'custom',
      api_key_env: 'CUSTOM_KEY',
    });
    const adapter = createProviderAdapter(profile);
    assert.equal(adapter.providerType, 'custom');
  });

  it('stub adapter validate returns not implemented', async () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'test',
      provider: 'openai',
      api_key_env: 'KEY',
    });
    const adapter = createProviderAdapter(profile);
    const result = await adapter.validate(profile);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('not yet implemented'));
  });

  it('stub adapter healthCheck returns not healthy', async () => {
    const profile = ProviderProfileV1.parse({
      profile_id: 'test',
      provider: 'custom',
      api_key_env: 'KEY',
    });
    const adapter = createProviderAdapter(profile);
    const result = await adapter.healthCheck(profile);
    assert.equal(result.healthy, false);
  });
});
