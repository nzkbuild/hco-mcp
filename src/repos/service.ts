import { realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

export async function getRepoStatus(
  repoPath: string,
): Promise<{ branch: string; dirty: boolean; entries: string[] }> {
  if (!isAbsolute(repoPath)) {
    throw new Error('repoPath must be an absolute path');
  }

  let resolved: string;
  try {
    resolved = await realpath(repoPath);
  } catch {
    throw new Error('repoPath does not exist');
  }

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn('git', ['status', '--porcelain=v1', '--branch'], {
      cwd: resolved,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: Buffer[] = [];
    let total = 0;

    child.stdout.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > 65536) {
        child.kill();
        reject(new Error('git status output exceeded 65536 bytes'));
        return;
      }
      chunks.push(chunk);
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new Error('git not found'));
      } else {
        reject(new Error(`failed to spawn git: ${err.message}`));
      }
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`git exited with code ${String(code)}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
  });

  const lines = stdout.split('\n').filter((l) => l.length > 0);
  const branchLine = lines[0];
  if (branchLine === undefined) {
    throw new Error('git status produced no output');
  }
  if (!branchLine.startsWith('## ')) {
    throw new Error('unexpected git status output');
  }

  const branch = (branchLine.slice(3).split('...')[0] ?? '').replace(/\s+$/, '');

  const entries = lines.slice(1);
  const dirty = entries.length > 0;

  return { branch, dirty, entries };
}
