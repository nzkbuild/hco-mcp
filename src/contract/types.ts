import { z } from 'zod';

export const CONTRACT_VERSION = z.literal(1);
export type ContractVersion = z.infer<typeof CONTRACT_VERSION>;

export const EXECUTION_STATUS = z.enum([
  'accepted',
  'queued',
  'running',
  'awaiting_input',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'archived',
]);
export type ExecutionStatus = z.infer<typeof EXECUTION_STATUS>;

export const TERMINAL_STATUS = z.enum(['completed', 'failed', 'cancelled', 'timed_out']);
export type TerminalStatus = z.infer<typeof TERMINAL_STATUS>;

export const VALIDATION_PROFILE = z.enum(['quick', 'standard', 'strict']);
export type ValidationProfileValue = z.infer<typeof VALIDATION_PROFILE>;
