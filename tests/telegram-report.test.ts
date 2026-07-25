import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatTelegramReport } from '../src/validation/telegram.js';

describe('Telegram report formatter', () => {
  it('formats and redacts report', () => {
    const text = formatTelegramReport({
      kind: 'job',
      id: '1',
      status: 'done',
      detail: 'token=abc /root/x',
    });
    assert.match(text, /job 1: done/);
    assert.doesNotMatch(text, /abc|\/root/);
  });

  it('redacts Windows, relative paths, and labeled secrets', () => {
    const text = formatTelegramReport({
      kind: 'job',
      id: '1',
      status: 'failed',
      detail: 'secret=abc C:\\Users\\bell\\x ./tmp/file ../private/file foo/bar',
    });
    assert.doesNotMatch(text, /abc|Users|private|\.\/|\.\.\//);
    assert.match(text, /\[REDACTED\]/);
  });
  it('caps report length', () => {
    assert.equal(
      formatTelegramReport({ kind: 'x', id: '1', status: 'x', detail: 'a'.repeat(5000) }).length,
      4096,
    );
  });
});

void assert;
