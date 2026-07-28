import type Database from 'better-sqlite3';
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  findWorkspaceByRepository,
  archiveWorkspace,
  touchWorkspace,
  type WorkspaceRow,
} from '../state/workspace-repository.js';
import { getProvider } from '../state/provider-repository.js';

export class WorkspaceService {
  constructor(private readonly db: Database.Database) {}

  createOrResume(
    owner: string,
    repo: string,
    path: string,
    providerProfileId: string,
  ): WorkspaceRow | null {
    // Check provider exists
    const provider = getProvider(this.db, providerProfileId);
    if (!provider) {
      throw new Error(`Provider "${providerProfileId}" not found`);
    }
    if (provider.status !== 'active') {
      throw new Error(`Provider "${providerProfileId}" is not active (status: ${provider.status})`);
    }

    // Idempotent: return existing workspace if one exists
    const existing = findWorkspaceByRepository(this.db, owner, repo, providerProfileId);
    if (existing.length > 0) {
      const first = existing[0];
      if (!first) throw new Error('findWorkspaceByRepository returned empty entry');
      touchWorkspace(this.db, first.workspaceId);
      const ws = getWorkspace(this.db, first.workspaceId);
      if (!ws) throw new Error('Workspace disappeared after touch');
      return ws;
    }

    // Create new workspace
    const workspaceId = `ws-${owner}-${repo}-${providerProfileId}-${String(Date.now())}`;
    return createWorkspace(this.db, {
      workspace_id: workspaceId,
      repository_owner: owner,
      repository_name: repo,
      repository_path: path,
      provider_profile_id: providerProfileId,
      status: 'active',
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
  }

  list(): WorkspaceRow[] {
    return listWorkspaces(this.db);
  }

  archive(workspaceId: string): WorkspaceRow | null {
    return archiveWorkspace(this.db, workspaceId);
  }

  getStatus(
    workspaceId: string,
  ): { workspace: WorkspaceRow; provider: { status: string } | null } | null {
    const ws = getWorkspace(this.db, workspaceId);
    if (!ws) return null;

    const provider = getProvider(this.db, ws.providerProfileId);
    return {
      workspace: ws,
      provider: provider ? { status: provider.status } : null,
    };
  }

  touch(workspaceId: string): void {
    touchWorkspace(this.db, workspaceId);
  }
}
