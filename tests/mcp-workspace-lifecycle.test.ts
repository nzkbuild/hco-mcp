import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { rmSync } from 'node:fs';

const TEST_DB_DIR = '/tmp/hco-test-mcp-workspace';
const HCO_ENTRY = 'src/index.ts';

function parseResponse(content: unknown): Record<string, unknown> {
  const arr = content as Array<{ type: string; text?: string }>;
  const text = arr[0]?.text;
  assert.ok(typeof text === 'string', 'Expected text content');
  return JSON.parse(text) as Record<string, unknown>;
}

describe('MCP workspace lifecycle (real transport)', () => {
  let client: Client;
  let transport: StdioClientTransport;

  before(async () => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });

    transport = new StdioClientTransport({
      command: 'node',
      args: ['--import', 'tsx', HCO_ENTRY],
      env: { ...process.env, HCO_DATA_DIR: TEST_DB_DIR, ANTHROPIC_API_KEY: 'test' },
      stderr: 'pipe',
    });

    client = new Client(
      { name: 'hco-workspace-test', version: '0.1.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    // Register and activate a provider first
    const profileJson = JSON.stringify({
      profile_id: 'ws-provider',
      provider: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
    });
    await client.callTool({
      name: 'hco_provider_register',
      arguments: { profile_json: profileJson },
    });
    // Verify we can create a provider but workspace resume needs active provider
    // So we test error paths with registered (non-active) provider
  });

  after(async () => {
    await client.close();
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });

  it('tools/list includes workspace tools', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    assert.ok(names.includes('hco_workspace_resume'), 'missing hco_workspace_resume');
    assert.ok(names.includes('hco_workspace_list'), 'missing hco_workspace_list');
    assert.ok(names.includes('hco_workspace_status'), 'missing hco_workspace_status');
  });

  it('workspace resume with inactive provider returns error', async () => {
    const result = await client.callTool({
      name: 'hco_workspace_resume',
      arguments: {
        owner: 'test-owner',
        repo: 'test-repo',
        path: '/tmp/test',
        provider_profile_id: 'provider-ws-provider',
      },
    });
    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error: ${JSON.stringify(parsed)}`);
  });
});
