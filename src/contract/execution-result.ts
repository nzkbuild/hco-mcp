import { z } from 'zod';
import { CONTRACT_VERSION, TERMINAL_STATUS } from './types.js';

const ID_STRING = z.string().min(1).max(256);

const ARTIFACT_REFERENCE = z
  .object({
    key: z.string().min(1).max(256),
    artifact_id: ID_STRING,
    content_type: z.string().min(1).max(256),
    byte_length: z.number().int().min(0).max(1_073_741_824),
  })
  .strict();

const SUMMARY = z
  .object({
    exit_code: z.number().int().min(-255).max(255).nullable(),
    duration_ms: z.number().int().min(0).max(86_400_000),
    artifacts: z.array(ARTIFACT_REFERENCE).min(0).max(200).default([]),
  })
  .strict();

const COMMAND_RESULT = z
  .object({
    command: z.string().min(1).max(4096),
    exit_code: z.number().int().min(-255).max(255),
    passed: z.boolean(),
  })
  .strict();

const VALIDATION_RESULT = z
  .object({
    profile: z.string().min(1).max(256),
    passed: z.boolean(),
    command_results: z.array(COMMAND_RESULT).min(0).max(500).optional(),
  })
  .strict();

const ERROR_INFO = z
  .object({
    code: z.string().min(1).max(256),
    message: z.string().min(1).max(4096),
  })
  .strict();

const PROCESS_ATTEMPT_SUMMARY = z
  .object({
    attempt_number: z.number().int().min(1).max(1000),
    total_attempts: z.number().int().min(1).max(1000),
    retry_reason: z.string().min(1).max(4096).optional(),
  })
  .strict();

export const ExecutionResultV1 = z
  .object({
    schema_version: CONTRACT_VERSION.default(1),
    execution_id: ID_STRING,
    status: TERMINAL_STATUS,
    claude_session_id: ID_STRING,
    summary: SUMMARY,
    validation_results: z.array(VALIDATION_RESULT).min(0).max(50).optional(),
    error: ERROR_INFO.optional(),
    process_attempt_summary: PROCESS_ATTEMPT_SUMMARY.optional(),
    submitted_at: z.string().min(1).max(64),
    started_at: z.string().min(1).max(64).nullable().optional(),
    finished_at: z.string().min(1).max(64),
  })
  .strict();

export type ExecutionResultV1 = z.infer<typeof ExecutionResultV1>;
