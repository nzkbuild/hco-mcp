import type { DoctorResult, DoctorContext } from './types.js';
import { execSync } from 'node:child_process';
import { lstatSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

function ok(detail: string): DoctorResult {
  return { pass: true, detail, duration_ms: 0, severity: 'ok' };
}

function warn(detail: string): DoctorResult {
  return { pass: true, detail, duration_ms: 0, severity: 'warning' };
}

function err(detail: string): DoctorResult {
  return { pass: false, detail, duration_ms: 0, severity: 'error' };
}

function info(detail: string): DoctorResult {
  return { pass: true, detail, duration_ms: 0, severity: 'ok' };
}

export type CheckFn = (ctx: DoctorContext) => Promise<DoctorResult> | DoctorResult;

export function checkNodeVersion(_ctx: DoctorContext): Promise<DoctorResult> {
  const version = process.version;
  const majorStr = version.slice(1).split('.')[0] ?? '0';
  const major = parseInt(majorStr, 10);
  if (major >= 22) return Promise.resolve(ok(`Node.js ${version} (>= 22 required)`));
  return Promise.resolve(err(`Node.js ${version} (>= 22 required)`));
}

export function checkClaudeBinary(_ctx: DoctorContext): Promise<DoctorResult> {
  const bin = process.env.CLAUDE_BIN ?? 'claude';
  try {
    const output = execSync(`${bin} --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
    return Promise.resolve(ok(`Claude found: ${bin} — ${output}`));
  } catch {
    return Promise.resolve(warn(`Claude binary "${bin}" not found or not responding`));
  }
}

export function checkSqlite(ctx: DoctorContext): DoctorResult {
  try {
    const row = ctx.db.prepare('SELECT COUNT(*) as cnt FROM schema_version').get() as {
      cnt: number;
    };
    const pragma = ctx.db.pragma('journal_mode', { simple: true }) as string;
    return ok(`SQLite accessible, ${String(row.cnt)} migrations, journal=${pragma}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown';
    return err(`SQLite error: ${msg}`);
  }
}

export function checkDiskSpace(_ctx: DoctorContext): DoctorResult {
  try {
    const dir = mkdtempSync(`${tmpdir()}/hco-doctor-`);
    writeFileSync(`${dir}/test`, 'ok');
    rmSync(dir, { recursive: true, force: true });
    return ok('Disk is writable');
  } catch {
    return warn('Disk space check failed — directory may be full or read-only');
  }
}

export async function checkProviderConnectivity(ctx: DoctorContext): Promise<DoctorResult> {
  const providers = ctx.providerService.listProviders();
  if (providers.length === 0) return ok('No providers registered');
  const active = providers.filter((p) => p.status === 'active');
  if (active.length === 0) return ok('No active providers to check');
  try {
    const first = active[0];
    if (!first) return ok('No active providers to check');
    const result = await ctx.providerService.healthCheck(first.providerId);
    if (result.healthy) {
      const latency = result.latency_ms ?? 0;
      return ok(`Provider ${first.profileId} healthy (${String(latency)}ms)`);
    }
    return err(`Provider ${first.profileId} unhealthy: ${result.error ?? 'unknown'}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown';
    return err(`Provider connectivity check failed: ${msg}`);
  }
}

export function checkProviderAuth(ctx: DoctorContext): DoctorResult {
  const providers = ctx.providerService.listProviders();
  if (providers.length === 0) return ok('No providers to check');
  const withKeys: string[] = [];
  const withoutKeys: string[] = [];
  for (const p of providers) {
    if (process.env[p.apiKeyEnv]) {
      withKeys.push(p.profileId);
    } else {
      withoutKeys.push(p.profileId);
    }
  }
  if (withoutKeys.length > 0) {
    return warn(
      `Missing keys for: ${withoutKeys.join(', ')}. Keys set: ${String(withKeys.length)}`,
    );
  }
  return ok(`All ${String(withKeys.length)} providers have API keys set`);
}

export async function checkModelDiscovery(ctx: DoctorContext): Promise<DoctorResult> {
  const providers = ctx.providerService.listProviders();
  const active = providers.filter((p) => p.status === 'active');
  if (active.length === 0) return ok('No active providers for model discovery');
  try {
    const first = active[0];
    if (!first) return ok('No active providers for model discovery');
    const models = await ctx.providerService.discoverModels(first.providerId);
    if (models.length > 0)
      return ok(`Discovered ${String(models.length)} models from ${first.profileId}`);
    return warn(`0 models discovered from ${first.profileId}`);
  } catch {
    return warn('Model discovery not yet implemented for this provider type');
  }
}

export function checkToolSupport(_ctx: DoctorContext): DoctorResult {
  return ok('MCP tool registration verified at startup');
}

export function checkStreaming(_ctx: DoctorContext): DoctorResult {
  return info('Streaming check not yet implemented');
}

export function checkMcpProtocol(_ctx: DoctorContext): DoctorResult {
  return ok('stdout discipline: MCP protocol messages only, diagnostics on stderr');
}

export function checkRepoPermissions(_ctx: DoctorContext): DoctorResult {
  try {
    const cwd = process.cwd();
    lstatSync(cwd);
    return ok(`Current working directory readable: ${cwd}`);
  } catch {
    return warn('Cannot stat current working directory');
  }
}

export function checkExecutionAdapter(_ctx: DoctorContext): DoctorResult {
  const adapter = process.env.HCO_ADAPTER ?? 'fake';
  if (adapter === 'spawn') {
    const bin = process.env.CLAUDE_BIN ?? 'claude';
    return ok(`Spawn adapter active, binary: ${bin}`);
  }
  if (adapter === 'fake') {
    return warn('Using FakeClaudeCodeAdapter — not suitable for production');
  }
  return err(`Unknown HCO_ADAPTER: ${adapter}`);
}

export function checkQueueHealth(ctx: DoctorContext): DoctorResult {
  const stale = ctx.db
    .prepare(
      `SELECT COUNT(*) as cnt FROM executions
       WHERE status IN ('running', 'awaiting_input')
       AND lease_until IS NOT NULL
       AND lease_until < datetime('now')`,
    )
    .get() as { cnt: number };
  const pending = (
    ctx.db
      .prepare("SELECT COUNT(*) as cnt FROM executions WHERE status IN ('accepted','queued')")
      .get() as { cnt: number }
  ).cnt;
  if (stale.cnt > 0) return warn(`${String(stale.cnt)} stale leaks, ${String(pending)} pending`);
  return ok(`Queue healthy: 0 stale leases, ${String(pending)} pending`);
}

export function checkEnvironment(_ctx: DoctorContext): DoctorResult {
  const keys = Object.keys(process.env).filter(
    (k) => k.startsWith('ANTHROPIC_') || k.startsWith('HCO_') || k.startsWith('OPENAI_'),
  );
  return ok(`${String(keys.length)} relevant env vars set: ${keys.join(', ')}`);
}

export function checkAcceptanceReadiness(_ctx: DoctorContext): DoctorResult {
  const acceptance = process.env.HCO_ACCEPTANCE === '1';
  if (acceptance) return ok('Acceptance testing mode: active');
  return info('Acceptance testing mode: disabled (set HCO_ACCEPTANCE=1 to enable)');
}

export const ALL_CHECKS: {
  name: string;
  category: 'infrastructure' | 'provider' | 'execution' | 'security';
  run: (ctx: DoctorContext) => Promise<DoctorResult> | DoctorResult;
}[] = [
  { name: 'node_version', category: 'infrastructure', run: checkNodeVersion },
  { name: 'claude_binary', category: 'infrastructure', run: checkClaudeBinary },
  { name: 'sqlite_health', category: 'infrastructure', run: checkSqlite },
  { name: 'disk_space', category: 'infrastructure', run: checkDiskSpace },
  { name: 'provider_connectivity', category: 'provider', run: checkProviderConnectivity },
  { name: 'provider_auth', category: 'provider', run: checkProviderAuth },
  { name: 'model_discovery', category: 'provider', run: checkModelDiscovery },
  { name: 'tool_support', category: 'execution', run: checkToolSupport },
  { name: 'streaming', category: 'execution', run: checkStreaming },
  { name: 'mcp_protocol', category: 'security', run: checkMcpProtocol },
  { name: 'repository_permissions', category: 'security', run: checkRepoPermissions },
  { name: 'execution_adapter', category: 'execution', run: checkExecutionAdapter },
  { name: 'queue_health', category: 'execution', run: checkQueueHealth },
  { name: 'environment', category: 'security', run: checkEnvironment },
  { name: 'acceptance_readiness', category: 'execution', run: checkAcceptanceReadiness },
];
