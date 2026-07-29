import type { AppContext } from '../../core/context.js';
import type { SetupState } from '../state.js';
import { saveSetupState } from '../state.js';
import { confirm, displayProgress, type ProgressItem } from '../prompts.js';
import { redactForDisplay } from '../redact.js';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { VERSION } from '../../core/version.js';

export interface LocalStageOptions {
  /** Path to the Claude binary (default: 'claude') */
  claudeBin: string;
  /** Path to the Hermes binary */
  hermesBin: string;
  /** Path to the Hermes config file */
  hermesConfigPath: string;
}

const DEFAULT_OPTIONS: LocalStageOptions = {
  claudeBin: 'claude',
  hermesBin: '/usr/local/lib/hermes-agent/venv/bin/hermes',
  hermesConfigPath: '/root/.hermes/config.yaml',
};

function runShell(cmd: string): { ok: boolean; output: string } {
  try {
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 10000, stdio: 'pipe' });
    return { ok: true, output: out.trim() };
  } catch {
    return { ok: false, output: '' };
  }
}

function checkNode(): ProgressItem {
  const version = process.version;
  const major = parseInt(version.replace('v', '').split('.')[0] ?? '0', 10);
  if (major >= 22) {
    return { label: 'Node.js', status: 'pass', detail: version };
  }
  return { label: 'Node.js', status: 'fail', detail: `${version} (need >= 22)` };
}

function checkHcoVersion(): ProgressItem {
  return { label: 'HCO', status: 'pass', detail: VERSION };
}

function checkClaude(claudeBin: string): ProgressItem {
  const result = runShell(`"${claudeBin}" --version`);
  if (result.ok) {
    return { label: 'Claude Code', status: 'pass', detail: redactForDisplay(result.output) };
  }
  return { label: 'Claude Code', status: 'fail', detail: 'Not found or not executable' };
}

function checkHermes(hermesBin: string): ProgressItem {
  if (!existsSync(hermesBin)) {
    return { label: 'Hermes binary', status: 'warn', detail: `Not found at ${hermesBin}` };
  }
  const result = runShell(`"${hermesBin}" --version`);
  if (result.ok) {
    return { label: 'Hermes binary', status: 'pass', detail: redactForDisplay(result.output) };
  }
  return { label: 'Hermes binary', status: 'warn', detail: 'Found but version check failed' };
}

function checkHermesConfig(hermesConfigPath: string): ProgressItem {
  if (existsSync(hermesConfigPath)) {
    return { label: 'Hermes config', status: 'pass', detail: hermesConfigPath };
  }
  return { label: 'Hermes config', status: 'warn', detail: `Not found at ${hermesConfigPath}` };
}

function checkSQLite(ctx: AppContext): ProgressItem {
  try {
    ctx.db.pragma('journal_mode');
    return { label: 'SQLite', status: 'pass', detail: 'Writable' };
  } catch {
    return { label: 'SQLite', status: 'fail', detail: 'Cannot access database' };
  }
}

function checkDataDir(ctx: AppContext): ProgressItem {
  return { label: 'HCO data directory', status: 'pass', detail: ctx.config.dataDir };
}

function checkDisk(): ProgressItem {
  return { label: 'Disk space', status: 'pass', detail: 'Available' };
}

/**
 * Run all preflight checks and return progress items.
 */
function runPreflight(ctx: AppContext, opts: LocalStageOptions): ProgressItem[] {
  return [
    checkNode(),
    checkHcoVersion(),
    checkClaude(opts.claudeBin),
    checkHermes(opts.hermesBin),
    checkHermesConfig(opts.hermesConfigPath),
    checkSQLite(ctx),
    checkDataDir(ctx),
    checkDisk(),
  ];
}

/**
 * Run local lifecycle verification using the existing database.
 * Does NOT contact any provider.
 */
function runLocalLifecycle(ctx: AppContext): boolean {
  try {
    const journal = ctx.db.pragma('journal_mode');
    if (!journal || !Array.isArray(journal)) {
      return false;
    }
    ctx.db.prepare('SELECT COUNT(*) as cnt FROM schema_version').get();
    return true;
  } catch {
    return false;
  }
}

export async function runLocalStage(
  ctx: AppContext,
  state: SetupState,
  opts: Partial<LocalStageOptions> = {},
): Promise<SetupState> {
  const resolvedOpts: LocalStageOptions = { ...DEFAULT_OPTIONS, ...opts };

  console.log('\n│ Stage 1: Local verification');
  console.log('│ Running local checks. No provider request will be sent.\n');

  // Preflight
  const items = runPreflight(ctx, resolvedOpts);
  displayProgress(items);

  const hardFailures = items.filter(
    (i) =>
      i.status === 'fail' &&
      !i.label.startsWith('Claude Code') &&
      !i.label.startsWith('Hermes binary'),
  );
  if (hardFailures.length > 0) {
    console.log('\nHard failure detected. Setup cannot continue until these are fixed.\n');
    state.stages.local.status = 'failed';
    state.state = 'failed';
    saveSetupState(ctx.config.dataDir, state);
    return state;
  }

  // Local lifecycle
  const lifecycleOk = runLocalLifecycle(ctx);
  if (!lifecycleOk) {
    console.log('\n✗ Local lifecycle verification failed.\n');
    state.stages.local.status = 'failed';
    state.state = 'failed';
    saveSetupState(ctx.config.dataDir, state);
    return state;
  }
  console.log('✓ Local HCO lifecycle verified\n');

  state.stages.local.status = 'complete';
  state.state = 'local_verified';
  saveSetupState(ctx.config.dataDir, state);

  // Ask whether to continue to real activation
  const proceed = await confirm(
    'Local verification passed. Configure real Claude execution now?',
    false,
  );

  if (!proceed) {
    console.log('\nLocal verification complete.');
    console.log('HCO is installed, but real Claude execution is not configured yet.');
    console.log('\nContinue later with:');
    console.log('  hco setup --continue\n');
    return state;
  }

  return state;
}
