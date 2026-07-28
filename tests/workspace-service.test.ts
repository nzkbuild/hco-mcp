import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';
import { registerProvider } from '../src/state/provider-repository.js';
import { WorkspaceService } from '../src/workspace/service.js';
import type { ProviderProfileV1 } from '../src/contract/provider-profile.js';

const TEST_DB_DIR = '/tmp/hco-test-workspace-service';

function validProfile(profileId: string): ProviderProfileV1 {
  return {
    profile_id: profileId,
    provider: 'anthropic',
    api_key_env: 'ANTHROPIC_API_KEY',
  } as ProviderProfileV1;
}

describe('WorkspaceService', () => {
  let db: Database.Database;
  let service: WorkspaceService;

  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    db = openDb(TEST_DB_DIR);
    service = new WorkspaceService(db);
  });

  after(() => {
    db.close();
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });

  it('createOrResume creates workspace for new repo', () => {
    const provider = registerAndActivate(db, 'ws-svc-p1');
    const ws = service.createOrResume('owner', 'repo', '/path', provider.providerId);
    assert.ok(ws);
    assert.equal(ws.repositoryOwner, 'owner');
    assert.equal(ws.status, 'active');
  });

  it('createOrResume returns existing workspace idempotently', () => {
    const provider = registerAndActivate(db, 'ws-svc-p2');
    const first = service.createOrResume('idem-owner', 'idem-repo', '/p', provider.providerId);
    const second = service.createOrResume('idem-owner', 'idem-repo', '/p', provider.providerId);
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.workspaceId, second.workspaceId);
  });

  it('createOrResume with different provider creates separate workspace', () => {
    const p1 = registerAndActivate(db, 'ws-svc-p3a');
    const p2 = registerAndActivate(db, 'ws-svc-p3b');
    const ws1 = service.createOrResume('sep-owner', 'sep-repo', '/p1', p1.providerId);
    const ws2 = service.createOrResume('sep-owner', 'sep-repo', '/p2', p2.providerId);
    assert.ok(ws1);
    assert.ok(ws2);
    assert.notEqual(ws1.workspaceId, ws2.workspaceId);
  });

  it('createOrResume re-touches workspace on idempotent resume', () => {
    const provider = registerAndActivate(db, 'ws-svc-p4');
    const first = service.createOrResume('touch-owner', 'touch-repo', '/p', provider.providerId);
    const second = service.createOrResume('touch-owner', 'touch-repo', '/p', provider.providerId);
    assert.ok(first);
    assert.ok(second);
    assert.ok(second.lastResumedAt);
  });

  it('list returns all workspaces', () => {
    const provider = registerAndActivate(db, 'ws-svc-p5');
    service.createOrResume('list-o1', 'list-r1', '/p1', provider.providerId);
    service.createOrResume('list-o2', 'list-r2', '/p2', provider.providerId);
    const all = service.list();
    assert.ok(all.length >= 2);
  });

  it('archive transitions workspace to archived', () => {
    const provider = registerAndActivate(db, 'ws-svc-p6');
    const ws = service.createOrResume('arch-o', 'arch-r', '/p', provider.providerId);
    assert.ok(ws);
    const archived = service.archive(ws.workspaceId);
    assert.ok(archived);
    assert.equal(archived.status, 'archived');
  });

  it('getStatus returns workspace with provider status', () => {
    const provider = registerAndActivate(db, 'ws-svc-p7');
    const ws = service.createOrResume('stat-o', 'stat-r', '/p', provider.providerId);
    assert.ok(ws);
    const status = service.getStatus(ws.workspaceId);
    assert.ok(status);
    assert.ok(status.provider);
    assert.equal(status.provider.status, 'active');
  });

  it('getStatus returns null for unknown', () => {
    assert.equal(service.getStatus('nonexistent'), null);
  });

  it('createOrResume rejects inactive provider', () => {
    registerProvider(db, validProfile('ws-svc-inactive'));
    assert.throws(
      () => service.createOrResume('o', 'r', '/p', 'provider-ws-svc-inactive'),
      /not active/,
    );
  });
});

function registerAndActivate(
  db: Database.Database,
  profileId: string,
): ReturnType<typeof registerProvider> {
  const provider = registerProvider(db, {
    profile_id: profileId,
    provider: 'anthropic',
    api_key_env: 'ANTHROPIC_API_KEY',
  } as ProviderProfileV1);
  db.prepare("UPDATE providers SET status = 'active' WHERE provider_id = ?").run(
    provider.providerId,
  );
  return provider;
}
