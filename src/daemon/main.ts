import { connect } from 'node:net';
import type { AppContext } from '../core/context.js';
import type { JobRow } from '../jobs/service.js';
import { JobWorker } from '../jobs/worker.js';

// ─── Socket path normalization ──────────────────────────────────────────────────

/**
 * Converts systemd NOTIFY_SOCKET values to Node-compatible socket paths.
 * systemd uses `@name` for abstract Unix sockets; Node needs `\0name`.
 * Filesystem paths (e.g. `/run/systemd/notify`) pass through unchanged.
 */
export function normalizeSocketPath(socket: string): string {
  return socket.startsWith('@') ? `\0${socket.slice(1)}` : socket;
}

// ─── Notifier interface ─────────────────────────────────────────────────────────

export interface DaemonNotifier {
  notifyReady(status: string): void;
  notifyStopping(status: string): void;
}

// ─── systemd notify notifier (NOTIFY_SOCKET) ────────────────────────────────────

export function createSystemdNotifier(): DaemonNotifier {
  const socket = process.env.NOTIFY_SOCKET;

  return {
    notifyReady(status: string): void {
      if (!socket) return;
      sendNotify(socket, `READY=1\nSTATUS=${status}\n`);
    },
    notifyStopping(status: string): void {
      if (!socket) return;
      sendNotify(socket, `STOPPING=1\nSTATUS=${status}\n`);
    },
  };
}

function sendNotify(socket: string, message: string): void {
  try {
    const sock = connect(normalizeSocketPath(socket));
    sock.on('error', () => {
      /* best-effort */
    });
    sock.on('connect', () => {
      sock.write(message, () => {
        sock.destroy();
      });
    });
  } catch {
    /* NOTIFY_SOCKET unavailable */
  }
}

// ─── Health contract ────────────────────────────────────────────────────────────

export interface DaemonHealth {
  status: 'operational' | 'degraded' | 'stopping';
  uptime: number;
  jobsCount: number;
  info: { dataDir: string; transport: string; logLevel: string; maxConcurrency: number };
}

export function getDaemonHealth(ctx: AppContext, startTime: number): DaemonHealth {
  const row = ctx.db.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number };

  return {
    status: 'operational',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    jobsCount: row.count,
    info: {
      dataDir: ctx.config.dataDir,
      transport: ctx.config.transport,
      logLevel: ctx.config.logLevel,
      maxConcurrency: ctx.config.maxConcurrency,
    },
  };
}

// ─── Daemon start ───────────────────────────────────────────────────────────────

export interface DaemonOpts {
  notifier?: DaemonNotifier;
  handler?: (job: JobRow) => Promise<void>;
}

export async function startDaemon(ctx: AppContext, opts?: DaemonOpts): Promise<void> {
  const notifier = opts?.notifier ?? createSystemdNotifier();
  const worker = new JobWorker(ctx.db, {
    workerId: 'daemon',
    leaseMs: 60_000,
    intervalMs: 1_000,
    handle: opts?.handler ?? (() => Promise.resolve()),
  });
  worker.start();

  printBanner(ctx);
  notifier.notifyReady('HCO daemon operational - idle');

  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    worker.stop();

    console.log(`\nReceived ${signal}. Shutting down...`);

    try {
      ctx.db.close();
      console.log('Database closed.');
    } catch {
      /* already closed */
    }

    notifier.notifyStopping('HCO daemon stopped');
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (shuttingDown) {
        clearInterval(check);
        resolve();
      }
    }, 1000);
  });
}

function printBanner(ctx: AppContext): void {
  const totalJobs = (
    ctx.db.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }
  ).count;

  console.log(`HCO daemon 2.0.0 — operational`);
  console.log(`  Data dir:     ${ctx.config.dataDir}`);
  console.log(`  Transport:    ${ctx.config.transport}`);
  console.log(`  Concurrency:  ${String(ctx.config.maxConcurrency)}`);
  console.log(`  Log level:    ${ctx.config.logLevel}`);
  console.log(`  Jobs tracked: ${String(totalJobs)}`);
  console.log('  Daemon ready. Awaiting work.');
}

// ─── Entrypoint guard ───────────────────────────────────────────────────────────

function isMain(meta: ImportMeta): boolean {
  return (
    meta.url === `file://${String(process.argv[1])}` ||
    (process.argv[1]?.endsWith('/daemon/main.js') ?? false)
  );
}

if (isMain(import.meta)) {
  const { createContext } = await import('../core/context.js');
  const { ClaudeLauncher } = await import('../claude/launcher.js');
  const { createJobExecutor } = await import('../jobs/executor.js');
  const ctx = createContext();
  const launcher = new ClaudeLauncher(ctx);
  startDaemon(ctx, { handler: createJobExecutor(launcher) }).catch((err: unknown) => {
    console.error('Daemon failed:', err);
    process.exit(1);
  });
}
