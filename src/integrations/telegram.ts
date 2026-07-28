const MAX_REPORT = 4096;

export interface ReportInput {
  kind: string;
  id: string;
  status: string;
  detail?: string;
}

function clean(value: string): string {
  return value
    .replace(/(?:token|secret|password|api[_-]?key)\s*[=:]\s*[^\s]+/gi, '[REDACTED]')
    .split(/(\s+)/)
    .map((part) => {
      if (/^(?:[A-Za-z]:)?[\\/]/.test(part) || /^\.\.?[\\/]/.test(part) || /[\\/]/.test(part)) {
        return '[PATH_REDACTED]';
      }
      return part;
    })
    .join('');
}

export function formatTelegramReport(input: ReportInput): string {
  const text = `${clean(input.kind)} ${clean(input.id)}: ${clean(input.status)}${input.detail ? `\n${clean(input.detail)}` : ''}`;
  return text.length <= MAX_REPORT ? text : `${text.slice(0, MAX_REPORT - 1)}…`;
}
