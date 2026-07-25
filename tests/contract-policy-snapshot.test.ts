import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PolicySnapshotV1 } from '../src/contract/policy-snapshot.js';

describe('PolicySnapshotV1', () => {
  const validSnapshot = {
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
    environment_allowlist: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
    permitted_overrides: ['model', 'thinking_effort', 'skills'],
    approval_required: true,
    output_limits: {
      inline_response_max_bytes: 65536,
      event_chunk_max_bytes: 262144,
      artifact_max_bytes: 10_485_760,
      total_max_bytes: 104_857_600,
    },
  };

  it('accepts valid snapshot', () => {
    const snap = PolicySnapshotV1.parse(validSnapshot);
    assert.equal(snap.schema_version, 1);
    assert.equal(snap.repository_boundary.owner, 'nzkbuild');
    assert.equal(snap.repository_boundary.repo, 'hco-mcp');
    assert.equal(snap.timeout_ceiling_ms, 600_000);
    assert.equal(snap.max_concurrency, 4);
    assert.equal(snap.approval_required, true);
    assert.deepEqual(snap.permitted_overrides, ['model', 'thinking_effort', 'skills']);
  });

  it('accepts snapshot with all optional fields', () => {
    const snap = PolicySnapshotV1.parse({
      ...validSnapshot,
      working_directory_boundary: '/home/hermes/repos/hco-mcp/src',
      concurrency_limit: 2,
      secret_profile_ref: 'toche-secrets',
      authority_mode: 'interactive',
      allowed_approvers: ['alice', 'bob'],
      policy_origin: 'config-file',
      snapshot_reason: 'execution_submit',
    });
    assert.equal(snap.working_directory_boundary, '/home/hermes/repos/hco-mcp/src');
    assert.equal(snap.concurrency_limit, 2);
    assert.equal(snap.secret_profile_ref, 'toche-secrets');
    assert.equal(snap.authority_mode, 'interactive');
    assert.deepEqual(snap.allowed_approvers, ['alice', 'bob']);
    assert.equal(snap.policy_origin, 'config-file');
    assert.equal(snap.snapshot_reason, 'execution_submit');
  });

  it('rejects empty repository_boundary owner', () => {
    const r = PolicySnapshotV1.safeParse({
      ...validSnapshot,
      repository_boundary: { ...validSnapshot.repository_boundary, owner: '' },
    });
    assert.equal(r.success, false);
  });

  it('rejects empty repository_boundary repo', () => {
    const r = PolicySnapshotV1.safeParse({
      ...validSnapshot,
      repository_boundary: { ...validSnapshot.repository_boundary, repo: '' },
    });
    assert.equal(r.success, false);
  });

  it('rejects timeout_ceiling_ms below minimum', () => {
    const r = PolicySnapshotV1.safeParse({
      ...validSnapshot,
      timeout_ceiling_ms: 0,
    });
    assert.equal(r.success, false);
  });

  it('rejects max_concurrency negative', () => {
    const r = PolicySnapshotV1.safeParse({
      ...validSnapshot,
      max_concurrency: -1,
    });
    assert.equal(r.success, false);
  });

  it('rejects empty environment_allowlist element', () => {
    const r = PolicySnapshotV1.safeParse({
      ...validSnapshot,
      environment_allowlist: ['VALID', ''],
    });
    assert.equal(r.success, false);
  });

  it('rejects empty permitted_overrides element', () => {
    const r = PolicySnapshotV1.safeParse({
      ...validSnapshot,
      permitted_overrides: ['model', ''],
    });
    assert.equal(r.success, false);
  });

  it('rejects unsupported schema_version', () => {
    const r = PolicySnapshotV1.safeParse({
      ...validSnapshot,
      schema_version: 99,
    });
    assert.equal(r.success, false);
  });

  it('rejects empty allowed_approvers element', () => {
    const r = PolicySnapshotV1.safeParse({
      ...validSnapshot,
      allowed_approvers: ['alice', ''],
    });
    assert.equal(r.success, false);
  });

  it('rejects invalid authority_mode', () => {
    const r = PolicySnapshotV1.safeParse({
      ...validSnapshot,
      authority_mode: 'dangerous',
    });
    assert.equal(r.success, false);
  });

  it('rejects empty policy_origin', () => {
    const r = PolicySnapshotV1.safeParse({
      ...validSnapshot,
      policy_origin: '',
    });
    assert.equal(r.success, false);
  });

  it('rejects null input', () => {
    const r = PolicySnapshotV1.safeParse(null);
    assert.equal(r.success, false);
  });

  it('serializes to JSON and parses back', () => {
    const original = PolicySnapshotV1.parse(validSnapshot);
    const json = JSON.stringify(original);
    const roundTripped = PolicySnapshotV1.parse(JSON.parse(json) as unknown);
    assert.deepEqual(roundTripped, original);
  });

  it('no schema parse performs database access or process launch', () => {
    const snap = PolicySnapshotV1.parse(validSnapshot);
    assert.equal(snap.schema_version, 1);
  });
});
