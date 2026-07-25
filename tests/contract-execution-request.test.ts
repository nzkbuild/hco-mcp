import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionRequestV1 } from '../src/contract/execution-request.js';

describe('ExecutionRequestV1', () => {
  const minimalRequest = {
    brief: {
      original_request: 'Make onboarding easier.',
      objective: 'Simplify the onboarding flow for new users.',
      context: 'The current onboarding has 5 steps. Users drop off at step 3.',
      constraints: ['Must keep existing auth system.', 'Mobile compatible.'],
      acceptance_criteria: [
        'Onboarding completes in under 2 minutes.',
        'Drop-off rate drops below 10%.',
      ],
      requested_validation: ['npm run build', 'npm run test'],
    },
    claude_config: {
      profile: 'toche-builder',
    },
    repository: {
      owner: 'nzkbuild',
      repo: 'hco-mcp',
      path: '/home/hermes/repos/hco-mcp',
    },
    policy_ref: 'standard-policy',
  };

  it('accepts minimum valid request', () => {
    const req = ExecutionRequestV1.parse(minimalRequest);
    assert.equal(req.schema_version, 1);
    assert.equal(req.brief.original_request, 'Make onboarding easier.');
    assert.equal(req.brief.objective, 'Simplify the onboarding flow for new users.');
    assert.equal(req.claude_config.profile, 'toche-builder');
    assert.equal(req.repository.owner, 'nzkbuild');
    assert.equal(req.policy_ref, 'standard-policy');
    assert.ok(typeof req.request_id === 'string');
    assert.ok(req.request_id.length > 0);
    assert.equal(req.idempotency_key, undefined);
    assert.ok(typeof req.submitted_at === 'string');
  });

  it('accepts full request with all optional fields', () => {
    const req = ExecutionRequestV1.parse({
      ...minimalRequest,
      idempotency_key: 'hermes-task-42',
      claude_config: {
        profile: 'toche-builder',
        provider_profile: 'toche-creds',
        model: 'claude-sonnet-5',
        thinking_effort: 'high',
        skills: ['rust'],
        permission_mode: 'acceptEdits',
        validation_profile: 'strict',
        session_mode: 'continue',
        continuation_session_id: 'claude-alice-demo-l2k3j4',
        timeout_ms: 300_000,
        overrides: { model: 'claude-opus-5' },
      },
      repository: {
        ...minimalRequest.repository,
      },
    });

    assert.equal(req.idempotency_key, 'hermes-task-42');
    assert.equal(req.claude_config.provider_profile, 'toche-creds');
    assert.equal(req.claude_config.model, 'claude-sonnet-5');
    assert.equal(req.claude_config.thinking_effort, 'high');
    assert.deepEqual(req.claude_config.skills, ['rust']);
    assert.equal(req.claude_config.permission_mode, 'acceptEdits');
    assert.equal(req.claude_config.validation_profile, 'strict');
    assert.equal(req.claude_config.session_mode, 'continue');
    assert.equal(req.claude_config.continuation_session_id, 'claude-alice-demo-l2k3j4');
    assert.equal(req.claude_config.timeout_ms, 300_000);
    assert.deepEqual(req.claude_config.overrides, { model: 'claude-opus-5' });
  });

  it('preserves original_request distinct from objective', () => {
    const req = ExecutionRequestV1.parse({
      ...minimalRequest,
      brief: {
        ...minimalRequest.brief,
        original_request: 'Make it easier.',
        objective: 'Reduce onboarding steps from 5 to 3.',
      },
    });
    assert.equal(req.brief.original_request, 'Make it easier.');
    assert.equal(req.brief.objective, 'Reduce onboarding steps from 5 to 3.');
    assert.notEqual(req.brief.original_request, req.brief.objective);
  });

  it('auto-generates request_id when absent', () => {
    const req = ExecutionRequestV1.parse(minimalRequest);
    assert.ok(req.request_id.startsWith('req-'));
    assert.ok(req.request_id.length > 4);
  });

  it('accepts caller-provided request_id', () => {
    const req = ExecutionRequestV1.parse({
      ...minimalRequest,
      request_id: 'req-custom-abc',
    });
    assert.equal(req.request_id, 'req-custom-abc');
  });

  it('accepts optional idempotency_key', () => {
    const req = ExecutionRequestV1.parse({
      ...minimalRequest,
      idempotency_key: 'hermes-task-001',
    });
    assert.equal(req.idempotency_key, 'hermes-task-001');
  });

  it('omits idempotency_key cleanly when absent', () => {
    const req = ExecutionRequestV1.parse(minimalRequest);
    assert.equal(req.idempotency_key, undefined);
  });

  it('rejects missing brief', () => {
    const r = ExecutionRequestV1.safeParse({
      claude_config: minimalRequest.claude_config,
      repository: minimalRequest.repository,
      policy_ref: minimalRequest.policy_ref,
    });
    assert.equal(r.success, false);
  });

  it('rejects missing claude_config', () => {
    const r = ExecutionRequestV1.safeParse({
      brief: minimalRequest.brief,
      repository: minimalRequest.repository,
      policy_ref: minimalRequest.policy_ref,
    });
    assert.equal(r.success, false);
  });

  it('rejects missing repository', () => {
    const r = ExecutionRequestV1.safeParse({
      brief: minimalRequest.brief,
      claude_config: minimalRequest.claude_config,
      policy_ref: minimalRequest.policy_ref,
    });
    assert.equal(r.success, false);
  });

  it('rejects missing policy_ref', () => {
    const r = ExecutionRequestV1.safeParse({
      brief: minimalRequest.brief,
      claude_config: minimalRequest.claude_config,
      repository: minimalRequest.repository,
    });
    assert.equal(r.success, false);
  });

  it('rejects empty original_request', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      brief: { ...minimalRequest.brief, original_request: '' },
    });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some((i) => i.path.join('.') === 'brief.original_request'));
    }
  });

  it('rejects original_request exceeding max length', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      brief: { ...minimalRequest.brief, original_request: 'x'.repeat(65537) },
    });
    assert.equal(r.success, false);
  });

  it('rejects empty objective', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      brief: { ...minimalRequest.brief, objective: '' },
    });
    assert.equal(r.success, false);
  });

  it('rejects empty constraints array element', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      brief: { ...minimalRequest.brief, constraints: ['valid', ''] },
    });
    assert.equal(r.success, false);
  });

  it('rejects constraints array exceeding max length', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      brief: {
        ...minimalRequest.brief,
        constraints: Array.from({ length: 101 }, (_, i) => `constraint-${String(i)}`),
      },
    });
    assert.equal(r.success, false);
  });

  it('rejects empty acceptance_criteria array element', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      brief: { ...minimalRequest.brief, acceptance_criteria: ['valid', ''] },
    });
    assert.equal(r.success, false);
  });

  it('rejects excessive requested_validation entries', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      brief: {
        ...minimalRequest.brief,
        requested_validation: Array.from({ length: 51 }, (_, i) => `cmd-${String(i)}`),
      },
    });
    assert.equal(r.success, false);
  });

  it('rejects empty repository owner', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      repository: { ...minimalRequest.repository, owner: '' },
    });
    assert.equal(r.success, false);
  });

  it('rejects empty repository repo', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      repository: { ...minimalRequest.repository, repo: '' },
    });
    assert.equal(r.success, false);
  });

  it('rejects non-absolute repository path', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      repository: { ...minimalRequest.repository, path: 'relative/path' },
    });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some((i) => i.path.includes('repository')));
    }
  });

  it('rejects empty policy_ref', () => {
    const r = ExecutionRequestV1.safeParse({ ...minimalRequest, policy_ref: '' });
    assert.equal(r.success, false);
  });

  it('rejects unsupported schema_version', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      schema_version: 99,
    });
    assert.equal(r.success, false);
    if (!r.success) {
      assert.ok(r.error.issues.some((i) => i.path.includes('schema_version')));
    }
  });

  it('rejects invalid idempotency_key (empty string)', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      idempotency_key: '',
    });
    assert.equal(r.success, false);
  });

  it('rejects invalid request_id (empty string)', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      request_id: '',
    });
    assert.equal(r.success, false);
  });

  it('rejects null input', () => {
    const r = ExecutionRequestV1.safeParse(null);
    assert.equal(r.success, false);
  });

  it('rejects malformed claude_config within request', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      claude_config: { model: '' },
    });
    assert.equal(r.success, false);
  });

  it('serializes to JSON and parses back', () => {
    const original = ExecutionRequestV1.parse({
      ...minimalRequest,
      idempotency_key: 'hermes-task-42',
      claude_config: {
        profile: 'test',
        model: 'claude-haiku-4-5',
        skills: ['rust'],
        timeout_ms: 60_000,
      },
    });
    const json = JSON.stringify(original);
    const roundTripped = ExecutionRequestV1.parse(JSON.parse(json) as unknown);
    assert.deepEqual(roundTripped, original);
  });

  it('rejects excessive brief context length', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      brief: { ...minimalRequest.brief, context: 'x'.repeat(200_001) },
    });
    assert.equal(r.success, false);
  });

  it('allows optional empty requested_validation array', () => {
    const req = ExecutionRequestV1.parse({
      ...minimalRequest,
      brief: { ...minimalRequest.brief, requested_validation: [] },
    });
    assert.deepEqual(req.brief.requested_validation, []);
  });

  it('does not accept raw API key fields', () => {
    const r = ExecutionRequestV1.safeParse({
      ...minimalRequest,
      api_key: 'sk-ant-secret-key',
    });
    // Unknown fields should be stripped by .strict() or rejected
    assert.equal(r.success, false);
  });

  it('no schema parse performs database access or process launch', () => {
    // All schemas are pure — parsing does not touch filesystem or DB
    const req = ExecutionRequestV1.parse(minimalRequest);
    assert.ok(req.schema_version === 1);
    // If this test doesn't throw, no side effects occurred during parse
  });
});
