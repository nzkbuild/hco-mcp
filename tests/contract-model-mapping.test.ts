import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelMappingV1 } from '../src/contract/model-mapping.js';

describe('ModelMappingV1', () => {
  it('accepts valid mapping with sonnet role', () => {
    const mapping = ModelMappingV1.parse({
      mapping_id: 'mapping-1',
      provider_profile_id: 'profile-1',
      provider_model_id: 'claude-sonnet-5',
      hco_role: 'sonnet',
      validated: true,
      created_at: '2026-07-28T00:00:00Z',
    });
    assert.equal(mapping.hco_role, 'sonnet');
    assert.equal(mapping.validated, true);
  });

  it('validates all 5 HCO roles', () => {
    for (const role of ['fable', 'opus', 'sonnet', 'haiku', 'subagent']) {
      const mapping = ModelMappingV1.parse({
        mapping_id: `mapping-${role}`,
        provider_profile_id: 'profile-1',
        provider_model_id: 'model-1',
        hco_role: role,
        created_at: '2026-07-28T00:00:00Z',
      });
      assert.equal(mapping.hco_role, role);
    }
  });

  it('rejects unknown role', () => {
    assert.throws(
      () =>
        ModelMappingV1.parse({
          mapping_id: 'mapping-1',
          provider_profile_id: 'profile-1',
          provider_model_id: 'model-1',
          hco_role: 'assistant',
          created_at: '2026-07-28T00:00:00Z',
        }),
      /hco_role/,
    );
  });

  it('defaults validated to false', () => {
    const mapping = ModelMappingV1.parse({
      mapping_id: 'mapping-2',
      provider_profile_id: 'profile-1',
      provider_model_id: 'model-1',
      hco_role: 'haiku',
      created_at: '2026-07-28T00:00:00Z',
    });
    assert.equal(mapping.validated, false);
  });

  it('rejects missing mapping_id', () => {
    assert.throws(
      () =>
        ModelMappingV1.parse({
          provider_profile_id: 'profile-1',
          provider_model_id: 'model-1',
          hco_role: 'sonnet',
          created_at: '2026-07-28T00:00:00Z',
        }),
      /mapping_id/,
    );
  });

  it('serializes and deserializes predictably', () => {
    const input = {
      mapping_id: 'round-trip',
      provider_profile_id: 'profile-1',
      provider_model_id: 'claude-opus-5',
      hco_role: 'opus' as const,
      validated: true,
      created_at: '2026-07-28T00:00:00Z',
    };
    const parsed = ModelMappingV1.parse(input);
    const json = JSON.stringify(parsed);
    const round = ModelMappingV1.parse(JSON.parse(json));
    assert.equal(round.mapping_id, input.mapping_id);
    assert.equal(round.hco_role, input.hco_role);
  });
});
