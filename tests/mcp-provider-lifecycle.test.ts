import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { rmSync } from 'node:fs';

const TEST_DB_DIR = '/tmp/hco-test-mcp-provider';
const HCO_ENTRY = 'src/index.ts';

function parseResponse(content: unknown): Record<string, unknown> {
  const arr = content as Array<{ type: string; text?: string }>;
  const text = arr[0]?.text;
  assert.ok(typeof text === 'string', `Expected text content in MCP response, got: ${typeof text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

describe('MCP provider lifecycle (real transport)', () => {
  let client: Client;
  let transport: StdioClientTransport;

  before(async () => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });

    transport = new StdioClientTransport({
      command: 'node',
      args: ['--import', 'tsx', HCO_ENTRY],
      env: {
        ...process.env,
        HCO_DATA_DIR: TEST_DB_DIR,
        ANTHROPIC_API_KEY: 'test-key-not-real',
      },
      stderr: 'pipe',
    });

    client = new Client(
      { name: 'hco-provider-test', version: '0.1.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
  });

  after(async () => {
    await client.close();
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });

  it('tools/list includes all provider tools', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    assert.ok(names.includes('hco_provider_register'), 'missing hco_provider_register');
    assert.ok(names.includes('hco_provider_validate'), 'missing hco_provider_validate');
    assert.ok(names.includes('hco_provider_models'), 'missing hco_provider_models');
    assert.ok(
      names.includes('hco_provider_mapping_recommend'),
      'missing hco_provider_mapping_recommend',
    );
    assert.ok(names.includes('hco_provider_activate'), 'missing hco_provider_activate');
    assert.ok(names.includes('hco_provider_status'), 'missing hco_provider_status');
    assert.ok(names.includes('hco_provider_list'), 'missing hco_provider_list');
    assert.ok(names.includes('hco_provider_rollback'), 'missing hco_provider_rollback');
  });

  it('register + recommend + status + list lifecycle', async () => {
    const profileJson = JSON.stringify({
      profile_id: 'mcp-lifecycle-test',
      provider: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
    });

    const regResult = await client.callTool({
      name: 'hco_provider_register',
      arguments: { profile_json: profileJson },
    });
    const regParsed = parseResponse(regResult.content);
    assert.ok(regParsed.data, `register should have data, got: ${JSON.stringify(regParsed)}`);
    const regData = regParsed.data as Record<string, unknown>;
    assert.equal(typeof regData.provider_id, 'string');
    assert.equal(regData.status, 'registered');
    const providerId = regData.provider_id as string;

    // Mapping recommend
    const recResult = await client.callTool({
      name: 'hco_provider_mapping_recommend',
      arguments: {
        provider_id: providerId,
        model_ids: ['claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-5'],
      },
    });
    const recParsed = parseResponse(recResult.content);
    assert.ok(recParsed.data, `recommend should have data, got: ${JSON.stringify(recParsed)}`);
    const recData = recParsed.data as Record<string, unknown>;
    assert.ok(Array.isArray(recData.recommendations));
    const recs = recData.recommendations as Array<Record<string, unknown>>;
    assert.equal(recs.length, 3);

    // Status
    const statusResult = await client.callTool({
      name: 'hco_provider_status',
      arguments: { provider_id: providerId },
    });
    const statusParsed = parseResponse(statusResult.content);
    assert.ok(statusParsed.data, `status should have data`);
    const statusData = statusParsed.data as Record<string, unknown>;
    const providerInfo = statusData.provider as Record<string, unknown>;
    assert.equal(providerInfo.status, 'registered');

    // List
    const listResult = await client.callTool({
      name: 'hco_provider_list',
      arguments: {},
    });
    const listParsed = parseResponse(listResult.content);
    assert.ok(listParsed.data, `list should have data`);
  });

  it('invalid provider type returns validation error', async () => {
    const profileJson = JSON.stringify({
      profile_id: 'bad',
      provider: 'unknown',
      api_key_env: 'KEY',
    });
    const result = await client.callTool({
      name: 'hco_provider_register',
      arguments: { profile_json: profileJson },
    });
    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error, got: ${JSON.stringify(parsed)}`);
    assert.equal((parsed.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  });

  it('nonexistent provider returns validation error', async () => {
    const result = await client.callTool({
      name: 'hco_provider_status',
      arguments: { provider_id: 'provider-nonexistent' },
    });
    const parsed = parseResponse(result.content);
    assert.ok(parsed.error, `should have error, got: ${JSON.stringify(parsed)}`);
    assert.equal((parsed.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  });

});
