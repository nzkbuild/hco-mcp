// ─── Stdio discipline ──────────────────────────────────────────────────────────
// stdout = MCP protocol ONLY
// stderr = diagnostic logs

let stdoutWritten = false;

export function logError(message: string): void {
  process.stderr.write(`[HCO] ${message}\n`);
}

export function logInfo(message: string): void {
  process.stderr.write(`[HCO] ${message}\n`);
}

export function logDebug(message: string): void {
  process.stderr.write(`[HCO] ${message}\n`);
}

export function markStdoutWritten(): void {
  stdoutWritten = true;
}

export function isStdoutClean(): boolean {
  return !stdoutWritten;
}
