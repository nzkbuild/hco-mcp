import { z } from 'zod';
import { CONTRACT_VERSION } from './types.js';

const ID_STRING = z.string().min(1).max(256);

const PROVIDER_TYPE = z.enum(['anthropic']);

export const ProviderProfileV1 = z
  .object({
    schema_version: CONTRACT_VERSION.default(1),
    profile_id: ID_STRING,
    provider: PROVIDER_TYPE,
    api_key_env: ID_STRING,
    base_url_env: ID_STRING.optional(),
    default_model: ID_STRING.optional(),
  })
  .strict();

export type ProviderProfileV1 = z.infer<typeof ProviderProfileV1>;
