import type { ClaudeLauncher } from '../claude/launcher.js';
import type { JobRow } from './service.js';

export function createJobExecutor(launcher: ClaudeLauncher): (job: JobRow) => Promise<void> {
  return (job: JobRow): Promise<void> => {
    const raw = job.input;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('job input is invalid');
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const input = raw as Record<string, unknown>;
    const owner = input.owner;
    const repo = input.repo;
    const repoPath = input.repo_path;
    const prompt = input.prompt;
    if (
      typeof owner !== 'string' ||
      owner.length < 1 ||
      owner.length > 256 ||
      typeof repo !== 'string' ||
      repo.length < 1 ||
      repo.length > 256 ||
      typeof repoPath !== 'string' ||
      repoPath.length < 1 ||
      repoPath.length > 4096 ||
      typeof prompt !== 'string' ||
      prompt.length < 1 ||
      prompt.length > 65536
    ) {
      throw new Error('job input is invalid');
    }
    launcher.launch({ owner, repo, repoPath, prompt });
    return Promise.resolve();
  };
}
