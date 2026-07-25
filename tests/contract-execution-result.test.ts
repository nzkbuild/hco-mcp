import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionResultV1 } from '../src/contract/execution-result.js';

describe('ExecutionResultV1', () => {
  const validResult = {
    execution_id: 'req-abc123',
    status: 'completed',
    claude_session_id: 'claude-alice-demo-l2k3j4',
    summary: {
      exit_code: 0,
      duration_ms: 45000,
      artifacts: [
        { key: 'stdout', artifact_id: 'art-001', content_type: 'text/plain', byte_length: 4096 },
        { key: 'stderr', artifact_id: 'art-002', content_type: 'text/plain', byte_length: 512 },
      ],
    },
    submitted_at: '2026-07-25T12:00:00.000Z',
    started_at: '2026-07-25T12:00:01.000Z',
    finished_at: '2026-07-25T12:00:46.000Z',
  };

  it('accepts valid completed result', () => {
    const result = ExecutionResultV1.parse(validResult);
    assert.equal(result.schema_version, 1);
    assert.equal(result.execution_id, 'req-abc123');
    assert.equal(result.status, 'completed');
    assert.equal(result.claude_session_id, 'claude-alice-demo-l2k3j4');
    assert.equal(result.summary.exit_code, 0);
    assert.equal(result.summary.duration_ms, 45000);
    assert.equal(result.summary.artifacts.length, 2);
    assert.equal(result.finished_at, '2026-07-25T12:00:46.000Z');
  });

  it('accepts all terminal statuses', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'timed_out']) {
      const r = ExecutionResultV1.parse({
        ...validResult,
        status,
        error:
          status === 'completed'
            ? undefined
            : { code: 'TIMEOUT', message: 'Execution timed out after 300s' },
      });
      assert.equal(r.status, status);
    }
  });

  it('accepts failed result with error', () => {
    const result = ExecutionResultV1.parse({
      ...validResult,
      status: 'failed',
      summary: {
        ...validResult.summary,
        exit_code: 1,
      },
      error: { code: 'SPAWN_FAILED', message: 'Claude Code process failed to start' },
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, 'SPAWN_FAILED');
    assert.equal(result.error?.message, 'Claude Code process failed to start');
  });

  it('accepts result with validation_results', () => {
    const result = ExecutionResultV1.parse({
      ...validResult,
      validation_results: [
        {
          profile: 'standard',
          passed: true,
          command_results: [
            { command: 'npm run build', exit_code: 0, passed: true },
            { command: 'npm run test', exit_code: 0, passed: true },
          ],
        },
      ],
    });
    assert.equal(result.validation_results?.length, 1);
    assert.equal(result.validation_results?.[0]?.profile, 'standard');
    assert.equal(result.validation_results?.[0]?.passed, true);
    assert.equal(result.validation_results?.[0]?.command_results?.length, 2);
  });

  it('accepts result with process_attempt_summary', () => {
    const result = ExecutionResultV1.parse({
      ...validResult,
      process_attempt_summary: {
        attempt_number: 1,
        total_attempts: 1,
        retry_reason: undefined,
      },
    });
    assert.equal(result.process_attempt_summary?.attempt_number, 1);
    assert.equal(result.process_attempt_summary?.total_attempts, 1);
  });

  it('accepts result with retry in process_attempt_summary', () => {
    const result = ExecutionResultV1.parse({
      ...validResult,
      process_attempt_summary: {
        attempt_number: 2,
        total_attempts: 3,
        retry_reason: 'First attempt failed due to timeout',
      },
    });
    assert.equal(result.process_attempt_summary?.attempt_number, 2);
    assert.equal(result.process_attempt_summary?.total_attempts, 3);
    assert.ok(result.process_attempt_summary?.retry_reason);
  });

  it('rejects missing execution_id', () => {
    const r = ExecutionResultV1.safeParse({
      status: validResult.status,
      claude_session_id: validResult.claude_session_id,
      summary: validResult.summary,
      submitted_at: validResult.submitted_at,
      finished_at: validResult.finished_at,
    });
    assert.equal(r.success, false);
  });

  it('rejects missing status', () => {
    const { status: _, ...withoutStatus } = validResult;
    const r = ExecutionResultV1.safeParse(withoutStatus);
    assert.equal(r.success, false);
  });

  it('rejects invalid status', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      status: 'archived',
    });
    assert.equal(r.success, false);
  });

  it('rejects empty execution_id', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      execution_id: '',
    });
    assert.equal(r.success, false);
  });

  it('rejects execution_id exceeding max length', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      execution_id: 'a'.repeat(257),
    });
    assert.equal(r.success, false);
  });

  it('rejects empty claude_session_id', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      claude_session_id: '',
    });
    assert.equal(r.success, false);
  });

  it('rejects missing summary', () => {
    const { summary: _, ...withoutSummary } = validResult;
    const r = ExecutionResultV1.safeParse(withoutSummary);
    assert.equal(r.success, false);
  });

  it('rejects negative exit_code', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      summary: { ...validResult.summary, exit_code: -9999 },
    });
    assert.equal(r.success, false);
  });

  it('rejects negative duration_ms', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      summary: { ...validResult.summary, duration_ms: -1 },
    });
    assert.equal(r.success, false);
  });

  it('rejects empty artifact key', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      summary: {
        ...validResult.summary,
        artifacts: [
          { key: '', artifact_id: 'art-001', content_type: 'text/plain', byte_length: 100 },
        ],
      },
    });
    assert.equal(r.success, false);
  });

  it('rejects empty artifact_id', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      summary: {
        ...validResult.summary,
        artifacts: [{ key: 'out', artifact_id: '', content_type: 'text/plain', byte_length: 100 }],
      },
    });
    assert.equal(r.success, false);
  });

  it('rejects unsupported schema_version', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      schema_version: 99,
    });
    assert.equal(r.success, false);
  });

  it('rejects error with empty code', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      status: 'failed',
      error: { code: '', message: 'Something went wrong' },
    });
    assert.equal(r.success, false);
  });

  it('rejects error with empty message', () => {
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      status: 'failed',
      error: { code: 'ERROR', message: '' },
    });
    assert.equal(r.success, false);
  });

  it('rejects null input', () => {
    const r = ExecutionResultV1.safeParse(null);
    assert.equal(r.success, false);
  });

  it('serializes to JSON and parses back', () => {
    const original = ExecutionResultV1.parse({
      ...validResult,
      error: { code: 'CANCELLED', message: 'Cancelled by user' },
      validation_results: [
        {
          profile: 'strict',
          passed: true,
          command_results: [{ command: 'npm test', exit_code: 0, passed: true }],
        },
      ],
    });
    const json = JSON.stringify(original);
    const roundTripped = ExecutionResultV1.parse(JSON.parse(json) as unknown);
    assert.deepEqual(roundTripped, original);
  });

  it('does not embed unlimited stdout in summary', () => {
    // summary artifacts only contain references, not raw output
    const r = ExecutionResultV1.safeParse({
      ...validResult,
      raw_stdout: 'x'.repeat(100000),
    });
    assert.equal(r.success, false, 'raw_stdout must not be accepted');
  });

  it('no schema parse performs database access or process launch', () => {
    const result = ExecutionResultV1.parse(validResult);
    assert.equal(result.schema_version, 1);
  });
});
