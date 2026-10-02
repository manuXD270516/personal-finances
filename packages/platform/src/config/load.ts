import type { z } from 'zod';
import { APP_VARIABLES, VARIABLES, type AppName, type VariableName } from './variables.js';

type Spec<N extends VariableName> = (typeof VARIABLES)[N];
type ValueOf<N extends VariableName> = Spec<N>['doc'] extends { readonly optional: true }
  ? z.output<Spec<N>['schema']> | undefined
  : z.output<Spec<N>['schema']>;

/** Configuración validada de un proceso: solo las variables que ese proceso declara en `APP_VARIABLES`. */
export type AppConfig<A extends AppName> = {
  readonly [N in (typeof APP_VARIABLES)[A][number]]: ValueOf<N>;
};

export type ApiConfig = AppConfig<'api'>;
export type WorkerConfig = AppConfig<'worker'>;
export type MigrateConfig = AppConfig<'migrate'>;
export type SeedConfig = AppConfig<'seed'>;
export type WebConfig = AppConfig<'web'>;

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface ConfigProblem {
  readonly variable: string;
  readonly reason: string;
}

/** Código de salida estándar para configuración inválida (sysexits `EX_CONFIG`, docs/19 §6.1). */
export const EX_CONFIG = 78;

export class ConfigError extends Error {
  constructor(
    readonly app: AppName,
    readonly problems: readonly ConfigProblem[],
  ) {
    super(
      `Configuración inválida para "${app}" (${problems.length} problema(s)):\n` +
        problems.map((p) => `  - ${p.variable}: ${p.reason}`).join('\n'),
    );
    this.name = 'ConfigError';
  }
}

/**
 * Valida el entorno contra el esquema del proceso y devuelve la configuración tipada.
 * Fail-fast: reúne TODOS los problemas antes de fallar y nunca incluye valores en el mensaje.
 */
export function loadConfig<A extends AppName>(app: A, env: EnvSource = process.env): AppConfig<A> {
  const names = APP_VARIABLES[app] as readonly VariableName[];
  const problems: ConfigProblem[] = [];
  const values: Record<string, unknown> = {};

  for (const name of names) {
    const { schema, doc } = VARIABLES[name] as { schema: z.ZodType; doc: Spec<VariableName>['doc'] };
    let raw = env[name];
    if (raw !== undefined && raw.trim() === '') raw = undefined;
    if (raw === undefined && 'default' in doc && doc.default !== undefined) raw = doc.default;
    if (raw === undefined) {
      if ('optional' in doc && doc.optional) {
        values[name] = undefined;
      } else {
        problems.push({ variable: name, reason: 'falta (obligatoria)' });
      }
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      values[name] = parsed.data;
    } else {
      const reason = parsed.error.issues.map((i) => i.message).join('; ');
      problems.push({ variable: name, reason: `valor inválido (${reason})` });
    }
  }

  // Reglas entre variables (toggles de dependencias, docs/19 §0.3 punto 6).
  if (names.includes('VALKEY_URL')) {
    const needsValkey = values['JOB_QUEUE_DRIVER'] === 'bullmq' || values['SESSION_STORE'] === 'valkey';
    if (
      needsValkey &&
      values['VALKEY_URL'] === undefined &&
      !problems.some((p) => p.variable === 'VALKEY_URL')
    ) {
      problems.push({
        variable: 'VALKEY_URL',
        reason: 'falta (obligatoria cuando JOB_QUEUE_DRIVER=bullmq o SESSION_STORE=valkey)',
      });
    }
  }

  if (problems.length > 0) throw new ConfigError(app, problems);
  return Object.freeze(values) as AppConfig<A>;
}

/**
 * Para los entrypoints: valida o termina el proceso con `EX_CONFIG` (78), escribiendo en stderr una línea
 * JSON que lista todas las variables con problemas (sin valores).
 */
export function loadConfigOrExit<A extends AppName>(app: A, env: EnvSource = process.env): AppConfig<A> {
  try {
    return loadConfig(app, env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(
        JSON.stringify({
          level: 'fatal',
          time: new Date().toISOString(),
          msg: 'invalid configuration',
          'process.role': app,
          problems: err.problems,
        }) + '\n',
      );
      process.stderr.write(err.message + '\n');
      process.exit(EX_CONFIG);
    }
    throw err;
  }
}

/** true durante `next build` (la configuración de runtime no existe en build: build once, docs/20 §7). */
export function isNextBuildPhase(env: EnvSource = process.env): boolean {
  return env['NEXT_PHASE'] === 'phase-production-build';
}
