import type Database from 'better-sqlite3';
import { claimJob, releaseExpiredJobs, renewJobLease, type JobRow } from './service.js';

export interface JobWorkerOptions {
  workerId: string;
  leaseMs: number;
  intervalMs: number;
  handle: (job: JobRow) => Promise<void>;
}

export class JobWorker {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(
    private db: Database.Database,
    private options: JobWorkerOptions,
  ) {
    if (
      typeof options.workerId !== 'string' ||
      options.workerId.length < 1 ||
      options.workerId.length > 256
    )
      throw new RangeError('workerId must be 1..256 characters');
    if (!Number.isInteger(options.leaseMs) || options.leaseMs < 1 || options.leaseMs > 3600000)
      throw new RangeError('leaseMs must be 1..3600000');
    if (
      !Number.isInteger(options.intervalMs) ||
      options.intervalMs < 100 ||
      options.intervalMs > 300000
    )
      throw new RangeError('intervalMs must be 100..300000');
    if (typeof options.handle !== 'function') throw new TypeError('handle must be a function');
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      releaseExpiredJobs(this.db);
      const job = claimJob(this.db, this.options.workerId, this.options.leaseMs);
      if (!job) return;
      await this.options.handle(job);
      renewJobLease(this.db, job.id, this.options.workerId, this.options.leaseMs);
    } finally {
      this.busy = false;
    }
  }
}
