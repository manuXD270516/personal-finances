import { loadConfig, type WebConfig } from '@pf/platform/config';
import { Pool } from 'pg';
import { Bff, type BffLogger } from './bff';
import { createOpenIdClient } from './oidc-client';
import { SessionCipher, parseSessionKeys } from './session-crypto';
import { PgSessionStore } from './session-store';

/**
 * Composición del BFF a partir del contrato de configuración (`loadConfig('web')`, sin `process.env` directo).
 * Un único `Bff` y un único pool `pf_bff` por proceso (perezosos: `next build` no los crea).
 */
interface Runtime {
  readonly bff: Bff;
  readonly pool: Pool;
}

const g = globalThis as unknown as { __pfosBff?: Runtime };

/** Logger JSON mínimo (una línea por evento, sin tokens ni cookies en los campos). */
export function jsonLogger(config: Pick<WebConfig, 'PFOS_ENV' | 'LOG_LEVEL'>): BffLogger {
  const write = (level: string, fields: Record<string, unknown>, msg: string) =>
    process.stderr.write(
      `${JSON.stringify({
        level,
        time: new Date().toISOString(),
        msg,
        'service.name': 'finance-web',
        'deployment.environment': config.PFOS_ENV,
        'process.role': 'web',
        ...fields,
      })}\n`,
    );
  return {
    warn: (fields, msg) => write('warn', fields, msg),
    error: (fields, msg) => write('error', fields, msg),
  };
}

export function createRuntime(config: WebConfig): Runtime {
  const pool = new Pool({
    connectionString: config.BFF_DATABASE_URL,
    max: 5,
    application_name: 'finance-web-bff',
  });
  const store = new PgSessionStore(pool, new SessionCipher(parseSessionKeys(config.BFF_SESSION_ENC_KEY)));
  const local = config.PFOS_ENV === 'local' || config.PFOS_ENV === 'ci';
  const oidc = createOpenIdClient({
    issuer: config.OIDC_ISSUER_URL!,
    ...(config.OIDC_DISCOVERY_URL ? { discoveryUrl: config.OIDC_DISCOVERY_URL } : {}),
    clientId: config.OIDC_CLIENT_ID,
    clientSecret: config.OIDC_CLIENT_SECRET,
    allowHttp: local,
  });
  const bff = new Bff({
    store,
    oidc,
    logger: jsonLogger(config),
    settings: {
      appOrigin: config.WEB_PUBLIC_URL,
      apiBaseUrl: config.FINANCE_API_URL,
      scope: config.OIDC_SCOPES,
      timeouts: { idleMs: config.SESSION_IDLE_TIMEOUT, absoluteMs: config.SESSION_ABSOLUTE_TIMEOUT },
    },
  });
  return { bff, pool };
}

function runtime(): Runtime {
  g.__pfosBff ??= createRuntime(loadConfig('web'));
  return g.__pfosBff;
}

export const getBff = (): Bff => runtime().bff;

/** Readiness: el almacén de sesiones responde (`SELECT 1` con el rol `pf_bff`). */
export async function pingSessionStore(): Promise<void> {
  await runtime().pool.query('SELECT 1');
}
