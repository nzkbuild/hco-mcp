/**
 * Credential sanitization for setup output.
 *
 * KEY LIFETIME:
 *   Raw API keys exist in only three places:
 *   1. stdin buffer during hidden input (~seconds, in process memory only)
 *   2. /root/.config/hermes/hco.env (mode 0600, persistent)
 *   3. systemd EnvironmentFile block for hermes-gateway.service (process memory)
 *
 *   Keys are NEVER written to:
 *   - setup-state.json
 *   - SQLite (hco.db)
 *   - Hermes /root/.hermes/config.yaml (only ${ANTHROPIC_API_KEY} references)
 *   - ProviderProfileV1 or provider metadata (only env var names)
 *   - Logs, stdout, stderr, or error messages
 *
 * Reuses the existing sanitize() from src/mcp/errors.ts and extends it
 * with setup-specific patterns.
 */
import { sanitize } from '../mcp/errors.js';

const SETUP_PATTERNS = [
  // Environment-file lines containing secrets
  /ANTHROPIC_API_KEY=.*/gi,
  /ANTHROPIC_BASE_URL=.*/gi,
  // Any line that looks like an env file secret assignment
  /^(export\s+)?[A-Z_]+(KEY|SECRET|TOKEN|PASSWORD)=.+/gim,
];

export function redact(text: string): string {
  let result = sanitize(text);
  for (const pattern of SETUP_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function redactForDisplay(text: string): string {
  const redacted = redact(text);
  if (redacted !== text) {
    return redacted;
  }
  return text;
}
