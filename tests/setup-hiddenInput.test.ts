import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hiddenInput } from '../src/setup/prompts.js';

describe('hiddenInput', () => {
  it('throws in non-TTY mode with actionable message', () => {
    const origStdout = process.stdout.isTTY;
    const origStdin = process.stdin.isTTY;
    process.stdout.isTTY = false;
    process.stdin.isTTY = false;

    try {
      assert.throws(
        () => { hiddenInput('Key: '); },
        /Hidden input requires an interactive terminal/,
      );
    } finally {
      process.stdout.isTTY = origStdout;
      process.stdin.isTTY = origStdin;
    }
  });

  it('is a function with arity 1', () => {
    assert.equal(typeof hiddenInput, 'function');
    assert.equal(hiddenInput.length, 1);
  });
});
