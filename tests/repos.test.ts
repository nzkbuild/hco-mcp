import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { getRepoStatus } from '../src/repos/service.js';

describe('repository status', () => {
  it('reads current repository status', async () => {
    const status = await getRepoStatus(process.cwd());
    assert.equal(typeof status.branch, 'string');
    assert.ok(Array.isArray(status.entries));
    assert.equal(status.dirty, status.entries.length > 0);
  });

  it('rejects relative paths', async () => {
    await assert.rejects(() => getRepoStatus('.'), /absolute path/);
  });

  it('rejects missing paths', async () => {
    await assert.rejects(() => getRepoStatus('/tmp/hco-missing-repo'), /does not exist/);
  });
});
