import { readFileSync } from 'node:fs';
import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ApiContract } from '../contract/api-contract.js';
import { ERROR_CATALOG, ErrorCatalog, isErrorCode } from './error-catalog.js';
import {
  ApiProblem,
  DependencyUnavailableError,
  concurrencyConflict,
  isDependencyUnavailable,
  preconditionFailed,
  renderProblem,
} from './problem.js';

const CONTRACT_PATH = new URL('../../../../../contracts/openapi/finance-api.v1.yaml', import.meta.url);

/** Estados documentados en el contrato junto a cada código (`- CODE  # 409 …`, docs/10 §9.1). */
function contractStatuses(): Map<string, number> {
  const text = readFileSync(CONTRACT_PATH, 'utf8');
  const map = new Map<string, number>();
  for (const m of text.matchAll(/^\s+- ([A-Z][A-Z0-9_]*)\s+# (\d{3})/gm))
    map.set(m[1] as string, Number(m[2]));
  return map;
}

/** Diferencias entre el catálogo de código y el del contrato (función reutilizada con fixtures). */
export function compareWithContract(
  catalog: Record<string, { status: number }>,
  contractCodes: readonly string[],
  statuses: Map<string, number>,
) {
  const codes = Object.keys(catalog);
  return {
    missingInContract: codes.filter((c) => !contractCodes.includes(c)),
    missingInCatalog: contractCodes.filter((c) => !codes.includes(c)),
    statusMismatch: codes.filter((c) => statuses.has(c) && statuses.get(c) !== catalog[c]?.status),
  };
}

describe('catálogo de códigos de error (platform/api-conventions)', () => {
  const contract = ApiContract.fromFile(CONTRACT_PATH.pathname.replace(/^\/([A-Za-z]:)/, '$1'));

  it('[TC-PLATFORM-API-005] el ErrorCatalog y el ErrorCode del contrato tienen los mismos códigos y estados HTTP', () => {
    const diff = compareWithContract(ERROR_CATALOG, contract.errorCodes(), contractStatuses());
    expect(diff).toEqual({ missingInContract: [], missingInCatalog: [], statusMismatch: [] });
    expect(ErrorCatalog.codes()).toHaveLength(contract.errorCodes().length);
  });

  it('[TC-PLATFORM-API-005] un código nuevo sin entrada en el contrato hace fallar la comparación nombrándolo', () => {
    const fixture = { ...ERROR_CATALOG, NUEVO_CODIGO: { status: 422, title: 'x' } };
    expect(compareWithContract(fixture, contract.errorCodes(), contractStatuses()).missingInContract).toEqual(
      ['NUEVO_CODIGO'],
    );
    const wrongStatus = { ...ERROR_CATALOG, PERIOD_CLOSED: { status: 422, title: 'x' } };
    expect(
      compareWithContract(wrongStatus, contract.errorCodes(), contractStatuses()).statusMismatch,
    ).toEqual(['PERIOD_CLOSED']);
  });

  it('[TC-PLATFORM-API-004] type estable desde la base configurada y código en kebab-case', () => {
    expect(ErrorCatalog.typeUri('PERIOD_CLOSED')).toBe('https://pfos.dev/problems/period-closed');
    expect(ErrorCatalog.typeUri('PERIOD_CLOSED', 'https://example.test/p')).toBe(
      'https://example.test/p/period-closed',
    );
    expect(ErrorCatalog.get('NOPE')).toBeUndefined();
    expect(ErrorCatalog.get('RATE_LIMITED')).toEqual({
      code: 'RATE_LIMITED',
      status: 429,
      title: 'Rate limit exceeded',
    });
    expect(isErrorCode('INTERNAL_ERROR')).toBe(true);
    expect(ErrorCatalog.entries()).toHaveLength(ErrorCatalog.codes().length);
  });

  it('[TC-PLATFORM-API-004] un DomainError se renderiza con code, requestId y errors[] con JSON Pointer', () => {
    const err = new DomainError('AMOUNT_SCALE_EXCEEDED', 'BOB allows 2 decimals; got 3').at(
      '/splits/0/amount',
    );
    const { response, unexpected } = renderProblem(err, { requestId: 'req-1', instance: '/api/v1/x' });
    expect(unexpected).toBe(false);
    expect(response.status).toBe(422);
    expect(response.headers['content-type']).toBe('application/problem+json');
    expect(response.body).toEqual({
      type: 'https://pfos.dev/problems/amount-scale-exceeded',
      title: 'Amount has more decimals than the currency allows',
      status: 422,
      code: 'AMOUNT_SCALE_EXCEEDED',
      detail: 'BOB allows 2 decimals; got 3',
      instance: '/api/v1/x',
      requestId: 'req-1',
      errors: [
        {
          pointer: '/splits/0/amount',
          code: 'AMOUNT_SCALE_EXCEEDED',
          detail: 'BOB allows 2 decimals; got 3',
        },
      ],
    });
    expect(
      contract.validateResponse('createTransaction', 422, response.body, 'application/problem+json'),
    ).toEqual([]);
  });

  it('[TC-PLATFORM-API-004] un error inesperado es 500 INTERNAL_ERROR sin stack, SQL ni tablas', () => {
    const err = new Error('relation "iam.workspace" does not exist: SELECT * FROM iam.workspace');
    const { response, unexpected } = renderProblem(err, { requestId: 'req-2' });
    expect(unexpected).toBe(true);
    expect(response.status).toBe(500);
    const raw = JSON.stringify(response.body);
    expect(raw).not.toMatch(/SELECT|iam\.workspace|at .*\.ts|stack/);
    expect((response.body as { code: string }).code).toBe('INTERNAL_ERROR');
    // Un DomainError con un código fuera del catálogo es un bug: también 500.
    expect(renderProblem(new DomainError('NOT_IN_CATALOG', 'x'), { requestId: 'r' }).response.status).toBe(
      500,
    );
  });

  it('[TC-PLATFORM-API-004] una dependencia caída es 503 SERVICE_UNAVAILABLE con Retry-After', () => {
    for (const err of [
      Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('x'), { code: '57P01' }),
      new Error('timeout exceeded when trying to connect'),
      new Error('wrapped', { cause: Object.assign(new Error('x'), { code: '08006' }) }),
      new DependencyUnavailableError('postgres', { retryAfterSeconds: 5 }),
    ]) {
      expect(isDependencyUnavailable(err)).toBe(true);
      const { response } = renderProblem(err, { requestId: 'r' });
      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toMatch(/^\d+$/);
    }
    expect(isDependencyUnavailable(Object.assign(new Error('x'), { code: '23505' }))).toBe(false);
    expect(isDependencyUnavailable(null)).toBe(false);
  });

  it('[TC-PLATFORM-API-014] 412 incluye currentVersion y 409 CONCURRENCY_CONFLICT es estable', () => {
    const r412 = renderProblem(preconditionFailed(5), { requestId: 'r' }).response;
    expect(r412.status).toBe(412);
    expect(r412.body).toMatchObject({ code: 'PRECONDITION_FAILED', currentVersion: 5 });
    const r409 = renderProblem(concurrencyConflict(), { requestId: 'r' }).response;
    expect(r409.body).toMatchObject({ status: 409, code: 'CONCURRENCY_CONFLICT' });
    expect(new ApiProblem('RATE_LIMITED').message).toBe('Rate limit exceeded');
  });
});
