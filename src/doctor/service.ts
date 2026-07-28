import type { DoctorContext, DoctorReport, DoctorResult } from './types.js';
import { ALL_CHECKS } from './checks.js';

export class DoctorService {
  constructor(private readonly ctx: DoctorContext) {}

  async runAll(category?: string): Promise<DoctorReport> {
    const start = Date.now();
    let checks = ALL_CHECKS;

    if (category) {
      checks = checks.filter((c) => c.category === category);
    }

    const results: DoctorResult[] = [];
    for (const check of checks) {
      const checkStart = Date.now();
      try {
        const result = await check.run(this.ctx);
        result.duration_ms = Date.now() - checkStart;
        results.push(result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        results.push({
          pass: false,
          detail: `Check threw: ${msg}`,
          duration_ms: Date.now() - checkStart,
          severity: 'error',
        });
      }
    }

    const errors = results.filter((r) => r.severity === 'error').length;
    const warnings = results.filter((r) => r.severity === 'warning').length;
    const okCount = results.length - errors - warnings;
    const totalDuration = Date.now() - start;

    let status: DoctorReport['status'];
    if (errors > 0 || results.some((r) => !r.pass)) {
      status = 'unhealthy';
    } else if (warnings > 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      checks: results,
      summary: `${String(results.length)} checks, ${String(errors)} errors, ${String(warnings)} warnings, ${String(okCount)} ok`,
      total_duration_ms: totalDuration,
    };
  }
}
