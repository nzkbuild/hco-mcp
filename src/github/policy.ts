export type AllowedAction = 'status' | 'create_pr' | 'merge_pr';

export class LifecyclePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifecyclePolicyError';
  }
}

export interface LifecyclePolicyInput {
  action: string;
  owner: string;
  repo: string;
  title?: string;
  body?: string;
  approve?: boolean;
}

export interface LifecyclePolicyResult {
  action: AllowedAction;
  approved: boolean;
}

const REJECTED = new Set([
  'publish',
  'tag',
  'release',
  'deploy',
  'billing',
  'secret_rotation',
  'destructive',
]);

function bound(value: unknown, name: string, max: number, required = true): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw new LifecyclePolicyError(`${name} is invalid`);
  }
  return value;
}

export function checkLifecyclePolicy(input: unknown): LifecyclePolicyResult {
  if (typeof input !== 'object' || input === null)
    throw new LifecyclePolicyError('input is invalid');
  const value = input as Partial<LifecyclePolicyInput>;
  if (typeof value.action !== 'string' || REJECTED.has(value.action)) {
    throw new LifecyclePolicyError('action is rejected');
  }
  if (value.action !== 'status' && value.action !== 'create_pr' && value.action !== 'merge_pr') {
    throw new LifecyclePolicyError('action is unknown');
  }
  bound(value.owner, 'owner', 256);
  bound(value.repo, 'repo', 256);
  bound(value.title, 'title', 256, false);
  bound(value.body, 'body', 65536, false);
  if (value.action !== 'status' && value.approve !== true) {
    throw new LifecyclePolicyError('explicit approval required');
  }
  return { action: value.action, approved: value.action === 'status' || value.approve === true };
}
