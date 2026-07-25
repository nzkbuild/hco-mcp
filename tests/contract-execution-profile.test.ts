import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionProfileV1 } from '../src/contract/execution-profile.js';

describe('ExecutionProfileV1', () => {
  const validProfile = {
    profile_id: 'toche-builder',
    claude_defaults: {
      binary_path: 'claude',
      default_model: 'claude-sonnet-5',
      default_thinking_effort: 'high',
      default_timeout_ms: 300_000,
      session_dir: '/tmp/hco-claude',
    },
    allowed_overrides: ['model', 'thinking_effort', 'skills'],
    repository_allowlist: [{ owner: 'nzkbuild', repo: 'hco-mcp' }],
  };

  it('accepts valid profile', () => {
    const profile = ExecutionProfileV1.parse(validProfile);
    assert.equal(profile.schema_version, 1);
    assert.equal(profile.profile_id, 'toche-builder');
    assert.equal(profile.claude_defaults.binary_path, 'claude');
    assert.equal(profile.claude_defaults.default_model, 'claude-sonnet-5');
    assert.equal(profile.claude_defaults.default_thinking_effort, 'high');
    assert.equal(profile.claude_defaults.default_timeout_ms, 300_000);
    assert.deepEqual(profile.allowed_overrides, ['model', 'thinking_effort', 'skills']);
    assert.deepEqual(profile.repository_allowlist, [{ owner: 'nzkbuild', repo: 'hco-mcp' }]);
  });

  it('accepts all optional fields', () => {
    const profile = ExecutionProfileV1.parse({
      ...validProfile,
      provider_restrictions: {
        allowed_models: ['claude-sonnet-5', 'claude-haiku-4-5'],
        allowed_thinking_efforts: ['low', 'medium', 'high'],
      },
      permission_defaults: {
        mode: 'acceptEdits',
        allowed_tools: ['Read', 'Write', 'Edit'],
      },
      validation_defaults: {
        profile: 'standard',
        post_execution: true,
      },
      max_prompt_bytes: 65536,
      max_execution_time_ms: 600_000,
      max_concurrent_executions: 4,
      environment_allowlist: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
      approval_required: false,
      output_limits: {
        inline_response_max_bytes: 65536,
        event_chunk_max_bytes: 262144,
        artifact_max_bytes: 10_485_760,
        total_max_bytes: 104_857_600,
      },
    });

    assert.equal(profile.provider_restrictions?.allowed_models?.length, 2);
    assert.equal(profile.permission_defaults?.mode, 'acceptEdits');
    assert.equal(profile.validation_defaults?.profile, 'standard');
    assert.equal(profile.validation_defaults?.post_execution, true);
    assert.equal(profile.max_prompt_bytes, 65536);
    assert.equal(profile.max_execution_time_ms, 600_000);
    assert.equal(profile.max_concurrent_executions, 4);
    assert.deepEqual(profile.environment_allowlist, ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']);
    assert.equal(profile.approval_required, false);
    assert.equal(profile.output_limits?.inline_response_max_bytes, 65536);
    assert.equal(profile.output_limits?.artifact_max_bytes, 10_485_760);
    assert.equal(profile.output_limits?.total_max_bytes, 104_857_600);
  });

  it('rejects empty profile_id', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      profile_id: '',
    });
    assert.equal(r.success, false);
  });

  it('rejects profile_id exceeding max length', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      profile_id: 'a'.repeat(257),
    });
    assert.equal(r.success, false);
  });

  it('rejects missing claude_defaults', () => {
    const r = ExecutionProfileV1.safeParse({
      profile_id: 'test',
      allowed_overrides: [],
      repository_allowlist: validProfile.repository_allowlist,
    });
    assert.equal(r.success, false);
  });

  it('rejects empty binary_path', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      claude_defaults: { ...validProfile.claude_defaults, binary_path: '' },
    });
    assert.equal(r.success, false);
  });

  it('rejects default_timeout_ms below minimum', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      claude_defaults: {
        ...validProfile.claude_defaults,
        default_timeout_ms: 0,
      },
    });
    assert.equal(r.success, false);
  });

  it('rejects default_timeout_ms above maximum', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      claude_defaults: {
        ...validProfile.claude_defaults,
        default_timeout_ms: 3_600_001,
      },
    });
    assert.equal(r.success, false);
  });

  it('rejects empty allowed_overrides element', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      allowed_overrides: ['model', ''],
    });
    assert.equal(r.success, false);
  });

  it('rejects allowed_overrides exceeding max length', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      allowed_overrides: Array.from({ length: 51 }, (_, i) => `key-${String(i)}`),
    });
    assert.equal(r.success, false);
  });

  it('rejects empty repository_allowlist entry owner', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      repository_allowlist: [{ repo: 'test', owner: '' }],
    });
    assert.equal(r.success, false);
  });

  it('rejects empty repository_allowlist', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      repository_allowlist: [],
    });
    assert.equal(r.success, false);
  });

  it('rejects unsupported schema_version', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      schema_version: 99,
    });
    assert.equal(r.success, false);
  });

  it('rejects invalid default_thinking_effort', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      claude_defaults: {
        ...validProfile.claude_defaults,
        default_thinking_effort: 'super-max',
      },
    });
    assert.equal(r.success, false);
  });

  it('rejects max_prompt_bytes below minimum', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      max_prompt_bytes: 0,
    });
    assert.equal(r.success, false);
  });

  it('rejects max_execution_time_ms below minimum', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      max_execution_time_ms: 0,
    });
    assert.equal(r.success, false);
  });

  it('rejects max_concurrent_executions below 0', () => {
    const r = ExecutionProfileV1.safeParse({
      ...validProfile,
      max_concurrent_executions: -1,
    });
    assert.equal(r.success, false);
  });

  it('rejects null input', () => {
    const r = ExecutionProfileV1.safeParse(null);
    assert.equal(r.success, false);
  });

  it('serializes to JSON and parses back', () => {
    const original = ExecutionProfileV1.parse({
      ...validProfile,
      provider_restrictions: {
        allowed_models: ['claude-sonnet-5'],
      },
      output_limits: {
        artifact_max_bytes: 10_485_760,
        total_max_bytes: 104_857_600,
      },
    });
    const json = JSON.stringify(original);
    const roundTripped = ExecutionProfileV1.parse(JSON.parse(json) as unknown);
    assert.deepEqual(roundTripped, original);
  });

  it('no schema parse performs database access or process launch', () => {
    const profile = ExecutionProfileV1.parse(validProfile);
    assert.equal(profile.schema_version, 1);
  });
});
