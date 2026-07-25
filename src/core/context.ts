import Database from 'better-sqlite3';
import { openDb } from '../state/db.js';
import { loadConfig } from '../config/schema.js';
import type { HcoConfig } from '../config/schema.js';

/**
 * AppContext is the shared foundation used by the CLI, daemon, and MCP server.
 * It owns the configuration and database connection — every entrypoint gets
 * the same durable state without re-opening or re-loading independently.
 */
export interface AppContext {
  config: HcoConfig;
  db: Database.Database;
}

export function createContext(configPath?: string): AppContext {
  const config = loadConfig(configPath);
  const db = openDb(config.dataDir);
  return { config, db };
}

export function closeContext(ctx: AppContext): void {
  ctx.db.close();
}
