export type ValidationProfile = 'quick' | 'standard' | 'strict';

export const VALIDATION_PROFILES: readonly ValidationProfile[] = [
  'quick',
  'standard',
  'strict',
] as const;

export class ValidationProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationProfileError';
  }
}

export function getValidationProfile(name: unknown): ValidationProfile {
  if (typeof name !== 'string') {
    throw new ValidationProfileError('Validation profile must be a string');
  }
  if (!VALIDATION_PROFILES.includes(name as ValidationProfile)) {
    throw new ValidationProfileError('Unknown validation profile');
  }
  return name as ValidationProfile;
}
