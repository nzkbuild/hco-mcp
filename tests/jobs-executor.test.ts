import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createJobExecutor } from '../src/jobs/executor.js';

describe('job executor', () => {
  it('passes bounded job input to launcher without args', async () => {
    let seen: unknown;
    const launcher = {
      launch: (input: unknown) => {
        seen = input;
        return {};
      },
    };
    await createJobExecutor(launcher as never)({
      id: 1,
      externalId: 'x',
      milestoneId: null,
      kind: 'test',
      status: 'pending',
      input: { owner: 'o', repo: 'r', repo_path: '/tmp/r', prompt: 'p' },
      output: null,
      error: null,
      createdAt: '',
      startedAt: null,
      finishedAt: null,
      updatedAt: '',
      workerId: null,
      leaseUntil: null,
    });
    assert.deepEqual(seen, { owner: 'o', repo: 'r', repoPath: '/tmp/r', prompt: 'p' });
  });

  it('rejects invalid job input', () => {
    const launcher = { launch: () => ({}) };
    const job = { input: { owner: '', repo: 'r', repo_path: '/tmp', prompt: 'p' } } as never;
    assert.throws(() => createJobExecutor(launcher as never)(job));
    assert.throws(() => createJobExecutor(launcher as never)({ ...job, input: null } as never));
    assert.throws(() => createJobExecutor(launcher as never)({ ...job, input: [] } as never));
  });
});
