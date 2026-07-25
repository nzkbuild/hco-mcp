import { z } from 'zod';
import { CONTRACT_VERSION } from './types.js';

const ID_STRING = z.string().min(1).max(256);

const REPO_BOUNDARY = z
  .object({
    owner: ID_STRING,
    repo: ID_STRING,
    local_path: z.string().min(1).max(4096),
  })
  .strict();

const PERMISSION_LIMITS = z
  .object({
    allowed_tools: z.array(z.string().min(1).max(256)).min(1).max(200).optional(),
    deny_shell_access: z.boolean().optional(),
  })
  .strict();

const ARTIFACT_KEY = z.string().min(1).max(256);

const OUTPUT_LIMITS = z
  .object({
    inline_response_max_bytes: z.number().int().min(1024).max(1_048_576).optional(),
    event_chunk_max_bytes: z.number().int().min(1024).max(1_048_576).optional(),
    artifact_max_bytes: z.number().int().min(1024).max(1_073_741_824).optional(),
    total_max_bytes: z.number().int().min(1024).max(1_073_741_824).optional(),
  })
  .strict();

const AUTHORITY_MODE = z.enum(['interactive', 'auto', 'locked']);

export const PolicySnapshotV1 = z
  .object({
    schema_version: CONTRACT_VERSION.default(1),
    repository_boundary: REPO_BOUNDARY,
    working_directory_boundary: z.string().min(1).max(4096).optional(),
    permission_limits: PERMISSION_LIMITS,
    timeout_ceiling_ms: z.number().int().min(1000).max(3_600_000),
    max_concurrency: z.number().int().min(0).max(64),
    concurrency_limit: z.number().int().min(0).max(64).optional(),
    environment_allowlist: z.array(ARTIFACT_KEY).min(0).max(200).default([]),
    permitted_overrides: z.array(ARTIFACT_KEY).min(0).max(50).default([]),
    approval_required: z.boolean(),
    secret_profile_ref: ID_STRING.optional(),
    authority_mode: AUTHORITY_MODE.optional(),
    allowed_approvers: z.array(ID_STRING).min(0).max(100).optional(),
    policy_origin: z.string().min(1).max(256).optional(),
    snapshot_reason: z.string().min(1).max(256).optional(),
    output_limits: OUTPUT_LIMITS.optional(),
    snapshot_at: z.string().optional(),
  })
  .strict();

export type PolicySnapshotV1 = z.infer<typeof PolicySnapshotV1>;
