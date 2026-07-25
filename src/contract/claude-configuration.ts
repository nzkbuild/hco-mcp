import { z } from 'zod';
import { VALIDATION_PROFILE } from './types.js';

const PROFILE_ID = z.string().min(1).max(256).optional();

const SKILL_NAME = z.string().min(1).max(256);

const THINKING_EFFORT = z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional();

const PERMISSION_MODE = z
  .enum(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'])
  .optional();

const SESSION_MODE = z.enum(['default', 'continue']);

const SESSION_ID = z.string().min(1).max(256);

const OVERRIDES_SCHEMA = z
  .object({
    model: z.string().min(1).max(256).optional(),
    thinking_effort: THINKING_EFFORT,
    skills: z.array(SKILL_NAME).min(1).max(50).optional(),
    permission_mode: PERMISSION_MODE,
  })
  .strict('Overrides contain unknown keys')
  .optional();

export const ClaudeConfigurationV1 = z
  .object({
    profile: PROFILE_ID,
    provider_profile: PROFILE_ID,
    model: z.string().min(1).max(256).optional(),
    thinking_effort: THINKING_EFFORT,
    skills: z.array(SKILL_NAME).min(0).max(50).default([]),
    permission_mode: PERMISSION_MODE,
    validation_profile: VALIDATION_PROFILE.optional(),
    session_mode: SESSION_MODE.default('default'),
    continuation_session_id: SESSION_ID.optional(),
    timeout_ms: z.number().int().min(1_000).max(3_600_000).optional(),
    overrides: OVERRIDES_SCHEMA,
  })
  .refine(
    (data) => {
      if (data.session_mode === 'continue' && !data.continuation_session_id) {
        return false;
      }
      return true;
    },
    {
      message: 'continuation_session_id is required when session_mode is "continue"',
      path: ['continuation_session_id'],
    },
  )
  .refine(
    (data) => {
      if (data.session_mode === 'default' && data.continuation_session_id) {
        return false;
      }
      return true;
    },
    {
      message: 'continuation_session_id must not be set when session_mode is "default"',
      path: ['continuation_session_id'],
    },
  );

export type ClaudeConfigurationV1 = z.infer<typeof ClaudeConfigurationV1>;
