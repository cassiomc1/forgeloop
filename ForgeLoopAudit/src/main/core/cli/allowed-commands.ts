export const ALLOWED_CLI_COMMANDS = [
  'protocol-info',
  'task-list',
  'task-show',
  'status',
  'progress',
  'continuity',
  'next',
  'audit',
  'report',
  'policy-status',
] as const;

export type AllowedCliCommand = (typeof ALLOWED_CLI_COMMANDS)[number];

export function isAllowedCommand(command: string): command is AllowedCliCommand {
  return ALLOWED_CLI_COMMANDS.includes(command as AllowedCliCommand);
}