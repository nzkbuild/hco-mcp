import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { getValidationProfile, ValidationProfileError } from '../src/validation/profile.js';

describe('validation profiles', () => {
  it('accepts quick, standard, strict', () => {
    assert.equal(getValidationProfile('quick'), 'quick');
    assert.equal(getValidationProfile('standard'), 'standard');
    assert.equal(getValidationProfile('strict'), 'strict');
  });

  it('rejects invalid values with stable error', () => {
    assert.throws(() => getValidationProfile('unsafe'), ValidationProfileError);
    assert.throws(() => getValidationProfile(1), ValidationProfileError);
  });
});
