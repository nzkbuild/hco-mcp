import type Database from 'better-sqlite3';
import type { ProviderProfileV1 } from '../contract/provider-profile.js';
import type {
  ProviderValidationResult,
  ProviderHealthResult,
} from '../contract/provider-adapter.js';
import type { ModelInfoV1 } from '../contract/model-info.js';
import type { ModelMappingV1 } from '../contract/model-mapping.js';
import type { ProviderStatus } from '../contract/provider-status.js';
import {
  registerProvider,
  getProvider,
  listProviders,
  updateProviderStatus,
  type ProviderRow,
} from '../state/provider-repository.js';
import { listModelMappings, updateMappingValidation } from '../state/model-mapping-repository.js';
import { createProviderAdapter } from './adapter-factory.js';

export class ProviderService {
  private readonly adapterFactory: typeof createProviderAdapter;

  constructor(
    private readonly db: Database.Database,
    adapterFactory?: typeof createProviderAdapter,
  ) {
    this.adapterFactory = adapterFactory ?? createProviderAdapter;
  }

  register(profile: ProviderProfileV1): ProviderRow {
    return registerProvider(this.db, profile);
  }

  async validate(providerId: string): Promise<ProviderValidationResult> {
    const provider = getProvider(this.db, providerId);
    if (!provider) {
      return { valid: false, error: 'Provider not found' };
    }

    const profile: ProviderProfileV1 = {
      profile_id: provider.profileId,
      provider: provider.providerType as ProviderProfileV1['provider'],
      api_key_env: provider.apiKeyEnv,
      base_url_env: provider.baseUrlEnv ?? undefined,
      default_model: provider.defaultModel ?? undefined,
      schema_version: 1,
    };

    const adapter = this.adapterFactory(profile);
    const result = await adapter.validate(profile);

    const newStatus: ProviderStatus = result.valid ? 'validated' : 'failed';
    const eventType = result.valid ? 'provider_validated' : 'provider_validation_failed';
    updateProviderStatus(this.db, providerId, newStatus, eventType);

    return result;
  }

  async discoverModels(providerId: string): Promise<ModelInfoV1[]> {
    const provider = getProvider(this.db, providerId);
    if (!provider) return [];

    const profile: ProviderProfileV1 = {
      profile_id: provider.profileId,
      provider: provider.providerType as ProviderProfileV1['provider'],
      api_key_env: provider.apiKeyEnv,
      base_url_env: provider.baseUrlEnv ?? undefined,
      default_model: provider.defaultModel ?? undefined,
      schema_version: 1,
    };

    const adapter = this.adapterFactory(profile);
    return adapter.discoverModels(profile);
  }

  recommendMappings(providerId: string, models: ModelInfoV1[]): ModelMappingV1[] {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    return models.map((model, idx) => {
      const role = inferRole(model.model_id);
      return {
        mapping_id: `mapping-${providerId}-${String(idx)}-${String(Date.now())}`,
        provider_profile_id: providerId,
        provider_model_id: model.model_id,
        hco_role: role,
        validated: false,
        created_at: now,
      } satisfies ModelMappingV1;
    });
  }

  activate(
    providerId: string,
    mappingIds: string[],
  ): { provider: ProviderRow; activated: ModelMappingV1[] } {
    for (const mid of mappingIds) {
      updateMappingValidation(this.db, mid, true);
    }
    const provider = updateProviderStatus(this.db, providerId, 'active', 'provider_activated');
    if (!provider) {
      throw new Error('Provider not found');
    }
    const mappings = listModelMappings(this.db, providerId);
    return {
      provider,
      activated: mappings
        .filter((m) => mappingIds.includes(m.mappingId))
        .map(
          (m) =>
            ({
              mapping_id: m.mappingId,
              provider_profile_id: m.providerId,
              provider_model_id: m.providerModelId,
              hco_role: m.hcoRole,
              validated: m.validated === 1,
              created_at: m.createdAt,
            }) satisfies ModelMappingV1,
        ),
    };
  }

  rollback(providerId: string): ProviderRow {
    const result = updateProviderStatus(this.db, providerId, 'failed', 'provider_rolled_back');
    if (!result) {
      throw new Error('Provider not found');
    }
    return result;
  }

  getStatus(providerId: string): {
    provider: ProviderRow;
    mappings: ModelMappingV1[];
    models?: ModelInfoV1[];
  } | null {
    const provider = getProvider(this.db, providerId);
    if (!provider) return null;

    const rawMappings = listModelMappings(this.db, providerId);
    const mappings: ModelMappingV1[] = rawMappings.map((m) => ({
      mapping_id: m.mappingId,
      provider_profile_id: m.providerId,
      provider_model_id: m.providerModelId,
      hco_role: m.hcoRole,
      validated: m.validated === 1,
      created_at: m.createdAt,
    }));

    return { provider, mappings };
  }

  listProviders(): ProviderRow[] {
    return listProviders(this.db);
  }

  async healthCheck(providerId: string): Promise<ProviderHealthResult> {
    const provider = getProvider(this.db, providerId);
    if (!provider) {
      return { healthy: false, error: 'Provider not found' };
    }

    const profile: ProviderProfileV1 = {
      profile_id: provider.profileId,
      provider: provider.providerType as ProviderProfileV1['provider'],
      api_key_env: provider.apiKeyEnv,
      base_url_env: provider.baseUrlEnv ?? undefined,
      default_model: provider.defaultModel ?? undefined,
      schema_version: 1,
    };

    const adapter = this.adapterFactory(profile);
    return adapter.healthCheck(profile);
  }
}

function inferRole(modelId: string): ModelMappingV1['hco_role'] {
  const lowered = modelId.toLowerCase();
  if (lowered.includes('opus')) return 'opus' as const;
  if (lowered.includes('sonnet')) return 'sonnet' as const;
  if (lowered.includes('haiku')) return 'haiku' as const;
  if (lowered.includes('fable')) return 'fable' as const;
  return 'subagent' as const;
}
