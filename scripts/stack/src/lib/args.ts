export interface ParsedArgs {
  readonly positionals: string[];
  /** Valores por opción (las repetibles, como `--profile`, acumulan). */
  readonly options: Map<string, string[]>;
  readonly flags: Set<string>;
}

/**
 * Parser mínimo y predecible para los scripts de `pnpm`. Acepta `--k=v`, `--k v` (si `k` está en `valued`),
 * flags booleanos y posicionales. Ignora el `--` separador que pnpm puede reenviar (`pnpm stack:up -- --profile core`).
 */
export function parseArgs(argv: readonly string[], valued: readonly string[] = []): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string[]>();
  const flags = new Set<string>();
  const add = (k: string, v: string) => options.set(k, [...(options.get(k) ?? []), v]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') continue;
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        add(body.slice(0, eq), body.slice(eq + 1));
      } else if (valued.includes(body) && i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
        add(body, argv[++i]!);
      } else {
        flags.add(body);
      }
    } else if (arg === '-y') {
      flags.add('yes');
    } else if (arg === '-f') {
      flags.add('follow');
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, options, flags };
}

export function option(args: ParsedArgs, name: string): string | undefined {
  const values = args.options.get(name);
  return values?.[values.length - 1];
}

/** `--profile a --profile b` o `--profile=a,b`. */
export function listOption(args: ParsedArgs, name: string): string[] {
  return (args.options.get(name) ?? [])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}
