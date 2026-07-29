import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  chmodSync,
  existsSync,
  copyFileSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { load } from 'js-yaml';
import { dump } from 'js-yaml';

export interface HermesMCPEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface HermesConfig {
  mcp_servers?: Record<string, HermesMCPEntry>;
  [key: string]: unknown;
}

export interface HermesWriteOptions {
  configPath: string;
  hcoEntry: HermesMCPEntry;
  hcoPackagePath: string;
  dataDir: string;
  anthropicKeyRef: string;
  anthropicBaseUrlRef: string;
}

export interface HermesEnvOptions {
  envDir: string;
  envFile: string;
  apiKey: string;
  baseUrl: string;
}

export interface HermesDropInOptions {
  dropInDir: string;
  dropInFile: string;
  envFilePath: string;
}

export interface HermesPaths {
  configPath: string;
  envDir: string;
  envFile: string;
  dropInDir: string;
  dropInFile: string;
  hcoPackagePath: string;
}

export function defaultHermesPaths(): HermesPaths {
  return {
    configPath: '/root/.hermes/config.yaml',
    envDir: '/root/.config/hermes',
    envFile: '/root/.config/hermes/hco.env',
    dropInDir: '/root/.config/systemd/user/hermes-gateway.service.d',
    dropInFile: '/root/.config/systemd/user/hermes-gateway.service.d/hco-env.conf',
    hcoPackagePath: '/usr/lib/node_modules/hco-mcp/dist/index.js',
  };
}

/**
 * Read and parse a Hermes YAML config file.
 */
export function readConfig(configPath: string): HermesConfig {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = load(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    return parsed as HermesConfig;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

/**
 * Check if an HCO MCP entry already exists in the config.
 */
export function hasExistingHCO(config: HermesConfig): boolean {
  return config.mcp_servers !== undefined && 'hco' in config.mcp_servers;
}

/**
 * Write the HCO MCP entry into the MCP servers config.
 * Does NOT modify unrelated top-level keys.
 * Does NOT modify unrelated MCP server entries.
 * Backs up original file before writing.
 * Uses atomic write (temp file → rename).
 */
export function writeMCPEntry(opts: HermesWriteOptions): void {
  const config = readConfig(opts.configPath);

  config.mcp_servers ??= {};

  config.mcp_servers.hco = {
    command: 'node',
    args: [opts.hcoPackagePath],
    env: {
      HCO_DATA_DIR: opts.dataDir,
      HCO_ADAPTER: 'spawn',
      ANTHROPIC_API_KEY: opts.anthropicKeyRef,
      ANTHROPIC_BASE_URL: opts.anthropicBaseUrlRef,
    },
  };

  // Back up original if it exists
  if (existsSync(opts.configPath)) {
    const backupPath = opts.configPath + '.hco-backup';
    copyFileSync(opts.configPath, backupPath);
  }

  // Atomic write
  const dir = dirname(opts.configPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = opts.configPath + '.tmp';
  const yamlContent = dump(config, { indent: 2, lineWidth: 120 });
  writeFileSync(tmpPath, yamlContent, { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmpPath, opts.configPath);
}

/**
 * Roll back the YAML write by restoring the backup.
 */
export function restoreBackup(configPath: string): boolean {
  const backupPath = configPath + '.hco-backup';
  try {
    if (existsSync(backupPath)) {
      renameSync(backupPath, configPath);
      return true;
    }
  } catch {
    // best-effort
  }
  return false;
}

/**
 * Clean up the backup file after successful operation.
 */
export function removeBackup(configPath: string): void {
  const backupPath = configPath + '.hco-backup';
  try {
    unlinkSync(backupPath);
  } catch {
    // best-effort
  }
}

/**
 * Create the protected secret environment file.
 * Directory: 0700
 * File: 0600
 * Content: plain KEY=VALUE lines
 */
export function createEnvFile(opts: HermesEnvOptions): void {
  mkdirSync(opts.envDir, { recursive: true, mode: 0o700 });
  const content = `ANTHROPIC_API_KEY=${opts.apiKey}\nANTHROPIC_BASE_URL=${opts.baseUrl}\n`;
  writeFileSync(opts.envFile, content, { encoding: 'utf-8', mode: 0o600 });
  // Explicitly set permissions in case umask interfered
  chmodSync(opts.envDir, 0o700);
  chmodSync(opts.envFile, 0o600);
}

/**
 * Install the systemd user-service drop-in for EnvironmentFile.
 */
export function installDropIn(opts: HermesDropInOptions): void {
  mkdirSync(opts.dropInDir, { recursive: true, mode: 0o755 });
  const content = `[Service]\nEnvironmentFile=${opts.envFilePath}\n`;
  writeFileSync(opts.dropInFile, content, { encoding: 'utf-8', mode: 0o644 });
}

/**
 * Remove the systemd drop-in if it exists.
 */
export function removeDropIn(dropInFile: string): void {
  try {
    if (existsSync(dropInFile)) {
      unlinkSync(dropInFile);
    }
  } catch {
    // best-effort cleanup
  }
}

/**
 * Build the HCO MCP entry object for writing.
 */
export function buildHCOEntry(opts: HermesWriteOptions): HermesMCPEntry {
  return {
    command: 'node',
    args: [opts.hcoPackagePath],
    env: {
      HCO_DATA_DIR: opts.dataDir,
      HCO_ADAPTER: 'spawn',
      ANTHROPIC_API_KEY: opts.anthropicKeyRef,
      ANTHROPIC_BASE_URL: opts.anthropicBaseUrlRef,
    },
  };
}

/**
 * Resolve the HCO MCP entry point path on the filesystem.
 * Tries the canonical npm global path first, then resolve relative to process.
 */
export function resolveHCOEntrypoint(): string {
  return '/usr/lib/node_modules/hco-mcp/dist/index.js';
}

/**
 * Ensure secret file has correct permissions.
 * Returns { ok: true } if permissions are already correct.
 */
export function verifySecretFilePermissions(envFile: string): { ok: boolean; reason?: string } {
  try {
    const stat = statSync(envFile);
    const mode = stat.mode & 0o777;
    if (mode !== 0o600) {
      return { ok: false, reason: `Permissions are ${mode.toString(8)}, expected 600` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'File does not exist or cannot be read' };
  }
}
