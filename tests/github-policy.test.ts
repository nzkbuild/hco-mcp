import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { checkLifecyclePolicy, LifecyclePolicyError } from '../src/github/policy.js';

describe('GitHub lifecycle policy', () => {
  it('allows status and approved PR actions', () => {
    assert.equal(checkLifecyclePolicy({ action: 'status', owner: 'o', repo: 'r' }).approved, true);
    assert.equal(
      checkLifecyclePolicy({ action: 'create_pr', owner: 'o', repo: 'r', approve: true }).approved,
      true,
    );
    assert.equal(
      checkLifecyclePolicy({ action: 'merge_pr', owner: 'o', repo: 'r', approve: true }).approved,
      true,
    );
  });

  it('rejects dangerous, unknown, unapproved, and invalid actions', () => {
    for (const action of [
      'publish',
      'tag',
      'release',
      'deploy',
      'billing',
      'secret_rotation',
      'destructive',
      'wat',
    ]) {
      assert.throws(
        () => checkLifecyclePolicy({ action, owner: 'o', repo: 'r' }),
        LifecyclePolicyError,
      );
    }
    assert.throws(
      () => checkLifecyclePolicy({ action: 'merge_pr', owner: 'o', repo: 'r' }),
      LifecyclePolicyError,
    );
    assert.throws(
      () => checkLifecyclePolicy({ action: 'status', owner: '', repo: 'r' }),
      LifecyclePolicyError,
    );
  });
});
