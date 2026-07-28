import type { ModelInfoV1 } from './model-info.js';
import type { ProviderProfileV1 } from './provider-profile.js';

export interface ProviderValidationResult {
  valid: boolean;
  error?: string;
  provider_models_count?: number;
}

export interface ProviderHealthResult {
  healthy: boolean;
  latency_ms?: number;
  error?: string;
}

export interface ProviderAdapter {
  readonly providerType: string;
  validate(profile: ProviderProfileV1): Promise<ProviderValidationResult>;
  discoverModels(profile: ProviderProfileV1): Promise<ModelInfoV1[]>;
  healthCheck(profile: ProviderProfileV1): Promise<ProviderHealthResult>;
}
