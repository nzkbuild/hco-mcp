import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';
import { ProviderService } from '../src/provider/service.js';
import { FakeProviderAdapter } from '../src/provider/fake-adapter.js';
import type { ProviderProfileV1 } from '../src/contract/provider-profile.js';

function fakeAdapterFactory(): FakeProviderAdapter {
  return new FakeProviderAdapter();
}

const TEST_DB_DIR = '/tmp/hco-test-provider-service';

function validProfile(overrides?: Partial<ProviderProfileV1>): ProviderProfileV1 {
  return {
    profile_id: `svc-${String(Math.random()).slice(2, 10)}`,
    provider: 'anthropic',
    api_key_env: 'ANTHROPIC_API_KEY',
    ...overrides,
  } as ProviderProfileV1;
}

describe('ProviderService', () => {
  let db: Database.Database;
  let service: ProviderService;

  before(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    db = openDb(TEST_DB_DIR);
    service = new ProviderService(db, () => fakeAdapterFactory());
  });

  after(() => {
    db.close();
    try {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    } catch {
      /* Windows WAL lock */
    }
  });

  it('register persists provider and returns row', () => {
    const profile = validProfile();
    const row = service.register(profile);
    assert.equal(row.profileId, profile.profile_id);
    assert.equal(row.status, 'registered');
  });

  it('validate transitions to validated with passing adapter', async () => {
    const profile = validProfile();
    const row = service.register(profile);
    const result = await service.validate(row.providerId);
    assert.equal(result.valid, true);

    const status = service.getStatus(row.providerId);
    assert.ok(status);
    assert.equal(status.provider.status, 'validated');
  });

  it('recommendMappings suggests roles by model name', () => {
    const models = [
      { model_id: 'claude-sonnet-5', display_name: 'Sonnet 5', provider: 'anthropic' as const, capabilities: [] },
      { model_id: 'claude-opus-5', display_name: 'Opus 5', provider: 'anthropic' as const, capabilities: [] },
      { model_id: 'gpt-5.6', display_name: 'GPT 5.6', provider: 'openai' as const, capabilities: [] },
    ];
    const recs = service.recommendMappings('provider-test', models);
    assert.equal(recs.length, 3);
    assert.equal(recs[0].hco_role, 'sonnet');
    assert.equal(recs[1].hco_role, 'opus');
    assert.equal(recs[2].hco_role, 'subagent');
  });

  it('activate transitions validated->active and activates mappings', () => {
    const profile = validProfile();
    const row = service.register(profile);
    // manually move to validated
    const db2 = db;
    db2
      .prepare("UPDATE providers SET status = 'validated' WHERE provider_id = ?")
      .run(row.providerId);

    const models = [
      { model_id: 'claude-sonnet-5', display_name: 'Sonnet', provider: 'anthropic' as const, capabilities: [] },
    ];
    const recs = service.recommendMappings(row.providerId, models);
    // persist mappings manually
    for (const r of recs) {
      db2
        .prepare(
          'INSERT OR IGNORE INTO model_mappings (mapping_id, provider_id, provider_model_id, hco_role) VALUES (?, ?, ?, ?)',
        )
        .run(r.mapping_id, row.providerId, r.provider_model_id, r.hco_role);
    }

    const mappingIds = recs.map((r) => r.mapping_id);
    const result = service.activate(row.providerId, mappingIds);
    assert.equal(result.provider.status, 'active');
    assert.equal(result.activated.length, 1);
  });

  it('rollback transitions active->failed', () => {
    const profile = validProfile();
    const row = service.register(profile);
    const db2 = db;
    db2
      .prepare("UPDATE providers SET status = 'active' WHERE provider_id = ?")
      .run(row.providerId);

    const result = service.rollback(row.providerId);
    assert.equal(result.status, 'failed');
  });

  it('getStatus returns null for unknown provider', () => {
    assert.equal(service.getStatus('provider-nonexistent'), null);
  });

  it('getStatus returns full status for active provider', () => {
    const profile = validProfile();
    const row = service.register(profile);
    const status = service.getStatus(row.providerId);
    assert.ok(status);
    assert.equal(status.provider.providerId, row.providerId);
    assert.equal(status.provider.status, 'registered');
  });

  it('listProviders returns all registered providers', () => {
    const a = service.register(validProfile({ profile_id: 'list-svc-a' }));
    const b = service.register(validProfile({ profile_id: 'list-svc-b' }));
    const all = service.listProviders();
    const ids = all.map((p) => p.providerId);
    assert.ok(ids.includes(a.providerId));
    assert.ok(ids.includes(b.providerId));
  });

  it('healthCheck returns healthy for accessible provider', async () => {
    const profile = validProfile();
    const row = service.register(profile);
    const result = await service.healthCheck(row.providerId);
    assert.equal(result.healthy, true);
    assert.ok(typeof result.latency_ms === 'number');
  });

  it('healthCheck returns not healthy for unknown provider', async () => {
    const result = await service.healthCheck('provider-nonexistent');
    assert.equal(result.healthy, false);
  });
});
