import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, normalize, join, sep } from 'node:path';
import { lstat, access } from 'node:fs/promises';

const MAX_FILE_BYTES = 65536;

function isPathInside(child: string, parent: string): boolean {
  const nChild = normalize(child);
  const nParent = normalize(parent) + sep;
  if (process.platform === 'win32') {
    return nChild.toLowerCase().startsWith(nParent.toLowerCase());
  }
  return nChild.startsWith(nParent);
}

export async function getRepoFile(repoPath: string, relativePath: string): Promise<string> {
  if (!isAbsolute(repoPath)) {
    throw new Error('repoPath must be an absolute path');
  }

  if (isAbsolute(relativePath)) {
    throw new Error('relativePath must not be absolute');
  }

  if (relativePath.includes('..')) {
    throw new Error('relativePath must not traverse above the repository root');
  }

  let resolvedRepo: string;
  try {
    resolvedRepo = await realpath(repoPath);
  } catch {
    throw new Error('repoPath does not exist');
  }

  const fullPath = resolve(resolvedRepo, relativePath);

  // Confirm fullPath is still inside resolvedRepo after resolution
  if (!isPathInside(fullPath, resolvedRepo)) {
    throw new Error('file path escapes the repository');
  }

  // Reject any symlink component in relativePath, including parent components
  const relNormalized = normalize(relativePath);
  const segments = relNormalized.split('/').filter((s) => s !== '' && s !== '.');
  let walkPath = resolvedRepo;
  for (const seg of segments) {
    walkPath = join(walkPath, seg);
    let segStat;
    try {
      segStat = await lstat(walkPath);
    } catch {
      throw new Error('file not found');
    }
    if (segStat.isSymbolicLink()) {
      throw new Error('relativePath must not contain symbolic links');
    }
  }

  let fileStat;
  try {
    fileStat = await lstat(fullPath);
  } catch {
    throw new Error('file not found');
  }

  if (!fileStat.isFile()) {
    throw new Error('path is not a regular file');
  }

  if (fileStat.isSymbolicLink()) {
    throw new Error('symbolic links are not allowed');
  }

  if (fileStat.size > MAX_FILE_BYTES) {
    throw new Error(`file exceeds ${String(MAX_FILE_BYTES)} bytes`);
  }

  // Re-check realpath after symlink guard to resolve any indirect escapes
  let resolvedFile: string;
  try {
    resolvedFile = await realpath(fullPath);
  } catch {
    throw new Error('file not found');
  }

  // Re-check real
  if (!isPathInside(resolvedFile, resolvedRepo)) {
    throw new Error('file path escapes the repository');
  }

  try {
    await access(fullPath);
  } catch {
    throw new Error('file not readable');
  }

  try {
    const content = await readFile(fullPath, 'utf-8');
    if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_BYTES) {
      throw new Error(`file content exceeds ${String(MAX_FILE_BYTES)} bytes`);
    }
    return content;
  } catch (err) {
    if (err instanceof Error && err.message.includes('exceeds')) {
      throw err;
    }
    throw new Error('failed to read file');
  }
}
