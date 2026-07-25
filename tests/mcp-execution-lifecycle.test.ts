import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TEST_DB_DIR = '/tmp/hco-test-mcp-lifecycle';

function validRequestJson(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    brief: {
      original_request: 'Test request.',
      objective: 'Test objective.',
      context: '',
      constraints: [],
      acceptance_criteria: [],
      requested_validation: [],
    },
    claude_config: {},
    repository: {
      owner: 'nzkbuild',
      repo: 'hco-mcp',
      path: '/home/hermes/repos/hco-mcp',
    },
    policy_ref: 'standard-policy',
    schema_version: 1,
    ...overrides,
  });
}

function validProfileJson() {
  return JSON.stringify({
    profile_id: 'test-profile',
    claude_defaults: {
      binary_path: 'echo',
      default_timeout_ms: 300_000,
      session_dir: '/tmp/hco-claude',
    },
    repository_allowlist: [{ owner: 'nzkbuild', repo: 'hco-mcp' }],
    schema_version: 1,
  });
}

function validPolicyJson() {
  return JSON.stringify({
    repository_boundary: {
      owner: 'nzkbuild',
      repo: 'hco-mcp',
      local_path: '/home/hermes/repos/hco-mcp',
    },
    permission_limits: {
      allowed_tools: ['Read', 'Write', 'Edit', 'Bash'],
      deny_shell_access: true,
    },
    timeout_ceiling_ms: 600_000,
    max_concurrency: 4,
    approval_required: true,
    schema_version: 1,
  });
}

function parseResponse(content: unknown): Record<string, unknown> {
  const arr = content as Array<{ type: string; text?: string }>;
  const text = arr[0]?.text;
  assert.ok(typeof text === 'string', `response should be string, got: ${typeof text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function submitExecution(client: Client): Promise<string> {
  const result = await client.callTool({
    name: 'hco_execution_submit',
    arguments: {
      request_json: validRequestJson(),
      profile_json: validProfileJson(),
      policy_json: validPolicyJson(),
    },
  });
  const parsed = parseResponse(result.content);
  assert.ok(parsed.data, `submit should return data, got: ${JSON.stringify(parsed)}`);
  return (parsed.data as Record<string, unknown>).execution_id as string;
}

describe('MCP execution lifecycle (real transport)', () => {
  let client: Client;
  let transport: StdioClientTransport;

  before(async () => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });

    transport = new StdioClientTransport({
      command: 'node',
      args: ['--import', 'tsx', 'src/index.ts'],
      env: {
        ...process.env,
        HCO_DATA_DIR: TEST_DB_DIR,
      },
      stderr: 'pipe',
    });

    client = new Client({ name: 'hco-test', version: '0.1.0' }, { capabilities: {} });

    await client.connect(transport);
  });

  after(async () => {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it('tools/list includes all 7 execution tools', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    const expected = [
      'hco_execution_submit',
      'hco_execution_start',
      'hco_execution_status',
      'hco_execution_wait',
      'hco_execution_cancel',
      'hco_execution_result',
      'hco_execution_continue',
    ];
    for (const name of expected) {
      assert.ok(names.includes(name), `tools should include ${name}, got: ${names.join(', ')}`);
    }
  });

  it('hco_execution_status returns execution with correct status', async () => {
    const executionId = await submitExecution(client);

    const result = await client.callTool({
      name: 'hco_execution_status',
      arguments: { execution_id: executionId },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.data, `should have data, got: ${JSON.stringify(parsed)}`);
    const data = parsed.data as Record<string, unknown>;
    assert.equal(data.executionId, executionId);
    assert.equal(data.status, 'accepted');
  });

  it('hco_execution_status returns error for unknown execution', async () => {
    const result = await client.callTool({
      name: 'hco_execution_status',
      arguments: { execution_id: 'nonexistent' },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error, got: ${JSON.stringify(parsed)}`);
    assert.equal((parsed.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  });

  it('hco_execution_start starts an accepted execution', async () => {
    const executionId = await submitExecution(client);

    const result = await client.callTool({
      name: 'hco_execution_start',
      arguments: { execution_id: executionId },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.data, `should have data, got: ${JSON.stringify(parsed)}`);
    const data = parsed.data as Record<string, unknown>;
    assert.equal(data.status, 'running');
  });

  it('hco_execution_start on already started execution returns lifecycle error', async () => {
    const executionId = await submitExecution(client);

    await client.callTool({
      name: 'hco_execution_start',
      arguments: { execution_id: executionId },
    });

    const result = await client.callTool({
      name: 'hco_execution_start',
      arguments: { execution_id: executionId },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error, got: ${JSON.stringify(parsed)}`);
    assert.equal((parsed.error as Record<string, unknown>).code, 'INVALID_LIFECYCLE');
  });

  it('hco_execution_wait awaits terminal state', async () => {
    const executionId = await submitExecution(client);

    // Start it first — fake adapter completes immediately
    await client.callTool({
      name: 'hco_execution_start',
      arguments: { execution_id: executionId },
    });

    const result = await client.callTool({
      name: 'hco_execution_wait',
      arguments: { execution_id: executionId, timeout_ms: 5000 },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.data, `should have data, got: ${JSON.stringify(parsed)}`);
    const data = parsed.data as Record<string, unknown>;
    const terminalStatuses = ['completed', 'failed', 'cancelled', 'timed_out'];
    assert.ok(
      terminalStatuses.includes(data.status as string),
      `should be terminal, got: ${String(data.status)}`,
    );
  });

  it('hco_execution_wait returns error for unknown execution', async () => {
    const result = await client.callTool({
      name: 'hco_execution_wait',
      arguments: { execution_id: 'nonexistent' },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error, got: ${JSON.stringify(parsed)}`);
    assert.equal((parsed.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  });

  it('hco_execution_cancel cancels an accepted execution', async () => {
    const executionId = await submitExecution(client);

    const result = await client.callTool({
      name: 'hco_execution_cancel',
      arguments: { execution_id: executionId },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.data, `should have data, got: ${JSON.stringify(parsed)}`);
    const data = parsed.data as Record<string, unknown>;
    assert.equal(data.status, 'cancelled');
  });

  it('hco_execution_cancel on terminal execution returns lifecycle error', async () => {
    const executionId = await submitExecution(client);

    await client.callTool({
      name: 'hco_execution_cancel',
      arguments: { execution_id: executionId },
    });

    const result = await client.callTool({
      name: 'hco_execution_cancel',
      arguments: { execution_id: executionId },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error, got: ${JSON.stringify(parsed)}`);
    assert.equal((parsed.error as Record<string, unknown>).code, 'INVALID_LIFECYCLE');
  });

  it('hco_execution_result returns result for terminal execution', async () => {
    const executionId = await submitExecution(client);

    await client.callTool({
      name: 'hco_execution_start',
      arguments: { execution_id: executionId },
    });

    // Wait for completion
    await client.callTool({
      name: 'hco_execution_wait',
      arguments: { execution_id: executionId, timeout_ms: 5000 },
    });

    const result = await client.callTool({
      name: 'hco_execution_result',
      arguments: { execution_id: executionId },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.data, `should have data, got: ${JSON.stringify(parsed)}`);
    const data = parsed.data as Record<string, unknown>;
    assert.equal(data.execution_id, executionId);
    const terminalStatuses = ['completed', 'failed', 'cancelled', 'timed_out'];
    assert.ok(terminalStatuses.includes(data.status as string));
  });

  it('hco_execution_result on non-terminal returns lifecycle error', async () => {
    const executionId = await submitExecution(client);

    const result = await client.callTool({
      name: 'hco_execution_result',
      arguments: { execution_id: executionId },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error, got: ${JSON.stringify(parsed)}`);
    assert.equal((parsed.error as Record<string, unknown>).code, 'INVALID_LIFECYCLE');
  });
});
