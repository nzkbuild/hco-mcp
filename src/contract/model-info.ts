import { z } from 'zod';

export const ModelInfoV1 = z
  .object({
    model_id: z.string().min(1).max(256),
    display_name: z.string().min(1).max(512),
    provider: z.enum(['anthropic', 'openai', 'custom']),
    capabilities: z.array(z.string().min(1).max(256)).min(0).max(100).default([]),
  })
  .strict();

export type ModelInfoV1 = z.infer<typeof ModelInfoV1>;
