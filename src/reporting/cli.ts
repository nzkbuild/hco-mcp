import { formatTelegramReport } from '../integrations/telegram.js';

export interface CliReportInput {
  kind: string;
  id: string;
  status: string;
  detail?: string;
}

export function formatCliReport(input: CliReportInput): string {
  return formatTelegramReport(input);
}
