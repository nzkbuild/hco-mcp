import { z } from 'zod';

export const PROVIDER_STATUS = z.enum(['registered', 'validated', 'active', 'failed']);
export type ProviderStatus = z.infer<typeof PROVIDER_STATUS>;

export const VALID_PROVIDER_TRANSITIONS: Record<string, string[]> = {
  registered: ['validated', 'failed'],
  validated: ['active', 'failed'],
  active: ['failed'],
  failed: [],
};

export function isValidProviderTransition(from: ProviderStatus, to: ProviderStatus): boolean {
  return VALID_PROVIDER_TRANSITIONS[from]?.includes(to) ?? false;
}
