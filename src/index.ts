#!/usr/bin/env node
import { startMcpServer } from './mcp/server.js';
import { createContext } from './core/context.js';

startMcpServer(createContext()).catch((err: unknown) => {
  console.error('HCO MCP server failed to start:', err);
  process.exit(1);
});
