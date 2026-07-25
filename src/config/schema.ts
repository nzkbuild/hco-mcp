import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Authority policy ──────────────────────────────────────────────────────────

export const AuthorityPolicy = z.object({
  mode: z.enum(['interactive', 'auto', 'locked']).default('interactive'),
  requireApprovals: z.boolean().default(false),
  allowedApprovers: z.array(z.string()).default([]),
});

export type AuthorityPolicy = z.infer<typeof AuthorityPolicy>;

// ─── Repository allowlist ──────────────────────────────────────────────────────

export const AllowlistEntry = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  trustLevel: z.enum(['sandbox', 'trusted', 'privileged']).default('sandbox'),
});

export type AllowlistEntry = z.infer<typeof AllowlistEntry>;

// ─── MCP transport ─────────────────────────────────────────────────────────────

export const McpTransport = z.enum(['stdio']);

// ─── Root config schema ────────────────────────────────────────────────────────

export const HcoConfig = z.object({
  /** HCO data directory for SQLite, logs, and runtime state */
  dataDir: z.string().default(resolve(process.env.HOME ?? '/var/lib', '.hco')),

  /** MCP transport: stdio only (H0A) */
  transport: McpTransport.default('stdio'),

  /** Repository allowlist — empty means no repositories allowed */
  allowlist: z.array(AllowlistEntry).default([]),

  /** Authority policy for interactive vs automated decisions */
  authority: AuthorityPolicy.default({}),

  /** Claude Code bridge configuration */
  claude: z
    .object({
      /** Path to the `claude` CLI binary */
      binaryPath: z.string().default('claude'),
      /** Environment variables allowed through to Claude Code process */
      allowedEnv: z.array(z.string()).default(['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']),
      /** Base directory for session output (stdout/stderr capture) */
      sessionDir: z.string().default('/tmp/hco-claude'),
      /** Default timeout in milliseconds for Claude Code sessions */
      defaultTimeoutMs: z.number().int().min(1000).max(3600000).default(300000),
    })
    .default({}),

  /** Log level */
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Maximum concurrent jobs */
  maxConcurrency: z.number().int().min(1).max(64).default(4),
});

export type HcoConfig = z.infer<typeof HcoConfig>;

// ─── Load and validate ─────────────────────────────────────────────────────────

export function loadConfig(path?: string): HcoConfig {
  const raw: Record<string, unknown> = {};

  // Try default locations
  const candidates = path
    ? [path]
    : [
        resolve(process.cwd(), 'hco.json'),
        resolve(process.env.HOME ?? '/root', '.hco', 'config.json'),
      ];

  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, 'utf-8');
      Object.assign(raw, JSON.parse(content) as Record<string, unknown>);
      break;
    } catch {
      // file not found, continue
    }
  }

  // Merge environment overrides
  if (process.env.HCO_DATA_DIR) raw.dataDir = process.env.HCO_DATA_DIR;
  if (process.env.HCO_TRANSPORT) raw.transport = process.env.HCO_TRANSPORT;
  if (process.env.HCO_LOG_LEVEL) raw.logLevel = process.env.HCO_LOG_LEVEL;

  return HcoConfig.parse(raw);
}

export const defaultConfig = (): HcoConfig => HcoConfig.parse({});
