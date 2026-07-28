import type { ProviderProfileV1 } from '../contract/provider-profile.js';
import type {
  ProviderAdapter,
  ProviderValidationResult,
  ProviderHealthResult,
} from '../contract/provider-adapter.js';
import type { ModelInfoV1 } from '../contract/model-info.js';

export class AnthropicProviderAdapter implements ProviderAdapter {
  readonly providerType = 'anthropic';

  async validate(profile: ProviderProfileV1): Promise<ProviderValidationResult> {
    const apiKey = process.env[profile.api_key_env];
    if (!apiKey) {
      return {
        valid: false,
        error: `Environment variable "${profile.api_key_env}" is not set`,
      };
    }

    try {
      const baseUrl = profile.base_url_env
        ? (process.env[profile.base_url_env] ?? 'https://api.anthropic.com')
        : 'https://api.anthropic.com';

      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });

      if (!response.ok) {
        return {
          valid: false,
          error: `API returned ${String(response.status)}: ${response.statusText}`,
        };
      }

      const data = (await response.json()) as { data?: { id: string }[] };
      const count = data.data?.length ?? 0;

      return {
        valid: true,
        provider_models_count: count,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { valid: false, error: message };
    }
  }

  async discoverModels(profile: ProviderProfileV1): Promise<ModelInfoV1[]> {
    const apiKey = process.env[profile.api_key_env];
    if (!apiKey) {
      return [];
    }

    try {
      const baseUrl = profile.base_url_env
        ? (process.env[profile.base_url_env] ?? 'https://api.anthropic.com')
        : 'https://api.anthropic.com';

      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        data?: { id: string; display_name?: string }[];
      };
      return (
        data.data?.map(
          (m) =>
            ({
              model_id: m.id,
              display_name: m.display_name ?? m.id,
              provider: profile.provider,
              capabilities: [],
            }) satisfies ModelInfoV1,
        ) ?? []
      );
    } catch {
      return [];
    }
  }

  async healthCheck(profile: ProviderProfileV1): Promise<ProviderHealthResult> {
    const apiKey = process.env[profile.api_key_env];
    if (!apiKey) {
      return { healthy: false, error: 'API key not set' };
    }

    const start = Date.now();
    try {
      const baseUrl = profile.base_url_env
        ? (process.env[profile.base_url_env] ?? 'https://api.anthropic.com')
        : 'https://api.anthropic.com';

      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(10_000),
      });

      const result: ProviderHealthResult = {
        healthy: response.ok,
        latency_ms: Date.now() - start,
      };
      if (!response.ok) {
        result.error = `HTTP ${String(response.status)}`;
      }
      return result;
    } catch (err: unknown) {
      return {
        healthy: false,
        latency_ms: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}
