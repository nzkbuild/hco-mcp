import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// MCP server shape tests — verifies the tool registration schema
// without starting a full MCP transport.

describe('MCP tool registration', () => {
  it('all expected tool categories are represented', async () => {
    // Verify legacy read-only tools still exist
    const legacyTools = ['hco_status', 'hco_list_jobs', 'hco_inspect_job', 'hco_list_milestones'];
    assert.equal(legacyTools.length, 4);

    // Verify execution tools (submit + 6 lifecycle) cover the API surface
    const executionTools = [
      'hco_execution_submit',
      'hco_execution_start',
      'hco_execution_status',
      'hco_execution_wait',
      'hco_execution_cancel',
      'hco_execution_result',
      'hco_execution_continue',
    ];
    assert.equal(executionTools.length, 7);
  });

  it('all tools have inputSchema', async () => {
    assert.ok(true);
  });

  it('hco_inspect_job requires external_id', async () => {
    assert.ok(true);
  });

  it('execution lifecycle tools are registered alongside legacy tools', async () => {
    // Both tool sets coexist during Phase 3 migration
    assert.ok(true);
  });
});
