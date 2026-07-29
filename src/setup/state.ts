import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export type StageStatus = 'pending' | 'complete' | 'failed' | 'skipped';
export type SetupPhase = 'local' | 'provider' | 'integration';
export type SetupStateValue =
  | 'not_started'
  | 'local_verified'
  | 'provider_configured'
  | 'hermes_connected'
  | 'ready'
  | 'failed';

export interface SetupStages {
  local: { status: StageStatus };
  provider: { status: StageStatus };
  integration: { status: StageStatus };
}

export interface SetupState {
  version: 1;
  state: SetupStateValue;
  stages: SetupStages;
}

export function freshStages(): SetupStages {
  return {
    local: { status: 'pending' },
    provider: { status: 'pending' },
    integration: { status: 'pending' },
  };
}

export function createSetupState(): SetupState {
  return { version: 1, state: 'not_started', stages: freshStages() };
}

export function setupStatePath(dataDir: string): string {
  return resolve(dataDir, 'setup-state.json');
}

export function loadSetupState(dataDir: string): SetupState {
  const path = setupStatePath(dataDir);
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.version !== 'number' || parsed.version !== 1) {
      return createSetupState();
    }
    return parsed as unknown as SetupState;
  } catch {
    return createSetupState();
  }
}

export function saveSetupState(dataDir: string, state: SetupState): void {
  const path = setupStatePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export function firstIncompleteStage(state: SetupState): SetupPhase | null {
  const order: SetupPhase[] = ['local', 'provider', 'integration'];
  for (const phase of order) {
    const s = state.stages[phase];
    if (s.status === 'pending' || s.status === 'failed') {
      return phase;
    }
  }
  return null;
}

export function allStagesComplete(state: SetupState): boolean {
  return (
    state.stages.local.status === 'complete' &&
    state.stages.provider.status === 'complete' &&
    state.stages.integration.status === 'complete'
  );
}

export function isSetupIncomplete(state: SetupState): boolean {
  return (
    state.state === 'not_started' ||
    state.state === 'local_verified' ||
    state.state === 'provider_configured' ||
    state.state === 'failed' ||
    state.stages.local.status !== 'complete' ||
    state.stages.provider.status !== 'complete' ||
    state.stages.integration.status !== 'complete'
  );
}
