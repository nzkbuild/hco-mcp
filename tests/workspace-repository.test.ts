import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';
import { registerProvider } from '../src/state/provider-repository.js';
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  findWorkspaceByRepository,
  archiveWorkspace,
  touchWorkspace,
} from '../src/state/workspace-repository.js';
import type { WorkspaceV1 } from '../src/contract/workspace.js';
import type { ProviderProfileV1 } from '../src/contract/provider-profile.js';

const TEST_DB_DIR = '/tmp/hco-test-workspace-repo';

function ws(opts: Partial<WorkspaceV1> & { workspace_id: string }): WorkspaceV1 {
  return {
    repository_owner: 'nzkbuild',
    repository_name: 'hco',
    repository_path: '/tmp/hco',
    provider_profile_id: 'p1',
    created_at: '2026-07-28T00:00:00Z',
    ...opts,
  } as WorkspaceV1;
}

function validProfile(profileId: string): ProviderProfileV1 {
  return {
    profile_id: profileId,
    provider: 'anthropic',
    api_key_env: 'ANTHROPIC_API_KEY',
  } as ProviderProfileV1;
}

describe('WorkspaceRepository', () => {
  let db: Database.Database;

  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    db = openDb(TEST_DB_DIR);
  });

  after(() => {
    db.close();
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });

  it('createWorkspace persists with status active', () => {
    const provider = registerProvider(db, validProfile('ws-p1'));
    const w = createWorkspace(db, ws({ workspace_id: 'ws-1', provider_profile_id: provider.providerId }));
    assert.equal(w.workspaceId, 'ws-1');
    assert.equal(w.status, 'active');
    assert.equal(w.repositoryOwner, 'nzkbuild');
  });

  it('getWorkspace returns null for unknown ID', () => {
    assert.equal(getWorkspace(db, 'nonexistent'), null);
  });

  it('getWorkspace retrieves inserted workspace', () => {
    const provider = registerProvider(db, validProfile('ws-p2'));
    const created = createWorkspace(db, ws({ workspace_id: 'ws-2', provider_profile_id: provider.providerId }));
    const found = getWorkspace(db, created.workspaceId);
    assert.ok(found);
    assert.equal(found.workspaceId, 'ws-2');
  });

  it('listWorkspaces returns all workspaces', () => {
    const p1 = registerProvider(db, validProfile('ws-p3a'));
    const p2 = registerProvider(db, validProfile('ws-p3b'));
    createWorkspace(db, ws({ workspace_id: 'ws-3a', provider_profile_id: p1.providerId }));
    createWorkspace(db, ws({ workspace_id: 'ws-3b', provider_profile_id: p2.providerId }));
    const all = listWorkspaces(db);
    assert.ok(all.length >= 2);
  });

  it('listWorkspaces filters by status', () => {
    const provider = registerProvider(db, validProfile('ws-p4'));
    const w = createWorkspace(db, ws({ workspace_id: 'ws-4', provider_profile_id: provider.providerId }));
    archiveWorkspace(db, w.workspaceId);
    const active = listWorkspaces(db, { status: 'active' });
    const archived = listWorkspaces(db, { status: 'archived' });
    assert.ok(archived.some((a) => a.workspaceId === w.workspaceId));
    assert.ok(!active.some((a) => a.workspaceId === w.workspaceId));
  });

  it('findWorkspaceByRepository returns matching workspaces', () => {
    const provider = registerProvider(db, validProfile('ws-p5'));
    createWorkspace(
      db,
      ws({
        workspace_id: 'ws-5a',
        provider_profile_id: provider.providerId,
        repository_owner: 'owner-a',
        repository_name: 'repo-x',
      }),
    );
    createWorkspace(
      db,
      ws({
        workspace_id: 'ws-5b',
        provider_profile_id: provider.providerId,
        repository_owner: 'owner-b',
        repository_name: 'repo-y',
      }),
    );

    const found = findWorkspaceByRepository(db, 'owner-a', 'repo-x');
    assert.equal(found.length, 1);
    assert.equal(found[0].workspaceId, 'ws-5a');
  });

  it('findWorkspaceByRepository with provider filter', () => {
    const p1 = registerProvider(db, validProfile('ws-p6a'));
    const p2 = registerProvider(db, validProfile('ws-p6b'));
    createWorkspace(db, ws({ workspace_id: 'ws-6a', provider_profile_id: p1.providerId }));
    createWorkspace(db, ws({ workspace_id: 'ws-6b', provider_profile_id: p2.providerId }));

    const found = findWorkspaceByRepository(db, 'nzkbuild', 'hco', p1.providerId);
    assert.equal(found.length, 1);
    assert.equal(found[0].workspaceId, 'ws-6a');
  });

  it('archiveWorkspace transitions active to archived', () => {
    const provider = registerProvider(db, validProfile('ws-p7'));
    const w = createWorkspace(db, ws({ workspace_id: 'ws-7', provider_profile_id: provider.providerId }));
    const archived = archiveWorkspace(db, w.workspaceId);
    assert.ok(archived);
    assert.equal(archived.status, 'archived');
  });

  it('archiveWorkspace returns null for already archived', () => {
    const provider = registerProvider(db, validProfile('ws-p8'));
    const w = createWorkspace(db, ws({ workspace_id: 'ws-8', provider_profile_id: provider.providerId }));
    archiveWorkspace(db, w.workspaceId);
    assert.equal(archiveWorkspace(db, w.workspaceId), null);
  });

  it('touchWorkspace updates lastResumedAt', () => {
    const provider = registerProvider(db, validProfile('ws-p9'));
    const w = createWorkspace(db, ws({ workspace_id: 'ws-9', provider_profile_id: provider.providerId }));
    touchWorkspace(db, w.workspaceId);
    const updated = getWorkspace(db, w.workspaceId);
    assert.ok(updated);
    assert.ok(updated.lastResumedAt);
  });
});
