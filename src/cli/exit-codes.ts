/** Documented exit codes for every command. List them in docs/cli.md. */
export const ExitCode = {
  success: 0,
  failure: 1,
  usage: 2,
  invalidConfig: 3,
  refused: 4,
  notReady: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
