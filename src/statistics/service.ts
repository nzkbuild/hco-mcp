import type Database from 'better-sqlite3';

export interface ExecutionStats {
  period: string;
  total_executions: number;
  completed: number;
  failed: number;
  cancelled: number;
  timed_out: number;
  awaiting_input: number;
  running: number;
  queued: number;
  success_rate: number | undefined;
  avg_duration_ms: number | undefined;
}

export interface QueueStats {
  accepted: number;
  queued: number;
  running: number;
  awaiting_input: number;
  oldest_pending_age_seconds: number | undefined;
}

export interface ProviderStats {
  provider_id: string;
  profile_id: string;
  status: string;
  execution_count: number;
  success_count: number;
}

export class StatisticsService {
  constructor(private readonly db: Database.Database) {}

  getOverview(): ExecutionStats {
    const counts = this.db
      .prepare('SELECT status, COUNT(*) as cnt FROM executions GROUP BY status')
      .all() as { status: string; cnt: number }[];

    const map: Record<string, number> = {};
    for (const { status, cnt } of counts) {
      map[status] = cnt;
    }

    const completed = map.completed ?? 0;
    const failed = map.failed ?? 0;
    const cancelled = map.cancelled ?? 0;
    const timedOut = map.timed_out ?? 0;
    const total = completed + failed + cancelled + timedOut + (map.accepted ?? 0) + (map.queued ?? 0) + (map.running ?? 0) + (map.awaiting_input ?? 0) + (map.archived ?? 0);

    const terminal = completed + failed + timedOut;
    const successRate = terminal > 0 ? completed / terminal : undefined;

    const avgDuration = this.db
      .prepare(
        'SELECT AVG((julianday(updated_at) - julianday(created_at)) * 86400000) as avg_ms FROM executions WHERE status IN (\'completed\',\'failed\',\'timed_out\')',
      )
      .get() as { avg_ms: number | null };

    return {
      period: 'all',
      total_executions: total,
      completed,
      failed,
      cancelled,
      timed_out: timedOut,
      awaiting_input: map.awaiting_input ?? 0,
      running: map.running ?? 0,
      queued: map.queued ?? 0,
      success_rate: successRate,
      avg_duration_ms: avgDuration.avg_ms ? Math.round(avgDuration.avg_ms) : undefined,
    };
  }

  getQueueHealth(): QueueStats {
    const counts = this.db
      .prepare(
        `SELECT status, COUNT(*) as cnt FROM executions
         WHERE status IN ('accepted', 'queued', 'running', 'awaiting_input')
         GROUP BY status`,
      )
      .all() as { status: string; cnt: number }[];

    const map: Record<string, number> = {};
    for (const { status, cnt } of counts) {
      map[status] = cnt;
    }

    const oldest = this.db
      .prepare(
        "SELECT (julianday('now') - julianday(created_at)) * 86400 as age_seconds FROM executions WHERE status IN ('accepted','queued') ORDER BY created_at ASC LIMIT 1",
      )
      .get() as { age_seconds: number | null } | undefined;

    return {
      accepted: map.accepted ?? 0,
      queued: map.queued ?? 0,
      running: map.running ?? 0,
      awaiting_input: map.awaiting_input ?? 0,
      oldest_pending_age_seconds: oldest?.age_seconds ? Math.round(oldest.age_seconds) : undefined,
    };
  }

  getProviderHealth(): ProviderStats[] {
    return this.db
      .prepare(
        `SELECT p.provider_id, p.profile_id, p.status,
                COUNT(e.id) as execution_count,
                SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) as success_count
         FROM providers p
         LEFT JOIN executions e ON 1=0
         GROUP BY p.provider_id, p.profile_id, p.status
         ORDER BY p.created_at DESC`,
      )
      .all() as ProviderStats[];
  }

  getTimeline(): { date: string; count: number; completed: number; failed: number }[] {
    return this.db
      .prepare(
        `SELECT date(created_at) as date,
                COUNT(*) as count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status IN ('failed','timed_out') THEN 1 ELSE 0 END) as failed
         FROM executions
         GROUP BY date(created_at)
         ORDER BY date DESC
         LIMIT 30`,
      )
      .all() as { date: string; count: number; completed: number; failed: number }[];
  }
}
