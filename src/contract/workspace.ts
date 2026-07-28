import { z } from 'zod';

const WORKSPACE_STATUS = z.enum(['active', 'archived']);

export const WorkspaceV1 = z
  .object({
    workspace_id: z.string().min(1).max(256),
    repository_owner: z.string().min(1).max(256),
    repository_name: z.string().min(1).max(256),
    repository_path: z.string().min(1).max(4096),
    provider_profile_id: z.string().min(1).max(256),
    model_mapping_id: z.string().min(1).max(256).optional(),
    policy_snapshot_json: z.string().max(65536).optional(),
    environment_profile_json: z.string().max(65536).optional(),
    status: WORKSPACE_STATUS.default('active'),
    created_at: z.string().min(1).max(64),
    last_resumed_at: z.string().min(1).max(64).optional(),
  })
  .strict();

export type WorkspaceV1 = z.infer<typeof WorkspaceV1>;
