import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { createContext, closeContext } from '../src/core/context.js';
import type { AppContext } from '../src/core/context.js';
import {
  createSystemdNotifier,
  getDaemonHealth,
  startDaemon,
  normalizeSocketPath,
} from '../src/daemon/main.js';
import type { DaemonNotifier, DaemonHealth } from '../src/daemon/main.js';

const TEST_DIR = '/tmp/hco-test-daemon';

describe('normalizeSocketPath', () => {
  it('passes through filesystem socket path', () => {
    assert.equal(normalizeSocketPath('/run/systemd/notify'), '/run/systemd/notify');
  });

  it('replaces leading @ with \\0 for abstract socket', () => {
    assert.equal(normalizeSocketPath('@systemd-notify'), '\0systemd-notify');
  });

  it('only replaces the first character when value starts with @', () => {
    assert.equal(normalizeSocketPath('@my-daemon.sock'), '\0my-daemon.sock');
  });

  it('does not modify @ characters in the middle', () => {
    assert.equal(normalizeSocketPath('/tmp/foo@bar'), '/tmp/foo@bar');
  });
});

describe('sendNotify via real socket', () => {
  it(
    'sends notification through NOTIFY_SOCKET using normalizeSocketPath',
    {
      skip: process.platform === 'win32' ? 'Unix sockets not available on Windows' : false,
    },
    async () => {
      // Use abstract socket — systemd convention
      const name = `\0hco-test-notify`;

      const received = await new Promise<string>((resolve, reject) => {
        const server = createServer((c) => {
          c.on('data', (data: Buffer) => {
            c.destroy();
            server.close();
            clearTimeout(timeout);
            process.env.NOTIFY_SOCKET = '';
            resolve(data.toString());
          });
          c.on('error', () => {
            c.destroy();
            server.close();
            clearTimeout(timeout);
            process.env.NOTIFY_SOCKET = '';
            reject(new Error('connection error'));
          });
        });
        server.on('error', () => {
          server.close();
          clearTimeout(timeout);
          process.env.NOTIFY_SOCKET = '';
          reject(new Error('server error'));
        });

        const timeout = setTimeout(() => {
          server.close();
          process.env.NOTIFY_SOCKET = '';
          reject(new Error('timeout'));
        }, 2000);

        server.listen({ path: name }, () => {
          // Expose as systemd @-notation
          process.env.NOTIFY_SOCKET = '@hco-test-notify';
          const notifier = createSystemdNotifier();
          notifier.notifyReady('HCO operational');
        });
      });

      assert.ok(received.includes('READY=1'));
      assert.ok(received.includes('STATUS=HCO operational'));
    },
  );
});

describe('Daemon notifier', () => {
  it('createSystemdNotifier returns a notifier', () => {
    const n = createSystemdNotifier();
    assert.ok(n);
    assert.equal(typeof n.notifyReady, 'function');
    assert.equal(typeof n.notifyStopping, 'function');
  });

  it('systemd notifier does not throw when NOTIFY_SOCKET is unset', () => {
    delete process.env.NOTIFY_SOCKET;
    const n = createSystemdNotifier();
    assert.doesNotThrow(() => {
      n.notifyReady('test ready');
      n.notifyStopping('test stopping');
    });
  });
});

describe('DaemonHealth', () => {
  let ctx: AppContext;

  before(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    process.env.HCO_DATA_DIR = TEST_DIR;
    ctx = createContext();
  });

  after(() => {
    closeContext(ctx);
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.HCO_DATA_DIR;
  });

  it('getDaemonHealth returns operational status', () => {
    const health = getDaemonHealth(ctx, Date.now() - 5000);
    assert.equal(health.status, 'operational');
    assert.ok(health.uptime >= 4);
    assert.equal(health.jobsCount, 0);
    assert.equal(health.info.dataDir, TEST_DIR);
    assert.ok(typeof health.info.transport === 'string');
    assert.ok(typeof health.info.logLevel === 'string');
    assert.ok(typeof health.info.maxConcurrency === 'number');
  });

  it('getDaemonHealth reflects job count', () => {
    ctx.db.exec(
      "INSERT INTO jobs (external_id, kind, status) VALUES ('h0c-test-1', 'build', 'pending')",
    );
    ctx.db.exec(
      "INSERT INTO jobs (external_id, kind, status) VALUES ('h0c-test-2', 'lint', 'running')",
    );

    const health = getDaemonHealth(ctx, Date.now() - 2000);
    assert.equal(health.jobsCount, 2);
  });
});

describe(
  'Daemon startup/shutdown with mock notifier',
  {
    skip: process.platform === 'win32' ? 'POSIX signal handling not available on Windows' : false,
  },
  () => {
    it('startDaemon signals readiness and handles SIGTERM', async () => {
      rmSync(TEST_DIR, { recursive: true, force: true });

      process.env.HCO_DATA_DIR = TEST_DIR;
      const ctx = createContext();

      const notifications: string[] = [];

      const mockNotifier: DaemonNotifier = {
        notifyReady(status: string): void {
          notifications.push(`ready: ${status}`);
        },
        notifyStopping(status: string): void {
          notifications.push(`stopping: ${status}`);
        },
      };

      // Fire SIGTERM after a short delay to trigger shutdown
      const timer = setTimeout(() => {
        process.kill(process.pid, 'SIGTERM');
      }, 300);

      await startDaemon(ctx, { notifier: mockNotifier });

      clearTimeout(timer);
      try {
        closeContext(ctx);
      } catch {
        /* context may already be closed */
      }
      try {
        rmSync(TEST_DIR, { recursive: true, force: true });
      } catch {
        /* Windows WAL lock */
      }
      delete process.env.HCO_DATA_DIR;

      assert.ok(
        notifications.some((n) => n.startsWith('ready:')),
        'notifier received ready',
      );
      assert.ok(
        notifications.some((n) => n.startsWith('stopping:')),
        'notifier received stopping',
      );
    });
  },
);
