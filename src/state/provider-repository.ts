import Database from 'better-sqlite3';
import type { ProviderProfileV1 } from '../contract/provider-profile.js';
import { isValidProviderTransition, type ProviderStatus } from '../contract/provider-status.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ProviderRow {
  id: number;
  providerId: string;
  profileId: string;
  providerType: string;
  apiKeyEnv: string;
  baseUrlEnv: string | null;
  defaultModel: string | null;
  providerMetadata: string | null;
  status: ProviderStatus;
  createdAt: string;
  updatedAt: string;
}

// ─── Row mapping ────────────────────────────────────────────────────────────────

function rowToProvider(row: Record<string, unknown>): ProviderRow {
  return {
    id: row.id as number,
    providerId: row.provider_id as string,
    profileId: row.profile_id as string,
    providerType: row.provider as string,
    apiKeyEnv: row.api_key_env as string,
    baseUrlEnv: (row.base_url_env as string | null) ?? null,
    defaultModel: (row.default_model as string | null) ?? null,
    providerMetadata: (row.provider_metadata as string | null) ?? null,
    status: row.status as ProviderStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function dbNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ─── CRUD ───────────────────────────────────────────────────────────────────────

export function registerProvider(
  db: Database.Database,
  profile: ProviderProfileV1,
): ProviderRow {
  const now = dbNow();
  const providerId = `provider-${profile.profile_id}`;

  db.prepare(
    `INSERT INTO providers (provider_id, profile_id, provider, api_key_env, base_url_env, default_model, provider_metadata, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'registered', ?, ?)`,
  ).run(
    providerId,
    profile.profile_id,
    profile.provider,
    profile.api_key_env,
    profile.base_url_env ?? null,
    profile.default_model ?? null,
    profile.provider_metadata ? JSON.stringify(profile.provider_metadata) : null,
    now,
    now,
  );

  const row = db.prepare('SELECT * FROM providers WHERE provider_id = ?').get(providerId) as
    Record<string, unknown>;
  return rowToProvider(row);
}

export function getProvider(db: Database.Database, providerId: string): ProviderRow | null {
  const row = db.prepare('SELECT * FROM providers WHERE provider_id = ?').get(providerId) as
    Record<string, unknown> | undefined;
  return row ? rowToProvider(row) : null;
}

export function listProviders(db: Database.Database): ProviderRow[] {
  const rows = db
    .prepare('SELECT * FROM providers ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map(rowToProvider);
}

export function getProviderByProfileId(
  db: Database.Database,
  profileId: string,
): ProviderRow | null {
  const row = db.prepare('SELECT * FROM providers WHERE profile_id = ?').get(profileId) as
    Record<string, unknown> | undefined;
  return row ? rowToProvider(row) : null;
}

export function updateProviderStatus(
  db: Database.Database,
  providerId: string,
  newStatus: ProviderStatus,
  eventType: string,
): ProviderRow | null {
  const current = getProvider(db, providerId);
  if (!current) return null;

  if (!isValidProviderTransition(current.status, newStatus)) {
    throw new Error(
      `Invalid provider transition: ${current.status} -> ${newStatus}`,
    );
  }

  const now = dbNow();
  db.prepare('UPDATE providers SET status = ?, updated_at = ? WHERE provider_id = ?').run(
    newStatus,
    now,
    providerId,
  );

  db.prepare(
    `INSERT INTO provider_events (provider_id, type, payload, recorded_at)
     VALUES (?, ?, ?, ?)`,
  ).run(providerId, eventType, JSON.stringify({ from: current.status, to: newStatus }), now);

  return getProvider(db, providerId);
}
