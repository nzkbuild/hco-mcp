import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceV1 } from '../src/contract/workspace.js';

describe('WorkspaceV1', () => {
  it('validates required fields', () => {
    const ws = WorkspaceV1.parse({
      workspace_id: 'ws-1',
      repository_owner: 'nzkbuild',
      repository_name: 'hco',
      repository_path: '/tmp/hco',
      provider_profile_id: 'provider-test',
      created_at: '2026-07-28T00:00:00Z',
    });
    assert.equal(ws.workspace_id, 'ws-1');
    assert.equal(ws.status, 'active');
  });

  it('defaults status to active', () => {
    const ws = WorkspaceV1.parse({
      workspace_id: 'ws-2',
      repository_owner: 'owner',
      repository_name: 'repo',
      repository_path: '/path',
      provider_profile_id: 'p1',
      created_at: '2026-07-28T00:00:00Z',
    });
    assert.equal(ws.status, 'active');
  });

  it('rejects missing repository_path', () => {
    assert.throws(
      () =>
        WorkspaceV1.parse({
          workspace_id: 'ws-3',
          repository_owner: 'owner',
          repository_name: 'repo',
          provider_profile_id: 'p1',
          created_at: '2026-07-28T00:00:00Z',
        }),
      /repository_path/,
    );
  });

  it('accepts optional fields', () => {
    const ws = WorkspaceV1.parse({
      workspace_id: 'ws-4',
      repository_owner: 'o',
      repository_name: 'r',
      repository_path: '/p',
      provider_profile_id: 'p1',
      model_mapping_id: 'm1',
      policy_snapshot_json: '{}',
      created_at: '2026-07-28T00:00:00Z',
    });
    assert.equal(ws.model_mapping_id, 'm1');
  });

  it('rejects invalid status', () => {
    assert.throws(
      () =>
        WorkspaceV1.parse({
          workspace_id: 'ws-5',
          repository_owner: 'o',
          repository_name: 'r',
          repository_path: '/p',
          provider_profile_id: 'p1',
          status: 'deleted',
          created_at: '2026-07-28T00:00:00Z',
        }),
      /status/,
    );
  });

  it('serializes and deserializes predictably', () => {
    const input = {
      workspace_id: 'ws-round',
      repository_owner: 'nzkbuild',
      repository_name: 'hco',
      repository_path: '/tmp/hco',
      provider_profile_id: 'provider-test',
      created_at: '2026-07-28T00:00:00Z',
    };
    const parsed = WorkspaceV1.parse(input);
    const json = JSON.stringify(parsed);
    const round = WorkspaceV1.parse(JSON.parse(json));
    assert.equal(round.workspace_id, input.workspace_id);
    assert.equal(round.repository_path, input.repository_path);
  });
});
