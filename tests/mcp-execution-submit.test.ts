import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TEST_DB_DIR = '/tmp/hco-test-mcp-submit';

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
      binary_path: 'claude',
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

describe('MCP execution submit (real transport)', () => {
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

  it('tools/list includes hco_execution_submit', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    assert.ok(names.includes('hco_execution_submit'), `tools: ${names.join(', ')}`);
  });

  it('hco_execution_submit with valid input returns execution_id and accepted status', async () => {
    const result = await client.callTool({
      name: 'hco_execution_submit',
      arguments: {
        request_json: validRequestJson(),
        profile_json: validProfileJson(),
        policy_json: validPolicyJson(),
      },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.data, `should have data, got: ${JSON.stringify(parsed)}`);
    assert.equal((parsed.data as Record<string, unknown>).status, 'accepted');
    assert.ok(typeof (parsed.data as Record<string, unknown>).execution_id === 'string');
    assert.ok(typeof (parsed.data as Record<string, unknown>).accepted_at === 'string');
  });

  it('hco_execution_submit with missing required field returns validation error', async () => {
    const result = await client.callTool({
      name: 'hco_execution_submit',
      arguments: {
        request_json: JSON.stringify({ brief: {} }),
        profile_json: validProfileJson(),
        policy_json: validPolicyJson(),
      },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error, got: ${JSON.stringify(parsed)}`);
    assert.equal((parsed.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  });

  it('hco_execution_submit with invalid JSON returns validation error', async () => {
    const result = await client.callTool({
      name: 'hco_execution_submit',
      arguments: {
        request_json: 'not-valid-json',
        profile_json: validProfileJson(),
        policy_json: validPolicyJson(),
      },
    });

    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error, got: ${JSON.stringify(parsed)}`);
    assert.equal((parsed.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  });

  it('hco_execution_submit supports idempotency — duplicate returns same execution', async () => {
    const args = {
      request_json: validRequestJson({ idempotency_key: 'mcp-idem-test' }),
      profile_json: validProfileJson(),
      policy_json: validPolicyJson(),
    };

    const first = await client.callTool({ name: 'hco_execution_submit', arguments: args });
    const firstParsed = parseResponse(first.content);
    const firstId = (firstParsed.data as Record<string, unknown>).execution_id;

    const second = await client.callTool({ name: 'hco_execution_submit', arguments: args });
    const secondParsed = parseResponse(second.content);
    const secondId = (secondParsed.data as Record<string, unknown>).execution_id;

    assert.equal(firstId, secondId);
  });

  it('hco_execution_submit with conflicting idempotency_key returns error', async () => {
    const args1 = {
      request_json: validRequestJson({
        idempotency_key: 'mcp-conflict-test',
        brief: {
          original_request: 'First.',
          objective: 'First.',
          context: '',
          constraints: [],
          acceptance_criteria: [],
          requested_validation: [],
        },
      }),
      profile_json: validProfileJson(),
      policy_json: validPolicyJson(),
    };

    await client.callTool({ name: 'hco_execution_submit', arguments: args1 });

    const args2 = {
      request_json: validRequestJson({
        idempotency_key: 'mcp-conflict-test',
        brief: {
          original_request: 'Second — different.',
          objective: 'Second objective.',
          context: '',
          constraints: [],
          acceptance_criteria: [],
          requested_validation: [],
        },
      }),
      profile_json: validProfileJson(),
      policy_json: validPolicyJson(),
    };

    const result = await client.callTool({ name: 'hco_execution_submit', arguments: args2 });
    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error, got: ${JSON.stringify(parsed)}`);
  });
});
