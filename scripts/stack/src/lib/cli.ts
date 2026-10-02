import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { CommandError } from './compose.js';

export const log = (msg: string): void => {
  process.stdout.write(`[pfos] ${msg}\n`);
};
export const warn = (msg: string): void => {
  process.stderr.write(`[pfos] ${msg}\n`);
};

/** Error de uso / precondición: mensaje claro y código de salida explícito (sin stack). */
export class UsageError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Confirmación de acciones destructivas: `--yes` obligatorio sin TTY (CI), SPIKE-08 §6.7. */
export async function confirm(question: string, yes: boolean): Promise<void> {
  if (yes) return;
  if (!stdin.isTTY) throw new UsageError(`${question} — sin terminal interactiva: añade --yes`, 2);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes' && answer !== 's' && answer !== 'si' && answer !== 'sí') {
      throw new UsageError('cancelado', 1);
    }
  } finally {
    rl.close();
  }
}

/** Ejecuta el `main` de un script y traduce errores a códigos de salida, igual en PowerShell y Git Bash. */
export function runMain(main: () => Promise<number | void>): void {
  main().then(
    (code) => {
      process.exitCode = code ?? 0;
    },
    (err: unknown) => {
      if (err instanceof UsageError) {
        warn(err.message);
        process.exitCode = err.exitCode;
      } else if (err instanceof CommandError) {
        warn(err.message);
        if (err.result.stderr) process.stderr.write(err.result.stderr);
        process.exitCode = err.result.code || 1;
      } else {
        warn(err instanceof Error ? (err.stack ?? err.message) : String(err));
        process.exitCode = 1;
      }
    },
  );
}

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
