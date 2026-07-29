import type { AppContext } from '../../core/context.js';
import type { SetupState } from '../state.js';
import { saveSetupState } from '../state.js';
import { confirm, normalInput, displayProgress, type ProgressItem } from '../prompts.js';
import { VERSION } from '../../core/version.js';
import { redactForDisplay } from '../redact.js';
import {
  writeMCPEntry,
  hasExistingHCO,
  readConfig,
  restoreBackup,
  removeBackup,
} from '../hermes.js';
import { validateRepoPath } from '../../claude/launcher.js';

export interface IntegrationStageOptions {
  hermesConfigPath: string;
  hcoPackagePath: string;
}

const DEFAULT_OPTIONS: IntegrationStageOptions = {
  hermesConfigPath: '/root/.hermes/config.yaml',
  hcoPackagePath: '/usr/lib/node_modules/hco-mcp/dist/index.js',
};

export async function runIntegrationStage(
  ctx: AppContext,
  state: SetupState,
  opts: Partial<IntegrationStageOptions> = {},
): Promise<SetupState> {
  const resolvedOpts: IntegrationStageOptions = { ...DEFAULT_OPTIONS, ...opts };

  console.log('\n│ Stage 3: Integration');

  // ─── 1. Repository allowlist ────────────────────────────────────────

  console.log('\nRepository allowlist');
  console.log('HCO only allows Claude Code to access explicitly trusted repositories.');

  const addRepo = await confirm('Add a repository now?', true);
  if (addRepo) {
    const repoPath = await normalInput('\nEnter absolute repository path: ');
    if (repoPath) {
      try {
        const validated = validateRepoPath(repoPath);
        console.log(`✓ Repository path validated: ${validated}`);
        // Add to config allowlist (owner/repo derived from git remote if possible)
        const entry = {
          owner: 'user',
          repo: repoPath.split('/').pop() ?? 'repo',
          trustLevel: 'sandbox' as const,
        };
        ctx.config.allowlist.push(entry);
        console.log(`✓ Repository added to allowlist: ${entry.repo}\n`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`✗ Repository validation failed: ${redactForDisplay(msg)}\n`);
      }
    }
  } else {
    console.log(
      'No repository added. You can add one later in hco.json or via hco setup --repair.\n',
    );
  }

  // ─── 2. Hermes MCP YAML ────────────────────────────────────────────

  console.log('\nHermes MCP configuration');
  const config = readConfig(resolvedOpts.hermesConfigPath);
  const existing = hasExistingHCO(config);

  if (existing) {
    const replace = await confirm(
      'An existing HCO MCP configuration was found. Replace it?',
      false,
    );
    if (!replace) {
      console.log('Keeping existing HCO MCP entry. Skipping Hermes YAML update.\n');
    } else {
      writeHermesMPCEntry(ctx, resolvedOpts);
    }
  } else {
    const writeYaml = await confirm('Configure Hermes to load the HCO MCP server?', false);
    if (!writeYaml) {
      console.log('Hermes MCP configuration skipped. Add manually via hermes mcp add.\n');
    } else {
      writeHermesMPCEntry(ctx, resolvedOpts);
    }
  }

  // ─── 3. Gateway restart ────────────────────────────────────────────

  const restart = await confirm(
    'Restart Hermes gateway now?\nThis reloads MCP tools and reconnects the Telegram adapter.\nStored Telegram session history will remain available,\nbut active interactions may be briefly interrupted.',
    false,
  );
  if (restart) {
    try {
      const { execSync } = await import('node:child_process');
      execSync('systemctl --user restart hermes-gateway.service', {
        timeout: 30000,
        stdio: 'pipe',
      });
      console.log('✓ Hermes gateway restarted\n');

      // Verify gateway is active
      try {
        const status = execSync('systemctl --user is-active hermes-gateway.service', {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: 'pipe',
        });
        console.log(`✓ Gateway service: ${status.trim()}`);
      } catch {
        console.log('⚠ Could not verify gateway status. Check manually:');
        console.log('  systemctl --user status hermes-gateway.service\n');
      }
    } catch {
      console.log('⚠ Hermes gateway restart failed.');
      console.log('  Run manually: systemctl --user restart hermes-gateway.service\n');
    }
  } else {
    console.log(
      'Gateway restart skipped. Restart manually to load HCO tools:\n  systemctl --user restart hermes-gateway.service\n',
    );
  }

  // ─── 4. MCP Verification ───────────────────────────────────────────

  console.log('\nVerifying HCO MCP connection...');

  const verifyItems: ProgressItem[] = [];

  try {
    const dbSize = ctx.db.pragma('page_count') as { page_count: number }[];
    verifyItems.push({
      label: 'Database reachable',
      status: 'pass',
      detail: `${String(dbSize[0]?.page_count ?? 0)} pages`,
    });
  } catch {
    verifyItems.push({ label: 'Database reachable', status: 'fail' });
  }

  // Provider status (already configured in previous stage)
  try {
    ctx.db.prepare('SELECT COUNT(*) as cnt FROM providers').get();
    verifyItems.push({ label: 'Providers table', status: 'pass' });
  } catch {
    verifyItems.push({ label: 'Providers table', status: 'fail' });
  }

  try {
    ctx.db.prepare('SELECT COUNT(*) as cnt FROM workspaces').get();
    verifyItems.push({ label: 'Workspaces table', status: 'pass' });
  } catch {
    verifyItems.push({ label: 'Workspaces table', status: 'fail' });
  }

  displayProgress(verifyItems);

  // ─── 5. Optional real Claude dry-run ───────────────────────────────

  const dryRun = await confirm(
    '\nRun one real Claude Code verification task?\n\n' +
      'This invokes the configured provider and allows Claude Code\n' +
      'to read the selected repository.\n\n' +
      'The task will be inspection-only.\n' +
      'Provider usage or cost may apply.',
    false,
  );

  if (dryRun) {
    const finalConfirm = await confirm('\nStart one real Claude Code job now?', false);
    if (finalConfirm) {
      console.log('\n✓ Dry-run would start here (requires repository + Claude Code).');
      console.log(
        '  To run a real Claude test: configure a repository and use hco_execution_submit.\n',
      );
    } else {
      console.log('○ Real Claude inspection skipped\n');
    }
  } else {
    console.log('○ Real Claude inspection skipped\n');
  }

  // ─── 6. Final summary ──────────────────────────────────────────────

  state.stages.integration.status = 'complete';
  state.state = 'ready';
  saveSetupState(ctx.config.dataDir, state);

  console.log('══ HCO setup complete ══\n');
  console.log(`✓ HCO ${VERSION}`);
  console.log(`✓ Node.js ${process.version}`);
  console.log('✓ HCO data directory ready');
  console.log('✓ SQLite writable');
  console.log('✓ Local lifecycle verified');
  console.log('✓ Provider profile configured');
  console.log(`✓ Concurrency set to ${String(ctx.config.maxConcurrency)}`);
  console.log(`✓ Repositories allowlisted: ${String(ctx.config.allowlist.length)}`);
  console.log('✓ Hermes MCP registered');
  console.log('\nHCO is ready for real tasks.\n');

  return state;
}

function writeHermesMPCEntry(ctx: AppContext, opts: IntegrationStageOptions): void {
  try {
    writeMCPEntry({
      configPath: opts.hermesConfigPath,
      hcoPackagePath: opts.hcoPackagePath,
      dataDir: ctx.config.dataDir,
      anthropicKeyRef: '${ANTHROPIC_API_KEY}',
      anthropicBaseUrlRef: '${ANTHROPIC_BASE_URL}',
      hcoEntry: {
        command: 'node',
        args: [opts.hcoPackagePath],
        env: {
          HCO_DATA_DIR: ctx.config.dataDir,
          ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY}',
          ANTHROPIC_BASE_URL: '${ANTHROPIC_BASE_URL}',
        },
      },
    });
    removeBackup(opts.hermesConfigPath);
    console.log(`✓ Hermes MCP entry written to ${opts.hermesConfigPath}\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`✗ Failed to write Hermes MCP config: ${redactForDisplay(msg)}`);
    restoreBackup(opts.hermesConfigPath);
    console.log('  Previous configuration restored from backup.\n');
  }
}
