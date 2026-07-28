import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelInfoV1 } from '../src/contract/model-info.js';

describe('ModelInfoV1', () => {
  it('accepts valid model info', () => {
    const model = ModelInfoV1.parse({
      model_id: 'claude-sonnet-5',
      display_name: 'Claude Sonnet 5',
      provider: 'anthropic',
      capabilities: ['text', 'code', 'tools'],
    });
    assert.equal(model.model_id, 'claude-sonnet-5');
    assert.equal(model.provider, 'anthropic');
    assert.deepEqual(model.capabilities, ['text', 'code', 'tools']);
  });

  it('defaults capabilities to empty array', () => {
    const model = ModelInfoV1.parse({
      model_id: 'gpt-5.6',
      display_name: 'GPT 5.6',
      provider: 'openai',
    });
    assert.deepEqual(model.capabilities, []);
  });

  it('rejects missing model_id', () => {
    assert.throws(
      () =>
        ModelInfoV1.parse({
          display_name: 'Test',
          provider: 'anthropic',
        }),
      /model_id/,
    );
  });

  it('rejects empty model_id', () => {
    assert.throws(
      () =>
        ModelInfoV1.parse({
          model_id: '',
          display_name: 'Test',
          provider: 'anthropic',
        }),
      /model_id/,
    );
  });

  it('serializes and deserializes predictably', () => {
    const input = {
      model_id: 'claude-haiku-4-5',
      display_name: 'Claude Haiku 4.5',
      provider: 'anthropic' as const,
      capabilities: ['text', 'vision'],
    };
    const parsed = ModelInfoV1.parse(input);
    const json = JSON.stringify(parsed);
    const round = ModelInfoV1.parse(JSON.parse(json));
    assert.equal(round.model_id, input.model_id);
    assert.equal(round.display_name, input.display_name);
  });
});
