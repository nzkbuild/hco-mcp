import type { AppContext } from '../core/context.js';
import {
  loadSetupState,
  saveSetupState,
  firstIncompleteStage,
  allStagesComplete,
  isSetupIncomplete,
  createSetupState,
} from './state.js';
import type { SetupState, SetupPhase } from './state.js';
import { runLocalStage } from './stages/local.js';
import type { LocalStageOptions } from './stages/local.js';
import { runProviderStage } from './stages/provider.js';
import type { ProviderStageOptions } from './stages/provider.js';
import { runIntegrationStage } from './stages/integration.js';
import type { IntegrationStageOptions } from './stages/integration.js';
import { existsSync, unlinkSync } from 'node:fs';
import { confirm } from './prompts.js';
import { setupStatePath } from './state.js';
import { redactForDisplay } from './redact.js';

export interface SetupWizardOptions {
  local?: Partial<LocalStageOptions>;
  provider?: Partial<ProviderStageOptions>;
  integration?: Partial<IntegrationStageOptions>;
}

export async function runSetup(
  ctx: AppContext,
  opts: SetupWizardOptions = {},
): Promise<SetupState> {
  const dataDir = ctx.config.dataDir;
  let state = loadSetupState(dataDir);

  // If setup is already complete, report and exit
  if (!isSetupIncomplete(state)) {
    console.log('HCO setup is already complete.');
    console.log('Use `hco setup --status` to view current state.');
    return state;
  }

  // If partial setup exists, offer to resume
  if (state.state !== 'not_started') {
    console.log('An incomplete HCO setup was found.\n');
    console.log('Completed:');
    for (const phase of ['local', 'provider', 'integration'] as const) {
      const stage = state.stages[phase];
      if (stage.status === 'complete') {
        console.log(`  ✓ ${phase}`);
      }
    }
    console.log('');
    const resume = await confirm('Resume setup?', true);
    if (resume) {
      return runContinue(ctx, opts);
    }
    console.log('Starting fresh setup.\n');
    state = createSetupState();
    saveSetupState(dataDir, state);
  }

  // Run stages in order
  return runStages(ctx, state, opts);
}

export async function runContinue(
  ctx: AppContext,
  opts: SetupWizardOptions = {},
): Promise<SetupState> {
  const state = loadSetupState(ctx.config.dataDir);

  if (!isSetupIncomplete(state)) {
    console.log('Setup is already complete. Nothing to continue.');
    return state;
  }

  return runStages(ctx, state, opts);
}

async function runStages(
  ctx: AppContext,
  state: SetupState,
  opts: SetupWizardOptions,
): Promise<SetupState> {
  const next = firstIncompleteStage(state);
  if (!next) {
    if (allStagesComplete(state)) {
      const final = { ...state, state: 'ready' as const };
      saveSetupState(ctx.config.dataDir, final);
    }
    return state;
  }

  const runOrder: SetupPhase[] = ['local', 'provider', 'integration'];
  const startIndex = runOrder.indexOf(next);

  for (let i = startIndex; i < runOrder.length; i++) {
    const phase = runOrder[i];
    if (!phase) continue;
    if (state.stages[phase].status === 'complete') continue;

    try {
      let result: SetupState;
      switch (phase) {
        case 'local':
          result = await runLocalStage(ctx, state, opts.local);
          break;
        case 'provider':
          result = await runProviderStage(ctx, state, opts.provider);
          break;
        case 'integration':
          result = await runIntegrationStage(ctx, state, opts.integration);
          break;
        default:
          result = state;
      }
      state = result;

      const currentStatus = state.stages[phase].status;
      if (currentStatus !== 'complete') {
        console.log(`\nSetup paused after ${phase} stage. Continue with: hco setup --continue\n`);
        return state;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n✗ Setup failed during ${phase} stage: ${redactForDisplay(msg)}`);
      state.stages[phase] = { status: 'failed' };
      state.state = 'failed';
      saveSetupState(ctx.config.dataDir, state);
      return state;
    }
  }

  if (allStagesComplete(state)) {
    state.state = 'ready';
    saveSetupState(ctx.config.dataDir, state);
  }

  return state;
}

export function runStatus(ctx: AppContext): void {
  const state = loadSetupState(ctx.config.dataDir);

  console.log(`HCO Setup Status: ${state.state}\n`);

  const phases: SetupPhase[] = ['local', 'provider', 'integration'];
  for (const phase of phases) {
    const stage = state.stages[phase];
    const symbol = stage.status === 'complete' ? '✓' : stage.status === 'failed' ? '✗' : '○';
    console.log(`  ${symbol} ${phase}: ${stage.status}`);
  }

  console.log('');

  if (isSetupIncomplete(state)) {
    const nextPhase = firstIncompleteStage(state);
    if (nextPhase) {
      console.log(`Next: ${nextPhase} stage`);
      console.log('Action: hco setup --continue\n');
    }
  } else {
    console.log('Setup complete. HCO is ready.\n');
  }
}

export async function runRepair(ctx: AppContext): Promise<void> {
  console.log('HCO setup repair — inspecting current configuration...\n');

  try {
    ctx.db.pragma('journal_mode');
    console.log('✓ Database accessible');
  } catch {
    console.log('✗ Database not accessible');
  }

  const state = loadSetupState(ctx.config.dataDir);
  console.log(`Setup state: ${state.state}`);

  for (const phase of ['local', 'provider', 'integration'] as const) {
    const stage = state.stages[phase];
    console.log(`  ${phase}: ${stage.status}`);
  }

  const nextPhase = firstIncompleteStage(state);
  if (nextPhase) {
    console.log(`\nIncomplete stage: ${nextPhase}`);
    const fix = await confirm(`Repair ${nextPhase} stage now?`, false);
    if (fix) {
      await runContinue(ctx);
      return;
    }
  }

  console.log('\nNo repairable issues found.');
}

export function runReset(ctx: AppContext): void {
  const path = setupStatePath(ctx.config.dataDir);

  if (!existsSync(path)) {
    console.log('No setup state to reset.');
    return;
  }

  try {
    unlinkSync(path);
    console.log(`✓ Setup state deleted: ${path}`);
    console.log('Setup has been reset to not_started.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`✗ Failed to reset: ${msg}`);
  }
}
