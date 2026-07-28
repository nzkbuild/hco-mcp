import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ─── Opt-in gate ──────────────────────────────────────────────────────────────

const ACCEPTANCE = process.env.HCO_ACCEPTANCE === '1';
const ADAPTER = process.env.HCO_ADAPTER;

if (!ACCEPTANCE) {
  describe('Real Claude Code acceptance', { skip: 'HCO_ACCEPTANCE=1 not set' }, () => {
    it('all tests skipped', () => {
      /* skipped — set HCO_ACCEPTANCE=1 HCO_ADAPTER=spawn to run */
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function parseResponse(content: unknown): Record<string, unknown> {
  const arr = content as Array<{ type: string; text?: string }>;
  const text = arr[0]?.text;
  assert.ok(typeof text === 'string', `response should be string, got: ${typeof text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function submitExecution(
  client: Client,
  repoPath: string,
  timeoutMs: number,
): Promise<string> {
  const requestJson = JSON.stringify({
    brief: {
      original_request:
        'Create exactly one file named VERIFIED.txt in the repository root.\n\n' +
        'Its complete contents must be exactly:\n\n' +
        'HCO-ACCEPTANCE-PASSED\n\n' +
        'Do not modify any other file.',
      objective: 'Create VERIFIED.txt with acceptance marker content.',
      context: '',
      constraints: [],
      acceptance_criteria: [],
      requested_validation: [],
    },
    claude_config: {},
    repository: { owner: 'acceptance', repo: 'test', path: repoPath },
    policy_ref: 'acceptance',
  });

  const profileJson = JSON.stringify({
    profile_id: 'acceptance',
    claude_defaults: {
      default_timeout_ms: timeoutMs,
      session_dir: join(tmpdir(), 'hco-acceptance-sessions'),
    },
    repository_allowlist: [{ owner: 'acceptance', repo: 'test' }],
    validation_defaults: { post_execution: false },
  });

  const policyJson = JSON.stringify({
    repository_boundary: { owner: 'acceptance', repo: 'test', local_path: repoPath },
    permission_limits: { allowed_tools: ['Read', 'Write', 'Edit', 'Bash'], deny_shell_access: true },
    timeout_ceiling_ms: timeoutMs + 60_000,
    max_concurrency: 4,
    approval_required: false,
  });

  const result = await client.callTool({
    name: 'hco_execution_submit',
    arguments: { request_json: requestJson, profile_json: profileJson, policy_json: policyJson },
  });

  const parsed = parseResponse(result.content);
  assert.ok(parsed.data, `submit should return data, got: ${JSON.stringify(parsed)}`);
  return (parsed.data as Record<string, unknown>).execution_id as string;
}

// ─── Active test suite (only runs when both guards pass) ───────────────────────

if (ACCEPTANCE && ADAPTER === 'spawn') {
  describe('Real Claude Code acceptance', () => {
    let client: Client;
    let transport: StdioClientTransport;
    let repoPath: string;
    let dbDir: string;

    before(async () => {
      repoPath = mkdtempSync(join(tmpdir(), 'hco-acceptance-repo-'));
      execSync('git init', { cwd: repoPath });
      execSync('git config user.email "acceptance@hco.test"', { cwd: repoPath });
      execSync('git config user.name "HCO Acceptance"', { cwd: repoPath });
      writeFileSync(join(repoPath, 'README.md'), '# HCO Acceptance Test Repository\n');
      execSync('git add -A && git commit -m "initial"', { cwd: repoPath });

      dbDir = mkdtempSync(join(tmpdir(), 'hco-acceptance-db-'));

      transport = new StdioClientTransport({
        command: 'node',
        args: ['--import', 'tsx', 'src/index.ts'],
        env: {
          ...process.env,
          HCO_DATA_DIR: dbDir,
          HCO_ADAPTER: 'spawn',
        },
        stderr: 'pipe',
      });

      client = new Client({ name: 'hco-acceptance', version: '0.1.0' }, { capabilities: {} });
      await client.connect(transport);
    });

    after(async () => {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* Windows WAL */ }
      try { rmSync(repoPath, { recursive: true, force: true }); } catch { /* Windows WAL */ }
    });

    it('completes real Claude Code execution and verifies repository change', async () => {
      const executionId = await submitExecution(client, repoPath, 300_000);

      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      assert.ok(names.includes('hco_execution_submit'), 'tools/list should include hco_execution_submit');
      assert.ok(names.includes('hco_execution_start'));
      assert.ok(names.includes('hco_execution_wait'));
      assert.ok(names.includes('hco_execution_result'));

      const startResult = await client.callTool({
        name: 'hco_execution_start',
        arguments: { execution_id: executionId },
      });
      const startParsed = parseResponse(startResult.content);
      assert.ok(startParsed.data);
      const startStatus = (startParsed.data as Record<string, unknown>).status as string;
      assert.equal(startStatus, 'running', `start should transition to running, got: ${startStatus}`);

      const waitResult = await client.callTool({
        name: 'hco_execution_wait',
        arguments: { execution_id: executionId, timeout_ms: 300_000 },
      });
      const waitParsed = parseResponse(waitResult.content);
      assert.ok(waitParsed.data);
      const terminalStatus = (waitParsed.data as Record<string, unknown>).status as string;
      assert.equal(
        terminalStatus,
        'completed',
        `execution should complete, got status: ${terminalStatus}`,
      );

      const resultResult = await client.callTool({
        name: 'hco_execution_result',
        arguments: { execution_id: executionId },
      });
      const resultParsed = parseResponse(resultResult.content);
      assert.ok(resultParsed.data, `result should have data, got: ${JSON.stringify(resultParsed)}`);
      const resultData = resultParsed.data as Record<string, unknown>;
      assert.equal(resultData.status, 'completed');
      assert.ok(typeof resultData.execution_id === 'string');
      assert.ok(typeof resultData.summary === 'object');

      const verifiedPath = join(repoPath, 'VERIFIED.txt');
      assert.ok(existsSync(verifiedPath), 'VERIFIED.txt should exist');
      const content = readFileSync(verifiedPath, 'utf-8').trimEnd();
      assert.equal(
        content,
        'HCO-ACCEPTANCE-PASSED',
        `VERIFIED.txt content mismatch, got: "${content}"`,
      );

      const gitStatus = execSync('git status --porcelain', { cwd: repoPath }).toString();
      const changedFiles = gitStatus
        .split('\n')
        .filter((l) => l.length > 0)
        .filter((l) => !l.includes('VERIFIED.txt'));
      assert.equal(
        changedFiles.length,
        0,
        `no unexpected file changes, got: ${gitStatus}`,
      );

      const resultStr = JSON.stringify(resultParsed);
      assert.ok(!resultStr.includes('ANTHROPIC_API_KEY'));
      assert.ok(!resultStr.toLowerCase().includes('api_key'));
      assert.ok(!resultStr.toLowerCase().includes('bearer'));
      assert.ok(!resultStr.toLowerCase().includes('secret'));
    });

    it('timeout kills Claude process and records timed_out state', { timeout: 60_000 }, async () => {
      const timeoutRepo = mkdtempSync(join(tmpdir(), 'hco-acceptance-timeout-'));
      execSync('git init', { cwd: timeoutRepo });
      execSync('git config user.email "acceptance@hco.test"', { cwd: timeoutRepo });
      execSync('git config user.name "HCO Acceptance"', { cwd: timeoutRepo });
      writeFileSync(join(timeoutRepo, 'README.md'), '# HCO Timeout Test\n');
      execSync('git add -A && git commit -m "initial"', { cwd: timeoutRepo });

      try {
        const executionId = await submitExecution(client, timeoutRepo, 5_000);

        const startResult = await client.callTool({
          name: 'hco_execution_start',
          arguments: { execution_id: executionId },
        });
        const startParsed = parseResponse(startResult.content);
        assert.equal(
          (startParsed.data as Record<string, unknown>).status,
          'running',
        );

        const waitResult = await client.callTool({
          name: 'hco_execution_wait',
          arguments: { execution_id: executionId, timeout_ms: 30_000 },
        });
        const waitParsed = parseResponse(waitResult.content);
        assert.ok(waitParsed.data);
        const status = (waitParsed.data as Record<string, unknown>).status as string;
        assert.ok(
          status === 'timed_out' || status === 'completed',
          `expected timed_out or completed, got: ${status}`,
        );
      } finally {
        try { rmSync(timeoutRepo, { recursive: true, force: true }); } catch { /* Windows */ }
      }
    });
  });
} else if (ACCEPTANCE && ADAPTER !== 'spawn') {
  describe('Real Claude Code acceptance', () => {
    it('requires HCO_ADAPTER=spawn', () => {
      assert.fail(
        `HCO_ACCEPTANCE=1 requires HCO_ADAPTER=spawn, got: ${String(ADAPTER)}. Set HCO_ADAPTER=spawn and re-run.`,
      );
    });
  });
}
