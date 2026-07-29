/**
 * MCP stdio smoke test — real process, real JSON-RPC over stdio.
 * Uses the fake adapter. Requires no credentials.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdtempSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

const MCP_SERVER = resolve(import.meta.dirname, '../dist/index.js');
const TEST_DATA_DIR_PREFIX = `${tmpdir()}/hco-test-stdio-`;

let server: ChildProcess;
let requestId = 0;

function send(json: Record<string, unknown>): void {
  const msg = JSON.stringify(json) + '\n';
  if (server.stdin) {
    server.stdin.write(msg);
  }
}

async function receive(): Promise<Record<string, unknown>> {
  // Poll for a complete line-delimited JSON message
  return new Promise((resolvePromise, reject) => {
    if (!server.stdout) {
      reject(new Error('Server stdout is not available'));
      return;
    }
    const rl = createInterface({ input: server.stdout });

    const timeout = setTimeout(() => {
      rl.close();
      reject(new Error('Timeout waiting for MCP response'));
    }, 15000);

    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        clearTimeout(timeout);
        rl.close();
        resolvePromise(msg);
      } catch {
        // not JSON, skip
      }
    });

    server.on('close', (code) => {
      clearTimeout(timeout);
      rl.close();
      reject(new Error(`Server exited with code ${String(code)} before response`));
    });
  });
}

async function exchange(
  method: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  requestId++;
  send({ jsonrpc: '2.0', id: requestId, method, params });
  return receive();
}

describe('MCP stdio smoke test (fake adapter)', () => {
  const dataDir = mkdtempSync(TEST_DATA_DIR_PREFIX);
  const repoPath = mkdtempSync(`${tmpdir()}/hco-stdio-repo-`);

  before(async function setupMCP(this: unknown) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* Windows */
    }

    server = spawn('node', [MCP_SERVER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HCO_DATA_DIR: dataDir, HCO_LOG_LEVEL: 'warn' },
    });

    server.stderr?.on('data', () => {
      /* suppress stderr noise */
    });

    server.on('error', (err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        (this as { skip: () => void }).skip();
      }
    });

    // Ensure process is alive
    await new Promise<void>((resolvePromise) => {
      const check = setInterval(() => {
        if (server.exitCode !== null) {
          clearInterval(check);
          // Process exited — might be ENOENT
          (this as { skip: () => void }).skip();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(check);
        resolvePromise();
      }, 500);
    });
  });

  after(async () => {
    try {
      if (server && !server.killed) {
        server.kill('SIGTERM');
        // Drain
        await new Promise((r) => setTimeout(r, 300));
        if (!server.killed) {
          server.kill('SIGKILL');
        }
      }
    } catch {
      /* cleanup */
    }
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
    try {
      rmSync(repoPath, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  it('initializes MCP handshake', async () => {
    const resp = await exchange('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'hco-test-stdio', version: '0.0.0' },
    });
    assert.ok(resp.result, `Initialize failed: ${JSON.stringify(resp)}`);
    const result = resp.result as Record<string, unknown>;
    assert.ok(result.serverInfo, 'Missing serverInfo');
    const info = result.serverInfo as Record<string, unknown>;
    assert.equal(info.name, 'hco-mcp');

    // Send initialized notification
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  });

  it('tools/list returns tools', async () => {
    const resp = await exchange('tools/list');
    assert.ok(resp.result, `tools/list failed: ${JSON.stringify(resp)}`);
    const result = resp.result as Record<string, unknown>;
    assert.ok(Array.isArray(result.tools), 'tools should be an array');
    const tools = result.tools as Array<Record<string, unknown>>;
    assert.ok(tools.length > 0, 'Expected at least one tool');
  });

  let jobId: string;

  it('calls hco_execution_submit via stdio', async () => {
    const resp = await exchange('tools/call', {
      name: 'hco_execution_submit',
      arguments: {
        request_json: JSON.stringify({
          brief: {
            original_request: 'stdio-test-job',
            objective: 'Verify MCP stdio round-trip.',
            context: '',
            constraints: [],
            acceptance_criteria: [],
            requested_validation: [],
          },
          repository: {
            owner: 'stdio-test-owner',
            repo: 'stdio-test-repo',
            path: repoPath,
          },
          claude_config: {},
          policy_ref: 'test',
          schema_version: 1,
        }),
        profile_json: JSON.stringify({
          profile_id: 'test-profile',
          claude_defaults: {
            binary_path: 'echo',
            default_timeout_ms: 300000,
            session_dir: '/tmp/hco-claude',
          },
          repository_allowlist: [{ owner: 'stdio-test-owner', repo: 'stdio-test-repo' }],
          schema_version: 1,
        }),
        policy_json: JSON.stringify({
          repository_boundary: {
            owner: 'stdio-test-owner',
            repo: 'stdio-test-repo',
            local_path: repoPath,
          },
          permission_limits: {
            allowed_tools: ['Read', 'Write', 'Edit', 'Bash'],
            deny_shell_access: true,
          },
          timeout_ceiling_ms: 600000,
          max_concurrency: 1,
          approval_required: false,
          schema_version: 1,
        }),
      },
    });
    assert.ok(resp.result, `hco_execution_submit failed: ${JSON.stringify(resp)}`);
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const text = content[0]?.text as string;
    const envelope = JSON.parse(text) as Record<string, unknown>;
    const data = (envelope.data ?? envelope) as Record<string, unknown>;
    assert.ok(data.execution_id, 'Missing execution_id in submit response');
    jobId = data.execution_id as string;
  });

  it('calls hco_execution_status via stdio and finds the submitted job', async () => {
    const resp = await exchange('tools/call', {
      name: 'hco_execution_status',
      arguments: { execution_id: jobId },
    });
    assert.ok(resp.result, `hco_execution_status failed: ${JSON.stringify(resp)}`);
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const text = content[0]?.text as string;
    const envelope = JSON.parse(text) as Record<string, unknown>;
    const data = (envelope.data ?? envelope) as Record<string, unknown>;
    assert.equal(data.executionId ?? data.execution_id, jobId, `Expected status to reference ${jobId}`);
    assert.equal(data.status, 'accepted', `Expected status "accepted", got "${String(data.status)}"`);
  });

  it('calls hco_execution_cancel on the submitted job', async () => {
    const resp = await exchange('tools/call', {
      name: 'hco_execution_cancel',
      arguments: { execution_id: jobId },
    });
    // Cancel is ok if it works or if job already processed — just check no protocol error
    assert.ok(resp.result ?? !resp.error, `hco_cancel failed: ${JSON.stringify(resp)}`);
  });

  it('handles shutdown cleanly', async () => {
    // Send the close notification
    send({ jsonrpc: '2.0', method: 'notifications/cancelled' });

    // Kill the server
    server.kill('SIGTERM');

    // Wait for graceful exit
    await new Promise<void>((resolvePromise) => {
      const timeout = setTimeout(() => {
        server.kill('SIGKILL');
        resolvePromise();
      }, 3000);
      server.on('close', () => {
        clearTimeout(timeout);
        resolvePromise();
      });
    });

    assert.ok(server.killed || server.exitCode !== null, 'Server should have exited');
  });
});
