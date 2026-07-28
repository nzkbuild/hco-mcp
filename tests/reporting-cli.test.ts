import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatTelegramReport } from '../src/integrations/telegram.js';

describe('CLI report formatter', () => {
  it('formats bounded sanitized output through shared formatter', () => {
    const output = formatTelegramReport({
      kind: 'job',
      id: '1',
      status: 'done',
      detail: 'secret=x /tmp/a',
    });
    assert.match(output, /job 1: done/);
    assert.doesNotMatch(output, /secret=x|\/tmp/);
    assert.ok(output.length <= 4096);
  });
});
