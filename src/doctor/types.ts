export interface DoctorResult {
  pass: boolean;
  detail: string;
  duration_ms: number;
  severity: 'ok' | 'warning' | 'error';
}

export interface DoctorReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: DoctorResult[];
  summary: string;
  total_duration_ms: number;
}

export interface DoctorContext {
  db: import('better-sqlite3').Database;
  providerService: import('../provider/service.js').ProviderService;
}
