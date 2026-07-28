import Database from 'better-sqlite3';
import type { WorkspaceV1 } from '../contract/workspace.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceRow {
  id: number;
  workspaceId: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryPath: string;
  providerProfileId: string;
  modelMappingId: string | null;
  policySnapshotJson: string | null;
  environmentProfileJson: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  lastResumedAt: string | null;
}

// ─── Row mapping ────────────────────────────────────────────────────────────────

function rowToWorkspace(row: Record<string, unknown>): WorkspaceRow {
  return {
    id: row.id as number,
    workspaceId: row.workspace_id as string,
    repositoryOwner: row.repository_owner as string,
    repositoryName: row.repository_name as string,
    repositoryPath: row.repository_path as string,
    providerProfileId: row.provider_profile_id as string,
    modelMappingId: (row.model_mapping_id as string | null) ?? null,
    policySnapshotJson: (row.policy_snapshot_json as string | null) ?? null,
    environmentProfileJson: (row.environment_profile_json as string | null) ?? null,
    status: row.status as 'active' | 'archived',
    createdAt: row.created_at as string,
    lastResumedAt: (row.last_resumed_at as string | null) ?? null,
  };
}

function dbNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ─── CRUD ───────────────────────────────────────────────────────────────────────

export function createWorkspace(db: Database.Database, workspace: WorkspaceV1): WorkspaceRow {
  const now = dbNow();
  db.prepare(
    `INSERT INTO workspaces (workspace_id, repository_owner, repository_name, repository_path, provider_profile_id, model_mapping_id, policy_snapshot_json, environment_profile_json, status, created_at, last_resumed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    workspace.workspace_id,
    workspace.repository_owner,
    workspace.repository_name,
    workspace.repository_path,
    workspace.provider_profile_id,
    workspace.model_mapping_id ?? null,
    workspace.policy_snapshot_json ?? null,
    workspace.environment_profile_json ?? null,
    now,
    now,
  );

  const row = db
    .prepare('SELECT * FROM workspaces WHERE workspace_id = ?')
    .get(workspace.workspace_id) as Record<string, unknown>;
  return rowToWorkspace(row);
}

export function getWorkspace(db: Database.Database, workspaceId: string): WorkspaceRow | null {
  const row = db.prepare('SELECT * FROM workspaces WHERE workspace_id = ?').get(workspaceId) as
    Record<string, unknown> | undefined;
  return row ? rowToWorkspace(row) : null;
}

export function listWorkspaces(db: Database.Database, opts?: { status?: string }): WorkspaceRow[] {
  let rows: Record<string, unknown>[];
  if (opts?.status) {
    rows = db
      .prepare('SELECT * FROM workspaces WHERE status = ? ORDER BY created_at DESC')
      .all(opts.status) as Record<string, unknown>[];
  } else {
    rows = db.prepare('SELECT * FROM workspaces ORDER BY created_at DESC').all() as Record<
      string,
      unknown
    >[];
  }
  return rows.map(rowToWorkspace);
}

export function findWorkspaceByRepository(
  db: Database.Database,
  owner: string,
  repo: string,
  providerProfileId?: string,
): WorkspaceRow[] {
  let rows: Record<string, unknown>[];
  if (providerProfileId) {
    rows = db
      .prepare(
        'SELECT * FROM workspaces WHERE repository_owner = ? AND repository_name = ? AND provider_profile_id = ? AND status = ?',
      )
      .all(owner, repo, providerProfileId, 'active') as Record<string, unknown>[];
  } else {
    rows = db
      .prepare(
        'SELECT * FROM workspaces WHERE repository_owner = ? AND repository_name = ? AND status = ?',
      )
      .all(owner, repo, 'active') as Record<string, unknown>[];
  }
  return rows.map(rowToWorkspace);
}

export function archiveWorkspace(db: Database.Database, workspaceId: string): WorkspaceRow | null {
  const existing = getWorkspace(db, workspaceId);
  if (!existing || existing.status === 'archived') return null;

  db.prepare("UPDATE workspaces SET status = 'archived' WHERE workspace_id = ?").run(workspaceId);
  return getWorkspace(db, workspaceId);
}

export function touchWorkspace(db: Database.Database, workspaceId: string): void {
  const now = dbNow();
  db.prepare('UPDATE workspaces SET last_resumed_at = ? WHERE workspace_id = ?').run(
    now,
    workspaceId,
  );
}
