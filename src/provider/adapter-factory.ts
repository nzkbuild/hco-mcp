import type {
  ProviderAdapter,
  ProviderHealthResult,
  ProviderValidationResult,
} from '../contract/provider-adapter.js';
import type { ProviderProfileV1 } from '../contract/provider-profile.js';
import type { ModelInfoV1 } from '../contract/model-info.js';
import { AnthropicProviderAdapter } from './anthropic-adapter.js';

function stubResult(): ProviderValidationResult {
  return { valid: false, error: 'Provider type not yet implemented' };
}

function stubHealth(): ProviderHealthResult {
  return { healthy: false, error: 'Provider type not yet implemented' };
}

function stubModels(): Promise<ModelInfoV1[]> {
  return Promise.resolve([]);
}

const stubAdapter: ProviderAdapter = {
  providerType: 'stub',
  validate: () => Promise.resolve(stubResult()),
  discoverModels: () => stubModels(),
  healthCheck: () => Promise.resolve(stubHealth()),
};

export function createProviderAdapter(profile: ProviderProfileV1): ProviderAdapter {
  switch (profile.provider) {
    case 'anthropic':
      return new AnthropicProviderAdapter();
    case 'openai':
    case 'custom':
      return { ...stubAdapter, providerType: profile.provider };
    default:
      return stubAdapter;
  }
}
