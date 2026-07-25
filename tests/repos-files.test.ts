import { strict as assert } from 'node:assert';
import { describe, it, before } from 'node:test';
import { writeFile, mkdir, symlink, rm, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getRepoFile } from '../src/repos/files.js';

describe('repository file inspection', () => {
  let repoRoot: string;
  let gitDir: string;

  before(async () => {
    repoRoot = resolve(tmpdir(), `hco-test-files-${String(process.pid)}`);
    gitDir = join(repoRoot, '.git');
    await mkdir(repoRoot, { recursive: true });
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(repoRoot, 'hello.txt'), 'hello world\n', 'utf-8');
    await writeFile(join(repoRoot, 'empty.txt'), '', 'utf-8');
    await mkdir(join(repoRoot, 'sub'));
    await writeFile(join(repoRoot, 'sub', 'nested.md'), '# Nested\n', 'utf-8');
  });

  it('reads an existing file by relative path', async () => {
    const content = await getRepoFile(repoRoot, 'hello.txt');
    assert.equal(content, 'hello world\n');
  });

  it('reads a file in a subdirectory', async () => {
    const content = await getRepoFile(repoRoot, 'sub/nested.md');
    assert.equal(content, '# Nested\n');
  });

  it('reads an empty file', async () => {
    const content = await getRepoFile(repoRoot, 'empty.txt');
    assert.equal(content, '');
  });

  it('rejects relative repoPath', async () => {
    await assert.rejects(() => getRepoFile('.', 'hello.txt'), /absolute path/);
  });

  it('rejects missing repoPath', async () => {
    await assert.rejects(() => getRepoFile('/tmp/hco-missing-repo', 'hello.txt'), /does not exist/);
  });

  it('rejects absolute relativePath', async () => {
    await assert.rejects(() => getRepoFile(repoRoot, '/etc/passwd'), /must not be absolute/);
  });

  it('rejects traversal via ..', async () => {
    await assert.rejects(() => getRepoFile(repoRoot, '../etc/passwd'), /traverse/);
  });

  it('rejects missing file', async () => {
    await assert.rejects(() => getRepoFile(repoRoot, 'nonexistent.txt'), /not found/);
  });

  it('rejects traversal with symlink escape', async () => {
    const linkPath = join(repoRoot, 'escape');
    await symlink('/etc', linkPath, 'dir');

    try {
      await assert.rejects(
        () => getRepoFile(repoRoot, 'escape/passwd'),
        /must not contain symbolic links/,
      );
    } finally {
      await rm(linkPath, { recursive: true, force: true });
    }
  });

  it('rejects internal symlink pointing inside repo', async () => {
    const linkPath = join(repoRoot, 'shortcut');
    const target = join(repoRoot, 'hello.txt');
    await symlink(target, linkPath, 'file');

    try {
      await assert.rejects(
        () => getRepoFile(repoRoot, 'shortcut'),
        /must not contain symbolic links/,
      );
    } finally {
      await rm(linkPath, { recursive: true, force: true });
    }
  });

  it('rejects a directory', async () => {
    await assert.rejects(() => getRepoFile(repoRoot, 'sub'), /not a regular file/);
  });
});
