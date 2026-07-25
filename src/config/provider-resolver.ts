import type { ProviderProfileV1 } from '../contract/provider-profile.js';

export class ProviderProfileResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderProfileResolutionError';
  }
}

// ─── ProviderProfileResolver ─────────────────────────────────────────────

export class ProviderProfileResolver {
  constructor(private readonly profiles: Map<string, ProviderProfileV1>) {}

  resolve(profileId: string): ProviderProfileV1 {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new ProviderProfileResolutionError(`Provider profile "${profileId}" not found`);
    }
    return profile;
  }

  validateEnv(profile: ProviderProfileV1): void {
    if (!process.env[profile.api_key_env]) {
      throw new ProviderProfileResolutionError(
        `Required environment variable "${profile.api_key_env}" is not set for provider profile "${profile.profile_id}"`,
      );
    }
  }

  filterEnvForProvider(profile: ProviderProfileV1): Record<string, string> {
    const result: Record<string, string> = {};
    const key = process.env[profile.api_key_env];
    if (key) {
      result[profile.api_key_env] = key;
    }
    if (profile.base_url_env) {
      const url = process.env[profile.base_url_env];
      if (url) {
        result[profile.base_url_env] = url;
      }
    }
    return result;
  }

  listProfiles(): ProviderProfileV1[] {
    return Array.from(this.profiles.values());
  }
}
