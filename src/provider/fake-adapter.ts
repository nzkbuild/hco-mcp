import type { ProviderAdapter, ProviderValidationResult, ProviderHealthResult } from '../contract/provider-adapter.js';
import type { ModelInfoV1 } from '../contract/model-info.js';

const FAKE_MODELS: readonly ModelInfoV1[] = [
  {
    model_id: 'claude-sonnet-5',
    display_name: 'Claude Sonnet 5',
    provider: 'anthropic' as const,
    capabilities: ['text', 'code'],
  },
  {
    model_id: 'claude-haiku-4-5',
    display_name: 'Claude Haiku 4.5',
    provider: 'anthropic' as const,
    capabilities: ['text'],
  },
  {
    model_id: 'claude-opus-5',
    display_name: 'Claude Opus 5',
    provider: 'anthropic' as const,
    capabilities: ['text', 'code', 'tools'],
  },
];

export interface FakeProviderConfig {
  validateResult?: ProviderValidationResult;
  models?: ModelInfoV1[];
  healthResult?: ProviderHealthResult;
  providerType?: string;
}

export class FakeProviderAdapter implements ProviderAdapter {
  readonly providerType: string;

  private readonly validateResult: ProviderValidationResult;
  private readonly models: ModelInfoV1[];
  private readonly healthResult: ProviderHealthResult;

  constructor(config: FakeProviderConfig = {}) {
    this.providerType = config.providerType ?? 'test';
    this.validateResult = config.validateResult ?? {
      valid: true,
      provider_models_count: FAKE_MODELS.length,
    };
    this.models = config.models ?? [...FAKE_MODELS];
    this.healthResult = config.healthResult ?? { healthy: true, latency_ms: 42 };
  }

  validate(_profile: unknown): Promise<ProviderValidationResult> {
    return Promise.resolve(this.validateResult);
  }

  discoverModels(_profile: unknown): Promise<ModelInfoV1[]> {
    return Promise.resolve(this.models);
  }

  healthCheck(_profile: unknown): Promise<ProviderHealthResult> {
    return Promise.resolve(this.healthResult);
  }
}
