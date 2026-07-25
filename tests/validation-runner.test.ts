import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { getValidationProfile } from '../src/validation/profile.js';
import { PROFILE_COMMANDS, runValidation } from '../src/validation/runner.js';

describe('validation runner', () => {
  it('uses fixed command profiles', () => {
    assert.deepEqual(PROFILE_COMMANDS.quick, [{ command: 'npm', args: ['run', 'build'] }]);
    assert.equal(PROFILE_COMMANDS.standard.length, 2);
    assert.equal(PROFILE_COMMANDS.strict.length, 5);
  });
});

void assert;
