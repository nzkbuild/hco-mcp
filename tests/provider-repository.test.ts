import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';
import {
  registerProvider,
  getProvider,
  listProviders,
  getProviderByProfileId,
  updateProviderStatus,
} from '../src/state/provider-repository.js';
import type { ProviderProfileV1 } from '../src/contract/provider-profile.js';

const TEST_DB_DIR = '/tmp/hco-test-provider-repo';

function validProfile(overrides?: Partial<ProviderProfileV1>): ProviderProfileV1 {
  return {
    profile_id: `test-${String(Math.random()).slice(2, 10)}`,
    provider: 'anthropic',
    api_key_env: 'ANTHROPIC_API_KEY',
    ...overrides,
  } as ProviderProfileV1;
}

describe('ProviderRepository', () => {
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

  it('registerProvider persists provider with status registered', () => {
    const profile = validProfile();
    const row = registerProvider(db, profile);
    assert.equal(row.profileId, profile.profile_id);
    assert.equal(row.providerType, 'anthropic');
    assert.equal(row.status, 'registered');
    assert.ok(row.providerId.startsWith('provider-'));
  });

  it('getProvider returns null for unknown ID', () => {
    assert.equal(getProvider(db, 'provider-nonexistent'), null);
  });

  it('getProvider retrieves inserted provider', () => {
    const profile = validProfile();
    const created = registerProvider(db, profile);
    const found = getProvider(db, created.providerId);
    assert.ok(found);
    assert.equal(found.providerId, created.providerId);
    assert.equal(found.profileId, profile.profile_id);
  });

  it('listProviders returns all providers', () => {
    const a = registerProvider(db, validProfile({ profile_id: 'list-a' }));
    const b = registerProvider(db, validProfile({ profile_id: 'list-b' }));
    const all = listProviders(db);
    assert.ok(all.length >= 2);
    const ids = all.map((p) => p.providerId);
    assert.ok(ids.includes(a.providerId));
    assert.ok(ids.includes(b.providerId));
  });

  it('getProviderByProfileId finds by profile_id', () => {
    const profile = validProfile({ profile_id: 'by-profile-id-test' });
    registerProvider(db, profile);
    const found = getProviderByProfileId(db, 'by-profile-id-test');
    assert.ok(found);
    assert.equal(found.profileId, 'by-profile-id-test');
  });

  it('updateProviderStatus follows valid transition', () => {
    const profile = validProfile();
    const created = registerProvider(db, profile);
    const updated = updateProviderStatus(db, created.providerId, 'validated', 'provider_validated');
    assert.ok(updated);
    assert.equal(updated.status, 'validated');
  });

  it('updateProviderStatus rejects invalid transition', () => {
    const profile = validProfile();
    const created = registerProvider(db, profile);
    assert.throws(
      () => updateProviderStatus(db, created.providerId, 'active', 'bad_transition'),
      /Invalid provider transition/,
    );
  });

  it('updateProviderStatus returns null for unknown provider', () => {
    assert.equal(
      updateProviderStatus(db, 'provider-nonexistent', 'validated', 'test'),
      null,
    );
  });

  it('provider events are appended on status change', () => {
    const profile = validProfile();
    const created = registerProvider(db, profile);
    updateProviderStatus(db, created.providerId, 'validated', 'provider_validated');
    updateProviderStatus(db, created.providerId, 'active', 'provider_activated');

    const events = db
      .prepare('SELECT * FROM provider_events WHERE provider_id = ? ORDER BY id')
      .all(created.providerId) as Array<Record<string, unknown>>;
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'provider_validated');
    assert.equal(events[1].type, 'provider_activated');
  });

  it('provider role is preserved through lifecycle', () => {
    const profile = validProfile({ provider: 'openai' });
    const created = registerProvider(db, profile);
    updateProviderStatus(db, created.providerId, 'validated', 'validated');
    updateProviderStatus(db, created.providerId, 'active', 'activated');
    const final = getProvider(db, created.providerId);
    assert.ok(final);
    assert.equal(final.providerType, 'openai');
    assert.equal(final.status, 'active');
  });
});
