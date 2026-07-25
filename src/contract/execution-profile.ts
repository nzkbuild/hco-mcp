import { z } from 'zod';
import { CONTRACT_VERSION } from './types.js';

const PROFILE_ID = z.string().min(1).max(256);
const REPO_ENTRY = z.object({
  owner: z.string().min(1).max(256),
  repo: z.string().min(1).max(256),
});
const OVERRIDE_KEY = z.string().min(1).max(256);
const ENV_KEY = z.string().min(1).max(256);

const THINKING_EFFORT = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
const PERMISSION_MODE = z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']);

const CLAUDE_DEFAULTS = z
  .object({
    binary_path: z.string().min(1).max(4096).optional(),
    default_model: z.string().min(1).max(256).optional(),
    default_thinking_effort: THINKING_EFFORT.optional(),
    default_timeout_ms: z.number().int().min(1000).max(3_600_000),
    session_dir: z.string().min(1).max(4096),
  })
  .strict();

const PROVIDER_RESTRICTIONS = z
  .object({
    allowed_models: z.array(z.string().min(1).max(256)).min(1).max(100).optional(),
    allowed_thinking_efforts: z.array(THINKING_EFFORT).min(1).max(5).optional(),
  })
  .strict()
  .optional();

const PERMISSION_DEFAULTS = z
  .object({
    mode: PERMISSION_MODE.optional(),
    allowed_tools: z.array(z.string().min(1).max(256)).min(1).max(200).optional(),
  })
  .strict()
  .optional();

const VALIDATION_DEFAULTS = z
  .object({
    profile: z.enum(['quick', 'standard', 'strict']).optional(),
    post_execution: z.boolean().optional(),
  })
  .strict()
  .optional();

const OUTPUT_LIMITS = z
  .object({
    inline_response_max_bytes: z.number().int().min(1024).max(1_048_576).optional(),
    event_chunk_max_bytes: z.number().int().min(1024).max(1_048_576).optional(),
    artifact_max_bytes: z.number().int().min(1024).max(1_073_741_824).optional(),
    total_max_bytes: z.number().int().min(1024).max(1_073_741_824).optional(),
  })
  .strict()
  .optional();

export const ExecutionProfileV1 = z
  .object({
    schema_version: CONTRACT_VERSION.default(1),
    profile_id: PROFILE_ID,
    claude_defaults: CLAUDE_DEFAULTS,
    allowed_overrides: z.array(OVERRIDE_KEY).min(0).max(50).default([]),
    repository_allowlist: z.array(REPO_ENTRY).min(1).max(500),
    provider_restrictions: PROVIDER_RESTRICTIONS,
    permission_defaults: PERMISSION_DEFAULTS,
    validation_defaults: VALIDATION_DEFAULTS,
    max_prompt_bytes: z.number().int().min(1).max(1_048_576).optional(),
    max_execution_time_ms: z.number().int().min(1000).max(3_600_000).optional(),
    max_concurrent_executions: z.number().int().min(0).max(64).optional(),
    environment_allowlist: z.array(ENV_KEY).min(0).max(200).optional(),
    approval_required: z.boolean().optional(),
    output_limits: OUTPUT_LIMITS,
  })
  .strict();

export type ExecutionProfileV1 = z.infer<typeof ExecutionProfileV1>;
