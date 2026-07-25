import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { CONTRACT_VERSION } from './types.js';
import { ClaudeConfigurationV1 } from './claude-configuration.js';

const ID_STRING = z.string().min(1).max(256);
const LONG_STRING = z.string().min(1).max(65536);
const CONTEXT_STRING = z.string().min(0).max(200_000).default('');
const ARRAY_ITEM = z.string().min(1).max(4096);

const CONSTRAINTS_ARRAY = z.array(ARRAY_ITEM).min(0).max(100).default([]);
const CRITERIA_ARRAY = z.array(ARRAY_ITEM).min(0).max(100).default([]);
const VALIDATION_ARRAY = z.array(ARRAY_ITEM).min(0).max(50).default([]);

const IDEMPOTENCY_KEY = ID_STRING.optional();

const REPOSITORY_SCHEMA = z
  .object({
    owner: ID_STRING,
    repo: ID_STRING,
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((p) => p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p), {
        message: 'path must be an absolute path',
      }),
  })
  .strict();

const BRIEF_SCHEMA = z
  .object({
    original_request: LONG_STRING,
    objective: LONG_STRING,
    context: CONTEXT_STRING,
    constraints: CONSTRAINTS_ARRAY,
    acceptance_criteria: CRITERIA_ARRAY,
    requested_validation: VALIDATION_ARRAY,
  })
  .strict();

function generateRequestId(): string {
  return `req-${randomUUID()}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

export const ExecutionRequestV1 = z
  .object({
    schema_version: CONTRACT_VERSION.default(1),
    request_id: ID_STRING.default(generateRequestId),
    idempotency_key: IDEMPOTENCY_KEY,
    brief: BRIEF_SCHEMA,
    claude_config: ClaudeConfigurationV1,
    repository: REPOSITORY_SCHEMA,
    policy_ref: ID_STRING,
    hermes_trace_id: ID_STRING.optional(),
    submitted_at: z.string().default(isoNow),
  })
  .strict();

export type ExecutionRequestV1 = z.infer<typeof ExecutionRequestV1>;
