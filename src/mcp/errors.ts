// ─── MCP error codes ──────────────────────────────────────────────────────────

export const ErrorCode = {
  UNKNOWN_SESSION: 'UNKNOWN_SESSION',
  INVALID_LIFECYCLE: 'INVALID_LIFECYCLE',
  INVALID_REPO: 'INVALID_REPO',
  REPO_NOT_ALLOWED: 'REPO_NOT_ALLOWED',
  TIMEOUT: 'TIMEOUT',
  SPAWN_FAILED: 'SPAWN_FAILED',
  LAUNCHER_UNAVAILABLE: 'LAUNCHER_UNAVAILABLE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─── Sanitized error response ──────────────────────────────────────────────────

export interface McpErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export interface McpSuccessResponse<T = unknown> {
  data: T;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function error(code: ErrorCode, message: string): McpErrorResponse {
  return { error: { code, message } };
}

export function success<T>(data: T): McpSuccessResponse<T> {
  return { data };
}

// ─── Sanitization ──────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /\b(sk-ant-[a-zA-Z0-9_-]{20,})\b/g,
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,
  /\b(api[-_]?key[=:]\s*["']?[a-zA-Z0-9_-]{8,})/gi,
  /\b(AKIA[A-Z0-9]{16})\b/g,
  /\b(auth[=:]\s*["']?[a-zA-Z0-9_-]{8,})/gi,
  /\b(Bearer\s+[a-zA-Z0-9._-]{20,})\b/g,
];

export function sanitize(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

// ─── Sanitized error factory ───────────────────────────────────────────────────

export function sanitizedError(code: ErrorCode, message: string): McpErrorResponse {
  return error(code, sanitize(message));
}
