import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatCliReport } from '../src/reporting/cli.js';

describe('CLI report formatter', () => {
  it('formats bounded sanitized output through shared formatter', () => {
    const output = formatCliReport({
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
