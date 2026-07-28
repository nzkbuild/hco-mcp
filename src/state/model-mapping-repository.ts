import Database from 'better-sqlite3';
import type { HcoRole } from '../contract/model-mapping.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ModelMappingRow {
  id: number;
  mappingId: string;
  providerId: string;
  providerModelId: string;
  hcoRole: HcoRole;
  validated: number;
  createdAt: string;
}

// ─── Row mapping ────────────────────────────────────────────────────────────────

function rowToMapping(row: Record<string, unknown>): ModelMappingRow {
  return {
    id: row.id as number,
    mappingId: row.mapping_id as string,
    providerId: row.provider_id as string,
    providerModelId: row.provider_model_id as string,
    hcoRole: row.hco_role as HcoRole,
    validated: row.validated as number,
    createdAt: row.created_at as string,
  };
}

function dbNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ─── CRUD ───────────────────────────────────────────────────────────────────────

export function createModelMapping(
  db: Database.Database,
  mappingId: string,
  providerId: string,
  providerModelId: string,
  hcoRole: HcoRole,
): ModelMappingRow {
  const now = dbNow();
  db.prepare(
    `INSERT INTO model_mappings (mapping_id, provider_id, provider_model_id, hco_role, validated, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(mappingId, providerId, providerModelId, hcoRole, now);

  const row = db
    .prepare('SELECT * FROM model_mappings WHERE mapping_id = ?')
    .get(mappingId) as Record<string, unknown>;
  return rowToMapping(row);
}

export function listModelMappings(
  db: Database.Database,
  providerId: string,
): ModelMappingRow[] {
  const rows = db
    .prepare('SELECT * FROM model_mappings WHERE provider_id = ? ORDER BY created_at ASC')
    .all(providerId) as Record<string, unknown>[];
  return rows.map(rowToMapping);
}

export function updateMappingValidation(
  db: Database.Database,
  mappingId: string,
  validated: boolean,
): ModelMappingRow | null {
  db.prepare('UPDATE model_mappings SET validated = ? WHERE mapping_id = ?').run(
    validated ? 1 : 0,
    mappingId,
  );
  const row = db
    .prepare('SELECT * FROM model_mappings WHERE mapping_id = ?')
    .get(mappingId) as Record<string, unknown> | undefined;
  return row ? rowToMapping(row) : null;
}

export function deleteMappingsByProvider(
  db: Database.Database,
  providerId: string,
): number {
  const result = db.prepare('DELETE FROM model_mappings WHERE provider_id = ?').run(providerId);
  return result.changes;
}
