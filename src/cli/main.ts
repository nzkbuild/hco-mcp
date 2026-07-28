import type { AppContext } from '../core/context.js';
import { createContext } from '../core/context.js';
import type Database from 'better-sqlite3';

function requireDb(ctx: AppContext): Database.Database {
  return ctx.db;
}

function formatJob(row: {
  external_id: string;
  kind: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}): string {
  const lines: string[] = [
    `  ${row.external_id}`,
    `    kind:    ${row.kind}`,
    `    status:  ${row.status}`,
    `    created: ${row.created_at}`,
  ];
  if (row.started_at) {
    lines.push(`    started: ${row.started_at}`);
  }
  if (row.finished_at) {
    lines.push(`   finished: ${row.finished_at}`);
  }
  return lines.join('\n');
}

function cmdStatus(ctx: AppContext): void {
  console.log('HCO 0.1.0 — H0B operational foundation');

  const db = requireDb(ctx);

  const jobCounts = db
    .prepare('SELECT status, COUNT(*) AS count FROM jobs GROUP BY status')
    .all() as { status: string; count: number }[];

  const milestoneCounts = db
    .prepare('SELECT status, COUNT(*) AS count FROM milestones GROUP BY status')
    .all() as { status: string; count: number }[];

  const sessionCount = (
    db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }
  ).count;

  console.log(`\n  Data dir:     ${ctx.config.dataDir}`);
  console.log(`  Transport:    ${ctx.config.transport}`);
  console.log(`  Allowlist:    ${String(ctx.config.allowlist.length)} repos`);
  console.log(`  Concurrency:  ${String(ctx.config.maxConcurrency)}`);

  console.log('\n  Jobs:');
  if (jobCounts.length === 0) {
    console.log('    (none)');
  } else {
    for (const jc of jobCounts) {
      console.log(`    ${jc.status}: ${String(jc.count)}`);
    }
  }

  console.log('\n  Milestones:');
  if (milestoneCounts.length === 0) {
    console.log('    (none)');
  } else {
    for (const mc of milestoneCounts) {
      console.log(`    ${mc.status}: ${String(mc.count)}`);
    }
  }

  console.log(`\n  Sessions: ${String(sessionCount)}`);

  console.log('\n  Foundation ready. Operational. Daemon-managed lifecycle active.');
}

function cmdJobs(ctx: AppContext): void {
  const db = requireDb(ctx);
  const rows = db
    .prepare(
      'SELECT external_id, kind, status, created_at, started_at, finished_at FROM jobs ORDER BY id DESC',
    )
    .all() as {
    external_id: string;
    kind: string;
    status: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
  }[];

  if (rows.length === 0) {
    console.log('No jobs recorded.');
    return;
  }

  for (const row of rows) {
    console.log(formatJob(row));
  }
}

function cmdInspect(ctx: AppContext, jobId: string): void {
  const db = requireDb(ctx);
  const job = db.prepare('SELECT * FROM jobs WHERE external_id = ?').get(jobId) as
    Record<string, unknown> | undefined;

  if (!job) {
    console.log(`Job "${jobId}" not found.`);
    process.exitCode = 1;
    return;
  }

  const j = job;
  console.log(`Job: ${String(j.external_id)}`);
  console.log(`  ID:          ${String(j.id)}`);
  console.log(`  Kind:        ${String(j.kind)}`);
  console.log(`  Status:      ${String(j.status)}`);
  const milestone = typeof j.milestone_id === 'string' ? j.milestone_id : '(none)';
  console.log(`  Milestone:   ${milestone}`);

  const validations = db
    .prepare('SELECT kind, status, summary FROM validations WHERE job_id = ?')
    .all(j.id) as { kind: string; status: string; summary: string }[];

  if (validations.length > 0) {
    console.log('  Validations:');
    for (const v of validations) {
      console.log(`    ${v.kind}: ${v.status} — ${v.summary}`);
    }
  }

  const prs = db
    .prepare('SELECT number, title, state, url FROM pull_requests WHERE job_id = ?')
    .all(j.id) as { number: number | null; title: string; state: string; url: string }[];

  if (prs.length > 0) {
    console.log('  Pull Requests:');
    for (const pr of prs) {
      const prNum = pr.number != null ? `#${String(pr.number)}` : '#?';
      console.log(`${prNum} ${pr.title} [${pr.state}] ${pr.url}`);
    }
  }

  const approvals = db
    .prepare('SELECT approver, decision, reason FROM approvals WHERE job_id = ?')
    .all(j.id) as { approver: string; decision: string; reason: string }[];

  if (approvals.length > 0) {
    console.log('  Approvals:');
    for (const a of approvals) {
      console.log(`    ${a.approver}: ${a.decision} — ${a.reason}`);
    }
  }
}

function cmdPause(ctx: AppContext, jobId: string): void {
  const db = requireDb(ctx);
  const result = db
    .prepare(
      "UPDATE jobs SET status = 'paused', updated_at = datetime('now') WHERE external_id = ? AND status = 'running'",
    )
    .run(jobId);

  if (result.changes === 0) {
    console.log(`Job "${jobId}" is not running or not found.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Job "${jobId}" paused.`);
}

function cmdResume(ctx: AppContext, jobId: string): void {
  const db = requireDb(ctx);
  const result = db
    .prepare(
      "UPDATE jobs SET status = 'pending', updated_at = datetime('now') WHERE external_id = ? AND status = 'paused'",
    )
    .run(jobId);

  if (result.changes === 0) {
    console.log(`Job "${jobId}" is not paused or not found.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Job "${jobId}" resumed (pending).`);
}

function cmdRecover(ctx: AppContext): void {
  const db = requireDb(ctx);

  const result = db
    .prepare(
      "UPDATE jobs SET status = 'pending', updated_at = datetime('now') WHERE status = 'running'",
    )
    .run();

  console.log(`Recovered ${String(result.changes)} running job(s) → pending.`);

  const valResult = db
    .prepare(
      "UPDATE validations SET status = 'error', summary = 'Recovered after restart', finished_at = datetime('now') WHERE status = 'running'",
    )
    .run();

  if (valResult.changes > 0) {
    console.log(`Marked ${String(valResult.changes)} running validation(s) as error.`);
  }
}

export function runCli(argv: string[]): void;
export function runCli(ctx: AppContext, argv: string[]): void;
export function runCli(ctxOrArgv: AppContext | string[], argv?: string[]): void {
  let ctx: AppContext;
  let args: string[];

  if (Array.isArray(ctxOrArgv)) {
    ctx = createContext();
    argv = ctxOrArgv;
    args = argv.slice(2);
  } else {
    ctx = ctxOrArgv;
    args = (argv ?? []).slice(2);
  }

  if (args.length === 0) {
    console.log('Usage: hco <command>');
    console.log('Commands: status, jobs, inspect, pause, resume, recover');
    console.log('Run "hco help" for details.');
    return;
  }

  const command = args[0] ?? '';

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      console.log('HCO 0.1.0 — H0B operational foundation');
      console.log();
      console.log('Commands:');
      console.log('  hco status         Show HCO status and summary');
      console.log('  hco jobs           List recorded jobs');
      console.log('  hco inspect <job>  Show full job details');
      console.log('  hco pause <job>    Pause a running job');
      console.log('  hco resume <job>   Resume a paused job');
      console.log('  hco recover        Reset stuck running jobs');
      break;

    case 'status':
      cmdStatus(ctx);
      break;

    case 'jobs':
      cmdJobs(ctx);
      break;

    case 'inspect':
      if (!args[1]) {
        console.log('Usage: hco inspect <job-id>');
        process.exitCode = 1;
        return;
      }
      cmdInspect(ctx, args[1]);
      break;

    case 'pause':
      if (!args[1]) {
        console.log('Usage: hco pause <job-id>');
        process.exitCode = 1;
        return;
      }
      cmdPause(ctx, args[1]);
      break;

    case 'resume':
      if (!args[1]) {
        console.log('Usage: hco resume <job-id>');
        process.exitCode = 1;
        return;
      }
      cmdResume(ctx, args[1]);
      break;

    case 'recover':
      cmdRecover(ctx);
      break;

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Run "hco help" for available commands.');
      process.exitCode = 1;
  }
}

function isMain(meta: ImportMeta): boolean {
  return (
    meta.url === `file://${String(process.argv[1])}` ||
    (process.argv[1]?.replaceAll('\\', '/').endsWith('/cli/main.js') ?? false)
  );
}

if (isMain(import.meta)) {
  runCli(process.argv);
}
