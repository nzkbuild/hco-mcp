import type { AppContext } from '../../core/context.js';
import type { SetupState } from '../state.js';
import { saveSetupState } from '../state.js';
import {
  confirm,
  hiddenInput,
  normalInput,
  readEnvCredentials,
  selectFromList,
} from '../prompts.js';
import { redactForDisplay } from '../redact.js';
import { ProviderService } from '../../provider/service.js';
import type { ModelInfoV1 } from '../../contract/model-info.js';
import { AnthropicProviderAdapter } from '../../provider/anthropic-adapter.js';

export interface ProviderStageOptions {
  envDir: string;
  envFile: string;
  dropInDir: string;
  dropInFile: string;
}

const DEFAULT_OPTIONS: ProviderStageOptions = {
  envDir: '/root/.config/hermes',
  envFile: '/root/.config/hermes/hco.env',
  dropInDir: '/root/.config/systemd/user/hermes-gateway.service.d',
  dropInFile: '/root/.config/systemd/user/hermes-gateway.service.d/hco-env.conf',
};

export async function runProviderStage(
  ctx: AppContext,
  state: SetupState,
  opts: Partial<ProviderStageOptions> = {},
): Promise<SetupState> {
  const resolvedOpts: ProviderStageOptions = { ...DEFAULT_OPTIONS, ...opts };

  console.log('\n│ Stage 2: Provider configuration');

  // ─── 1. Credential input ────────────────────────────────────────────

  let apiKey: string;
  let resolvedBaseUrl: string;

  const tty = process.stdout.isTTY && process.stdin.isTTY;

  if (tty) {
    apiKey = await hiddenInput('\nEnter Anthropic API key: ');
    if (!apiKey) {
      console.log('No API key provided.');
      state.stages.provider.status = 'failed';
      state.state = 'failed';
      saveSetupState(ctx.config.dataDir, state);
      return state;
    }

    console.log('API key accepted. It will be stored only in the protected environment file.\n');
    const baseUrl = await normalInput('Enter API base URL [https://api.anthropic.com]: ');
    resolvedBaseUrl = baseUrl || 'https://api.anthropic.com';
  } else {
    const envCreds = readEnvCredentials();

    if (!envCreds.apiKey) {
      console.log(
        'Set ANTHROPIC_API_KEY in the environment or run setup from an interactive terminal.',
      );
      state.stages.provider.status = 'failed';
      state.state = 'failed';
      saveSetupState(ctx.config.dataDir, state);
      return state;
    }

    apiKey = envCreds.apiKey;
    resolvedBaseUrl = envCreds.baseUrl ?? 'https://api.anthropic.com';
    console.log('Credentials loaded from environment.');
  }

  // ─── 2. Write hco.env ──────────────────────────────────────────────

  const envWrite = await confirm(
    'Store Claude provider credential in protected systemd environment file?',
    false,
  );
  if (!envWrite) {
    console.log('Credential storage declined. Provider configuration skipped.');
    state.stages.provider.status = 'skipped';
    saveSetupState(ctx.config.dataDir, state);
    return state;
  }

  // Import hermes functions dynamically to avoid circular deps
  const { createEnvFile } = await import('../hermes.js');
  createEnvFile({
    envDir: resolvedOpts.envDir,
    envFile: resolvedOpts.envFile,
    apiKey,
    baseUrl: resolvedBaseUrl,
  });
  console.log(`✓ Credentials stored in ${resolvedOpts.envFile}\n`);

  // ─── 3. Install systemd drop-in ────────────────────────────────────

  const dropInConfirm = await confirm('Install HCO environment drop-in for Hermes gateway?', false);
  if (!dropInConfirm) {
    console.log('Systemd drop-in skipped. You will need to configure environment manually.');
  } else {
    const { installDropIn } = await import('../hermes.js');
    installDropIn({
      dropInDir: resolvedOpts.dropInDir,
      dropInFile: resolvedOpts.dropInFile,
      envFilePath: resolvedOpts.envFile,
    });
    console.log(`✓ Systemd drop-in installed at ${resolvedOpts.dropInFile}\n`);

    // daemon-reload
    const reloadConfirm = await confirm('Run systemctl --user daemon-reload?', true);
    if (reloadConfirm) {
      try {
        const { execSync } = await import('node:child_process');
        execSync('systemctl --user daemon-reload', { timeout: 10000, stdio: 'pipe' });
        console.log('✓ systemctl daemon-reload completed\n');
      } catch {
        console.log('⚠ Could not run daemon-reload. You may need to run it manually.\n');
      }
    }
  }

  // ─── 4. Hermes MCP YAML ────────────────────────────────────────────

  const writesFromHermesStage = await confirm(
    'Write Hermes MCP server entry with ${ANTHROPIC_API_KEY} and ${ANTHROPIC_BASE_URL} references?',
    false,
  );
  if (!writesFromHermesStage) {
    console.log('Hermes MCP configuration skipped. Provider setup will continue with what exists.');
  } else {
    console.log('✓ Hermes MCP YAML will be written in integration stage.\n');
  }

  // ─── 5. Register provider ──────────────────────────────────────────

  console.log('\nRegistering provider profile...');
  const providerService = new ProviderService(ctx.db);

  const profile = {
    schema_version: 1 as const,
    profile_id: 'claude-primary',
    provider: 'anthropic' as const,
    api_key_env: 'ANTHROPIC_API_KEY',
    base_url_env: 'ANTHROPIC_BASE_URL',
  };

  let providerRow;
  try {
    providerRow = providerService.register(profile);
  } catch {
    console.log('⚠ Provider registration failed. Check existing configuration.');
    state.stages.provider.status = 'failed';
    state.state = 'failed';
    saveSetupState(ctx.config.dataDir, state);
    return state;
  }

  console.log(`✓ Provider registered: ${providerRow.providerId}\n`);

  // ─── 6. Validate provider ──────────────────────────────────────────

  const validateConfirm = await confirm('This sends one provider API request. Continue?', false);
  if (!validateConfirm) {
    console.log('Provider validation deferred. Run `hco setup --continue` to resume.');
    saveSetupState(ctx.config.dataDir, state);
    return state;
  }

  // Temporarily set env for validation
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevUrl = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_API_KEY = apiKey;
  process.env.ANTHROPIC_BASE_URL = resolvedBaseUrl;

  let validationResult;
  try {
    validationResult = await new AnthropicProviderAdapter().validate(profile);
  } finally {
    if (prevKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = prevKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    if (prevUrl !== undefined) {
      process.env.ANTHROPIC_BASE_URL = prevUrl;
    } else {
      delete process.env.ANTHROPIC_BASE_URL;
    }
  }

  if (!validationResult.valid) {
    console.log(
      `\n✗ Provider validation failed: ${redactForDisplay(validationResult.error ?? 'Unknown error')}`,
    );
    console.log('\nNo repository was accessed.');
    console.log('No Claude job was started.');
    console.log('Check the base URL and credential, then retry.\n');

    state.stages.provider.status = 'failed';
    state.state = 'failed';
    saveSetupState(ctx.config.dataDir, state);
    return state;
  }

  console.log('✓ Provider credentials accepted');
  console.log('✓ Endpoint reachable\n');

  // ─── 7. Discover models ────────────────────────────────────────────

  console.log('Discovering models...');
  let models: ModelInfoV1[] = [];
  try {
    process.env.ANTHROPIC_API_KEY = apiKey;
    process.env.ANTHROPIC_BASE_URL = resolvedBaseUrl;
    models = await new AnthropicProviderAdapter().discoverModels(profile);
  } catch {
    models = [];
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
  }

  if (models.length === 0) {
    console.log('⚠ No models discovered. Check provider configuration.');
    state.stages.provider.status = 'failed';
    state.state = 'failed';
    saveSetupState(ctx.config.dataDir, state);
    return state;
  }

  console.log(`✓ Models discovered: ${String(models.length)}\n`);

  // ─── 8. Model selection ────────────────────────────────────────────

  // Default model ordering: sonnet first, then opus, haiku, others
  const sortedModels = [...models].sort((a, b) => {
    const order = ['sonnet', 'opus', 'haiku', 'fable'];
    const aIdx = order.findIndex((o) => a.model_id.toLowerCase().includes(o));
    const bIdx = order.findIndex((o) => b.model_id.toLowerCase().includes(o));
    const aRank = aIdx === -1 ? 99 : aIdx;
    const bRank = bIdx === -1 ? 99 : bIdx;
    return aRank - bRank;
  });

  const selectOptions = sortedModels.map((m) => ({
    label: m.display_name || m.model_id,
    value: m.model_id,
    description: m.display_name ? m.model_id : '',
  }));

  const selectedModel = await selectFromList('Available Claude models', selectOptions, 0);

  console.log(`\nSelected: ${selectedModel}\n`);

  // ─── 9. Recommend and activate mappings ────────────────────────────

  // Build ModelInfoV1 stubs for the selected model
  const modelStubs: ModelInfoV1[] = [
    {
      model_id: selectedModel,
      display_name:
        sortedModels.find((m) => m.model_id === selectedModel)?.display_name ?? selectedModel,
      provider: 'anthropic',
      capabilities: [],
    },
  ];

  const mappings = providerService.recommendMappings(providerRow.providerId, modelStubs);
  if (mappings.length === 0) {
    console.log('⚠ Could not create model mapping.');
    state.stages.provider.status = 'failed';
    state.state = 'failed';
    saveSetupState(ctx.config.dataDir, state);
    return state;
  }

  const mappingIds = mappings.map((m) => m.mapping_id);
  const activated = providerService.activate(providerRow.providerId, mappingIds);
  console.log(
    `✓ Model activated: ${selectedModel} (${String(activated.activated.length)} mapping(s))\n`,
  );

  // ─── 10. Concurrency ───────────────────────────────────────────────

  const concurrencyInput = await normalInput(
    `Maximum concurrent Claude jobs [${String(ctx.config.maxConcurrency)}]: `,
  );
  if (concurrencyInput) {
    const parsed = parseInt(concurrencyInput, 10);
    if (parsed > 0) {
      ctx.config.maxConcurrency = parsed;
      console.log(`Concurrency set to ${String(parsed)}`);
      if (parsed > 1) {
        console.log('⚠ Concurrency > 1 may cause rate limiting or provider cost spikes.');
      }
    }
  }

  state.stages.provider.status = 'complete';
  state.state = 'provider_configured';
  saveSetupState(ctx.config.dataDir, state);

  console.log('✓ Provider configuration complete\n');
  return state;
}
