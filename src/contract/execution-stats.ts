import { z } from 'zod';

export const ExecutionStatsV1 = z.object({
  period: z.string(),
  total_executions: z.number().int().min(0),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  timed_out: z.number().int().min(0),
  awaiting_input: z.number().int().min(0),
  running: z.number().int().min(0),
  queued: z.number().int().min(0),
  success_rate: z.number().min(0).max(1).optional(),
  avg_duration_ms: z.number().int().min(0).optional(),
});

export type ExecutionStatsV1 = z.infer<typeof ExecutionStatsV1>;
