import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidProviderTransition } from '../src/contract/provider-status.js';

describe('ProviderStatus state machine', () => {
  it('allows registered -> validated transition', () => {
    assert.equal(isValidProviderTransition('registered', 'validated'), true);
  });

  it('allows registered -> failed transition', () => {
    assert.equal(isValidProviderTransition('registered', 'failed'), true);
  });

  it('allows validated -> active transition', () => {
    assert.equal(isValidProviderTransition('validated', 'active'), true);
  });

  it('allows validated -> failed transition', () => {
    assert.equal(isValidProviderTransition('validated', 'failed'), true);
  });

  it('allows active -> failed transition', () => {
    assert.equal(isValidProviderTransition('active', 'failed'), true);
  });

  it('rejects registered -> active (must go through validated)', () => {
    assert.equal(isValidProviderTransition('registered', 'active'), false);
  });

  it('rejects active -> validated (cannot go backwards)', () => {
    assert.equal(isValidProviderTransition('active', 'validated'), false);
  });

  it('rejects failed -> active (terminal state)', () => {
    assert.equal(isValidProviderTransition('failed', 'active'), false);
  });

  it('rejects failed -> any other state', () => {
    assert.equal(isValidProviderTransition('failed', 'registered'), false);
    assert.equal(isValidProviderTransition('failed', 'validated'), false);
  });

  it('rejects transition to unknown status', () => {
    assert.equal(
      isValidProviderTransition(
        'validated',
        'unknown' as Parameters<typeof isValidProviderTransition>[1],
      ),
      false,
    );
  });
});
