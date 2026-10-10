import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ApiContract,
  CursorCodec,
  IdempotencyPolicy,
  InMemoryRateLimiter,
  PgCommandTransaction,
  PgIdempotencyStore,
  ephemeralCursorKey,
  parseCursorKeys,
} from '@pf/platform/api';
import type { ApiConfig } from '@pf/platform/config';
import type { Logger } from '@pf/platform/logging';
import type { ApiConventionsOptions } from '@pf/platform/nest';
import { systemClock, type Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';

/**
 * Contrato OpenAPI: en el repo se lee la fuente (`contracts/openapi`); en la imagen, la copia que deja el build en
 * `apps/api/contract/` (scripts/copy-contract.mjs).
 */
export function resolveContractPath(): string {
  const candidates = [
    new URL('../../../../contracts/openapi/finance-api.v1.yaml', import.meta.url),
    new URL('../../contract/finance-api.v1.yaml', import.meta.url),
  ].map((u) => fileURLToPath(u));
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`contrato OpenAPI no encontrado (${candidates.join(' | ')})`);
  return found;
}

export interface ApiConventionsOverrides {
  readonly contract?: ApiContract;
  readonly clock?: Clock;
}

/** Arma las convenciones de API (design §1) a partir de la configuración validada. */
export function createApiConventions(
  config: Pick<
    ApiConfig,
    | 'PFOS_ENV'
    | 'API_PROBLEM_TYPE_BASE'
    | 'IDEMPOTENCY_RETENTION'
    | 'CURSOR_SIGNING_KEY'
    | 'RATE_LIMIT_STORE'
    | 'RATE_LIMIT_READS_PER_MIN'
    | 'RATE_LIMIT_WRITES_PER_MIN'
    | 'RATE_LIMIT_COSTLY_PER_MIN'
  >,
  pool: Pool,
  logger: Logger,
  overrides: ApiConventionsOverrides = {},
): ApiConventionsOptions {
  if (config.RATE_LIMIT_STORE !== 'memory') {
    throw new Error(`RATE_LIMIT_STORE=${config.RATE_LIMIT_STORE} todavía no tiene adapter (solo memory)`);
  }
  const clock = overrides.clock ?? systemClock;
  const contract = overrides.contract ?? ApiContract.fromFile(resolveContractPath());
  let cursorKeys;
  if (config.CURSOR_SIGNING_KEY) {
    cursorKeys = parseCursorKeys(config.CURSOR_SIGNING_KEY);
  } else {
    logger.warn('CURSOR_SIGNING_KEY ausente: clave de cursores efímera (solo local/ci)');
    cursorKeys = [ephemeralCursorKey()];
  }
  return {
    contract,
    clock,
    problemTypeBase: config.API_PROBLEM_TYPE_BASE,
    idempotency: {
      policy: new IdempotencyPolicy(new PgIdempotencyStore(pool), clock, {
        retentionMs: config.IDEMPOTENCY_RETENTION,
      }),
      transaction: new PgCommandTransaction(pool),
    },
    cursors: new CursorCodec(cursorKeys),
    rateLimit: {
      limiter: new InMemoryRateLimiter(),
      reads: { name: 'reads', quota: config.RATE_LIMIT_READS_PER_MIN, windowSeconds: 60 },
      writes: { name: 'writes', quota: config.RATE_LIMIT_WRITES_PER_MIN, windowSeconds: 60 },
      costly: { name: 'costly', quota: config.RATE_LIMIT_COSTLY_PER_MIN, windowSeconds: 60 },
    },
  };
}
