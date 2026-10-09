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

  // DEMO_DATA_ENABLED sin valor: habilitada solo en local/ci (docs/31 D41; add-demo-data).
  if (names.includes('DEMO_DATA_ENABLED') && values['DEMO_DATA_ENABLED'] === undefined) {
    values['DEMO_DATA_ENABLED'] = values['PFOS_ENV'] === 'local' || values['PFOS_ENV'] === 'ci';
  }

  // EMAIL_DRIVER sin valor: `smtp` en local/ci cuando hay SMTP_HOST (Mailpit); `none` en cualquier otro caso, en
  // particular en staging/production hasta elegir el proveedor de email (docs/33 D87).
  if (names.includes('EMAIL_DRIVER') && values['EMAIL_DRIVER'] === undefined) {
    const dev = values['PFOS_ENV'] === 'local' || values['PFOS_ENV'] === 'ci';
    values['EMAIL_DRIVER'] = dev && values['SMTP_HOST'] !== undefined ? 'smtp' : 'none';
  }
  if (names.includes('EMAIL_DRIVER') && values['EMAIL_DRIVER'] === 'smtp') {
    for (const name of ['SMTP_HOST', 'APP_PUBLIC_URL'] as const) {
      if (values[name] === undefined && !problems.some((p) => p.variable === name)) {
        problems.push({ variable: name, reason: 'falta (obligatoria cuando EMAIL_DRIVER=smtp)' });
      }
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

  const cloud = values['PFOS_ENV'] === 'staging' || values['PFOS_ENV'] === 'production';
  // finance-web: el BFF no funciona sin emisor OIDC ni almacén de sesiones (ADR-0010 enmienda).
  if (app === 'web') {
    for (const name of ['OIDC_ISSUER_URL', 'BFF_DATABASE_URL'] as const) {
      if (values[name] === undefined && !problems.some((p) => p.variable === name)) {
        problems.push({ variable: name, reason: 'falta (obligatoria en finance-web)' });
      }
    }
  }
  if (app === 'web' && values['BFF_DATABASE_URL'] !== undefined) {
    const user = decodeURIComponent(new URL(String(values['BFF_DATABASE_URL'])).username);
    if (user !== 'pf_bff') {
      problems.push({
        variable: 'BFF_DATABASE_URL',
        reason: 'debe usar el rol pf_bff (grants solo sobre iam.bff_session)',
      });
    }
  }
  // finance-worker: relay del outbox y consumidores corren como pf_worker (add-event-outbox design §4).
  if (app === 'worker' && values['WORKER_DATABASE_URL'] === undefined) {
    if (!problems.some((p) => p.variable === 'WORKER_DATABASE_URL')) {
      problems.push({ variable: 'WORKER_DATABASE_URL', reason: 'falta (obligatoria en finance-worker)' });
    }
  }
  if (names.includes('WORKER_DATABASE_URL') && values['WORKER_DATABASE_URL'] !== undefined) {
    const user = decodeURIComponent(new URL(String(values['WORKER_DATABASE_URL'])).username);
    if (user !== 'pf_worker') {
      problems.push({
        variable: 'WORKER_DATABASE_URL',
        reason: 'debe usar el rol pf_worker (relay del outbox sin BYPASSRLS)',
      });
    }
  }
  if (names.includes('OIDC_ISSUER_URL') && cloud && values['OIDC_ISSUER_URL'] === undefined) {
    if (!problems.some((p) => p.variable === 'OIDC_ISSUER_URL')) {
      problems.push({
        variable: 'OIDC_ISSUER_URL',
        reason: 'falta (obligatoria con PFOS_ENV=staging|production)',
      });
    }
  }
  // Perfil Cognito (add-workspace-identity design §3): sin `aud`, el cliente se valida por `client_id`.
  if (
    names.includes('OIDC_PROFILE') &&
    values['OIDC_PROFILE'] === 'cognito' &&
    values['OIDC_AUTHORIZED_PARTIES'] === undefined &&
    !problems.some((p) => p.variable === 'OIDC_AUTHORIZED_PARTIES')
  ) {
    problems.push({
      variable: 'OIDC_AUTHORIZED_PARTIES',
      reason: 'falta (obligatoria con OIDC_PROFILE=cognito: client_id autorizados)',
    });
  }
  if (names.includes('AUDIT_IP_HMAC_KEY') && cloud && values['AUDIT_IP_HMAC_KEY'] === undefined) {
    if (!problems.some((p) => p.variable === 'AUDIT_IP_HMAC_KEY')) {
      problems.push({
        variable: 'AUDIT_IP_HMAC_KEY',
        reason: 'falta (obligatoria con PFOS_ENV=staging|production)',
      });
    }
  }
  if (names.includes('EXPORT_ENCRYPTION_KEYS')) {
    const rawKeys = values['EXPORT_ENCRYPTION_KEYS'];
    if (cloud && rawKeys === undefined && !problems.some((p) => p.variable === 'EXPORT_ENCRYPTION_KEYS')) {
      problems.push({
        variable: 'EXPORT_ENCRYPTION_KEYS',
        reason: 'falta (obligatoria con PFOS_ENV=staging|production)',
      });
    }
    if (typeof rawKeys === 'string') {
      const ids = rawKeys.split(',').map((entry) => entry.slice(0, entry.indexOf(':')));
      if (new Set(ids).size !== ids.length) {
        problems.push({ variable: 'EXPORT_ENCRYPTION_KEYS', reason: 'identificadores de clave repetidos' });
      }
      const active = values['EXPORT_ENCRYPTION_ACTIVE_KEY_ID'];
      if (typeof active === 'string' && !ids.includes(active)) {
        problems.push({
          variable: 'EXPORT_ENCRYPTION_ACTIVE_KEY_ID',
          reason: 'no figura en EXPORT_ENCRYPTION_KEYS',
        });
      }
    } else if (values['EXPORT_ENCRYPTION_ACTIVE_KEY_ID'] !== undefined) {
      problems.push({
        variable: 'EXPORT_ENCRYPTION_ACTIVE_KEY_ID',
        reason: 'requiere EXPORT_ENCRYPTION_KEYS',
      });
    }
  }
  if (names.includes('CURSOR_SIGNING_KEY') && cloud && values['CURSOR_SIGNING_KEY'] === undefined) {
    if (!problems.some((p) => p.variable === 'CURSOR_SIGNING_KEY')) {
      problems.push({
        variable: 'CURSOR_SIGNING_KEY',
        reason: 'falta (obligatoria con PFOS_ENV=staging|production)',
      });
    }
  }
  if (
    names.includes('RATE_LIMIT_STORE') &&
    values['RATE_LIMIT_STORE'] === 'valkey' &&
    values['VALKEY_URL'] === undefined &&
    !problems.some((p) => p.variable === 'VALKEY_URL')
  ) {
    problems.push({ variable: 'VALKEY_URL', reason: 'falta (obligatoria cuando RATE_LIMIT_STORE=valkey)' });
  }

  // Comportamientos solo de desarrollo se rechazan fuera de local/ci (docs/19 §6.1).
  if (
    values['OBJECT_STORAGE_ENSURE_BUCKET'] === true &&
    (values['PFOS_ENV'] === 'staging' || values['PFOS_ENV'] === 'production')
  ) {
    problems.push({
      variable: 'OBJECT_STORAGE_ENSURE_BUCKET',
      reason: 'solo se permite con PFOS_ENV=local|ci (en cloud el bucket lo crea la IaC)',
    });
  }

  // Providers de tasas simulados (pruebas E2E): una URL alternativa de provider solo se acepta en local/ci.
  for (const name of ['FX_PROVIDER_PARALELO_BO_URL', 'FX_PROVIDER_DOLARAPI_BO_URL'] as const) {
    if (names.includes(name) && cloud && values[name] !== undefined) {
      problems.push({
        variable: name,
        reason: 'solo se permite con PFOS_ENV=local|ci (providers simulados)',
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

/** `DEMO_DATA_ENABLED` efectivo (ya resuelto por `loadConfig`; el fallback cubre configuraciones armadas a mano). */
export function demoDataEnabled(config: {
  readonly PFOS_ENV: string;
  readonly DEMO_DATA_ENABLED?: boolean | undefined;
}): boolean {
  return config.DEMO_DATA_ENABLED ?? (config.PFOS_ENV === 'local' || config.PFOS_ENV === 'ci');
}
