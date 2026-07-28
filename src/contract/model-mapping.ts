import { z } from 'zod';

const HCO_ROLE = z.enum(['fable', 'opus', 'sonnet', 'haiku', 'subagent']);

export const ModelMappingV1 = z
  .object({
    mapping_id: z.string().min(1).max(256),
    provider_profile_id: z.string().min(1).max(256),
    provider_model_id: z.string().min(1).max(256),
    hco_role: HCO_ROLE,
    validated: z.boolean().default(false),
    created_at: z.string().min(1).max(64),
  })
  .strict();

export type ModelMappingV1 = z.infer<typeof ModelMappingV1>;

export { HCO_ROLE };
export type HcoRole = z.infer<typeof HCO_ROLE>;
