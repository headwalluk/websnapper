/** Flags that take no value. Every other --flag takes the next token, or the text after "=". */
const BOOLEAN_FLAGS = new Set(['json', 'yes', 'dry-run', 'help', 'full']);

export interface ParsedArgs {
  words: string[];
  flags: Map<string, string | true>;
  problems: string[];
}

/** Splits argv into positional words and --flags. */
export function parseArgs(argv: string[]): ParsedArgs {
  const words: string[] = [];
  const flags = new Map<string, string | true>();
  const problems: string[] = [];
  let position = 0;
  while (position < argv.length) {
    const token = argv[position] ?? '';
    if (token.startsWith('--')) {
      const equalsAt = token.indexOf('=');
      const name = equalsAt === -1 ? token.slice(2) : token.slice(2, equalsAt);
      if (equalsAt !== -1) {
        flags.set(name, token.slice(equalsAt + 1));
      } else if (BOOLEAN_FLAGS.has(name)) {
        flags.set(name, true);
      } else if (position + 1 < argv.length && !(argv[position + 1] ?? '').startsWith('--')) {
        position += 1;
        flags.set(name, argv[position] ?? '');
      } else {
        problems.push(`--${name} needs a value.`);
      }
    } else {
      words.push(token);
    }
    position += 1;
  }
  return { words, flags, problems };
}

/** Returns a string flag value, or undefined when absent or given without a value. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

/** Returns true when a boolean flag is present. */
export function booleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}
