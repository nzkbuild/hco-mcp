import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/state/db.js';
import { ProviderService } from '../src/provider/service.js';
import { HcoConfig } from '../src/config/schema.js';
import type Database from 'better-sqlite3';

function tempDataDir(label: string): string {
  const dir = join(tmpdir(), `hco-test-setup-provider-${label}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function newService(dir: string): { service: ProviderService; db: Database.Database } {
  const db = openDb(dir);
  const service = new ProviderService(db);
  return { service, db };
}

describe('Provider registration', () => {
  let dataDir: string;

  before(() => {
    dataDir = tempDataDir('reg');
  });

  after(() => {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('has no providers initially', () => {
    const { service, db } = newService(dataDir);
    const providers = service.listProviders();
    assert.equal(providers.length, 0);
    db.close();
  });

  it('registers a new provider profile', () => {
    const { service, db } = newService(dataDir);
    const profile = {
      schema_version: 1 as const,
      profile_id: 'claude-primary',
      provider: 'anthropic' as const,
      api_key_env: 'ANTHROPIC_API_KEY',
      base_url_env: 'ANTHROPIC_BASE_URL',
    };
    const row = service.register(profile);
    assert.ok(row.providerId.startsWith('provider-'));
    assert.equal(row.status, 'registered');
    db.close();
  });

  it('rejects duplicate profile_id', () => {
    const dir = tempDataDir('dup');
    const { service, db } = newService(dir);
    const profile = {
      schema_version: 1 as const,
      profile_id: 'test-dup',
      provider: 'anthropic' as const,
      api_key_env: 'ANTHROPIC_API_KEY',
    };
    service.register(profile);
    assert.throws(() => service.register(profile));
    db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });
});

describe('Provider secret safety', () => {
  let dataDir: string;

  before(() => {
    dataDir = tempDataDir('secrets');
  });

  after(() => {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* Windows */
    }
  });

  it('stores only env var names in ProviderProfileV1', () => {
    const { service, db } = newService(dataDir);
    const profile = {
      schema_version: 1 as const,
      profile_id: 'no-secrets',
      provider: 'anthropic' as const,
      api_key_env: 'ANTHROPIC_API_KEY',
      base_url_env: 'ANTHROPIC_BASE_URL',
    };
    const row = service.register(profile);
    const stored = service.getStatus(row.providerId);
    assert.ok(stored, 'getStatus should return provider');
    if (stored) {
      assert.equal(stored.provider.apiKeyEnv, 'ANTHROPIC_API_KEY');
      assert.equal(stored.provider.baseUrlEnv, 'ANTHROPIC_BASE_URL');
      // Verify no raw key in provider metadata
      const meta = stored.provider.providerMetadata;
      if (meta) {
        const metaStr = JSON.stringify(meta);
        assert.equal(metaStr.includes('sk-ant'), false, 'No raw key in metadata');
      }
    }
    db.close();
  });

  it('database never stores raw API key values', () => {
    const { db } = newService(dataDir);
    // Query all text columns in the providers table
    const dump = JSON.stringify(db.prepare('SELECT * FROM providers').all());
    assert.equal(dump.includes('sk-ant'), false, 'DB must not contain raw key prefix');
    db.close();
  });
});

describe('Concurrency default', () => {
  it('defaults to 1', () => {
    const cfg = HcoConfig.parse({});
    assert.equal(cfg.maxConcurrency, 1);
  });
});
