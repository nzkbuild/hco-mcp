import type Database from 'better-sqlite3';
import type { ExecutionRequestV1 } from '../contract/execution-request.js';
import type { ExecutionProfileV1 } from '../contract/execution-profile.js';
import type { PolicySnapshotV1 } from '../contract/policy-snapshot.js';
import { createExecution } from '../state/execution-repository.js';
import { logDebug } from '../mcp/logging.js';

// ─── Submit result ──────────────────────────────────────────────────────────────

export interface SubmitResult {
  execution_id: string;
  status: string;
  accepted_at: string;
}

// ─── ExecutionService ───────────────────────────────────────────────────────────

export class ExecutionService {
  constructor(private readonly db: Database.Database) {}

  submit(
    request: ExecutionRequestV1,
    profile: ExecutionProfileV1,
    policy: PolicySnapshotV1,
  ): SubmitResult {
    logDebug(`ExecutionService.submit: request_id=${request.request_id}`);

    const exec = createExecution(this.db, request, profile, policy);

    return {
      execution_id: exec.executionId,
      status: exec.status,
      accepted_at: exec.createdAt,
    };
  }
}
