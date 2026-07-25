import Database from 'better-sqlite3';

// ─── Limits ─────────────────────────────────────────────────────────────────

export const ARTIFACT_LIMITS = {
  maxInlineBytes: 64 * 1024, // 64 KiB
  maxChunkBytes: 256 * 1024, // 256 KiB per row
  maxIndividualBytes: 10 * 1024 * 1024, // 10 MiB
  maxTotalPerExecutionBytes: 100 * 1024 * 1024, // 100 MiB
} as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ArtifactRow {
  id: number;
  artifactId: string;
  executionId: string;
  key: string;
  contentType: string;
  byteLength: number;
  chunkIndex: number;
  totalChunks: number;
  data: Buffer;
  createdAt: string;
}

export interface ArtifactMetadata {
  artifact_id: string;
  key: string;
  content_type: string;
  byte_length: number;
  chunks: number;
  created_at: string;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class ArtifactLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactLimitExceededError';
  }
}

// ─── Row mapping ────────────────────────────────────────────────────────────

function rowToArtifact(row: Record<string, unknown>): ArtifactRow {
  return {
    id: row.id as number,
    artifactId: row.artifact_id as string,
    executionId: row.execution_id as string,
    key: row.key as string,
    contentType: row.content_type as string,
    byteLength: row.byte_length as number,
    chunkIndex: row.chunk_index as number,
    totalChunks: row.total_chunks as number,
    data: row.data as Buffer,
    createdAt: row.created_at as string,
  };
}

function rowToMetadata(row: Record<string, unknown>): ArtifactMetadata {
  return {
    artifact_id: row.artifact_id as string,
    key: row.key as string,
    content_type: row.content_type as string,
    byte_length: row.byte_length as number,
    chunks: row.total_chunks as number,
    created_at: row.created_at as string,
  };
}

// ─── ArtifactStorage ────────────────────────────────────────────────────────

export class ArtifactStorage {
  constructor(private readonly db: Database.Database) {}

  store(
    executionId: string,
    artifactId: string,
    key: string,
    data: Buffer,
    contentType: string,
  ): void {
    const byteLength = data.length;

    if (byteLength > ARTIFACT_LIMITS.maxIndividualBytes) {
      throw new ArtifactLimitExceededError(
        `Artifact "${key}" is ${String(byteLength)} bytes (max ${String(ARTIFACT_LIMITS.maxIndividualBytes)})`,
      );
    }

    const currentTotal = this.getTotalBytes(executionId);
    if (currentTotal + byteLength > ARTIFACT_LIMITS.maxTotalPerExecutionBytes) {
      throw new ArtifactLimitExceededError(
        `Execution ${executionId} would exceed total artifact limit (${String(currentTotal)} + ${String(byteLength)} > ${String(ARTIFACT_LIMITS.maxTotalPerExecutionBytes)})`,
      );
    }

    const chunkSize = ARTIFACT_LIMITS.maxChunkBytes;
    const totalChunks = Math.ceil(byteLength / chunkSize);
    const now = dbNow();

    const insert = this.db.prepare(
      `INSERT INTO artifacts (artifact_id, execution_id, key, content_type, byte_length, chunk_index, total_chunks, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction(() => {
      for (let i = 0; i < totalChunks; i++) {
        const chunk = data.subarray(i * chunkSize, (i + 1) * chunkSize);
        insert.run(
          artifactId,
          executionId,
          key,
          contentType,
          byteLength,
          i,
          totalChunks,
          chunk,
          now,
        );
      }
    });

    tx();
  }

  retrieve(executionId: string, key: string): Buffer | null {
    const rows = this.db
      .prepare('SELECT * FROM artifacts WHERE execution_id = ? AND key = ? ORDER BY chunk_index')
      .all(executionId, key) as Record<string, unknown>[];

    if (rows.length === 0) return null;

    const artifacts = rows.map(rowToArtifact);
    const first = artifacts[0];
    if (artifacts.length === 1 && first?.totalChunks === 1) {
      return first.data;
    }

    return Buffer.concat(artifacts.map((a) => a.data));
  }

  listArtifacts(executionId: string): ArtifactMetadata[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT artifact_id, key, content_type, byte_length, total_chunks, created_at
         FROM artifacts
         WHERE execution_id = ? AND chunk_index = 0
         ORDER BY key`,
      )
      .all(executionId) as Record<string, unknown>[];

    return rows.map(rowToMetadata);
  }

  getTotalBytes(executionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(byte_length), 0) AS total
         FROM artifacts
         WHERE execution_id = ? AND chunk_index = 0`,
      )
      .get(executionId) as { total: number };

    return row.total;
  }

  deleteArtifactsByExecution(executionId: string): number {
    const result = this.db.prepare('DELETE FROM artifacts WHERE execution_id = ?').run(executionId);
    return result.changes;
  }
}

function dbNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
