import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { openDb } from '../src/state/db.js';
import { registerProvider } from '../src/state/provider-repository.js';
import {
  createModelMapping,
  listModelMappings,
  updateMappingValidation,
  deleteMappingsByProvider,
} from '../src/state/model-mapping-repository.js';
import type { ProviderProfileV1 } from '../src/contract/provider-profile.js';

const TEST_DB_DIR = '/tmp/hco-test-mapping-repo';

function validProfile(profileId: string): ProviderProfileV1 {
  return {
    profile_id: profileId,
    provider: 'anthropic',
    api_key_env: 'ANTHROPIC_API_KEY',
  } as ProviderProfileV1;
}

describe('ModelMappingRepository', () => {
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

  it('createMapping persists with correct FK', () => {
    const provider = registerProvider(db, validProfile('mapping-test-1'));
    const mapping = createModelMapping(
      db,
      'mapping-1',
      provider.providerId,
      'claude-sonnet-5',
      'sonnet',
    );
    assert.equal(mapping.mappingId, 'mapping-1');
    assert.equal(mapping.providerId, provider.providerId);
    assert.equal(mapping.hcoRole, 'sonnet');
    assert.equal(mapping.validated, 0);
  });

  it('listMappings returns only for given provider', () => {
    const p1 = registerProvider(db, validProfile('mapping-list-1'));
    const p2 = registerProvider(db, validProfile('mapping-list-2'));
    createModelMapping(db, 'm1', p1.providerId, 'model-a', 'sonnet');
    createModelMapping(db, 'm2', p1.providerId, 'model-b', 'haiku');
    createModelMapping(db, 'm3', p2.providerId, 'model-c', 'opus');

    const p1Mappings = listModelMappings(db, p1.providerId);
    assert.equal(p1Mappings.length, 2);

    const p2Mappings = listModelMappings(db, p2.providerId);
    assert.equal(p2Mappings.length, 1);
    assert.equal(p2Mappings[0].hcoRole, 'opus');
  });

  it('updateMappingValidation toggles validated flag', () => {
    const provider = registerProvider(db, validProfile('mapping-toggle'));
    const mapping = createModelMapping(db, 'toggle-1', provider.providerId, 'model-x', 'fable');
    assert.equal(mapping.validated, 0);

    const updated = updateMappingValidation(db, 'toggle-1', true);
    assert.ok(updated);
    assert.equal(updated.validated, 1);

    const reverted = updateMappingValidation(db, 'toggle-1', false);
    assert.ok(reverted);
    assert.equal(reverted.validated, 0);
  });

  it('updateMappingValidation returns null for unknown ID', () => {
    assert.equal(updateMappingValidation(db, 'nonexistent', true), null);
  });

  it('deleteMappingsByProvider removes all mappings for provider', () => {
    const provider = registerProvider(db, validProfile('mapping-delete'));
    createModelMapping(db, 'd1', provider.providerId, 'model-1', 'sonnet');
    createModelMapping(db, 'd2', provider.providerId, 'model-2', 'haiku');

    const deleted = deleteMappingsByProvider(db, provider.providerId);
    assert.equal(deleted, 2);
    assert.equal(listModelMappings(db, provider.providerId).length, 0);
  });

  it('all 5 HCO roles are accepted', () => {
    const provider = registerProvider(db, validProfile('all-roles'));
    const roles = ['fable', 'opus', 'sonnet', 'haiku', 'subagent'] as const;
    for (let i = 0; i < roles.length; i++) {
      const m = createModelMapping(
        db,
        `role-${String(i)}`,
        provider.providerId,
        `model-${String(roles[i])}`,
        roles[i],
      );
      assert.equal(m.hcoRole, roles[i]);
    }
    assert.equal(listModelMappings(db, provider.providerId).length, 5);
  });
});
