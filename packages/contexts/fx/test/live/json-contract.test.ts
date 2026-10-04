import { describe, expect, it } from 'vitest';
import { fixture } from '../../src/infrastructure/providers/fixture-server.test-support.js';
import { DOLARAPI_DOLARES_CONTRACT } from '../../src/infrastructure/providers/dolarapi-bo.provider.js';
import {
  PARALELO_HISTORY_CONTRACT,
  PARALELO_RATE_CONTRACT,
} from '../../src/infrastructure/providers/paralelo-bo.provider.js';
import { validateContract } from './json-contract.js';

// El validador del smoke en vivo (`pnpm fx:smoke-live`) acepta las respuestas grabadas y detecta un cambio de schema.
const json = (name: string): unknown => JSON.parse(fixture(name));

describe('validador de consumer contracts del smoke en vivo', () => {
  it('las respuestas grabadas cumplen el contrato del adapter', () => {
    expect(validateContract(PARALELO_RATE_CONTRACT, json('paralelo-bo/rate.ok.json'))).toEqual([]);
    expect(
      validateContract(PARALELO_RATE_CONTRACT, json('paralelo-bo/rate.recorded-2026-10-03.json')),
    ).toEqual([]);
    expect(validateContract(PARALELO_HISTORY_CONTRACT, json('paralelo-bo/historical.sample.json'))).toEqual(
      [],
    );
    expect(validateContract(DOLARAPI_DOLARES_CONTRACT, json('dolarapi-bo/dolares.ok.json'))).toEqual([]);
  });

  it('detecta un cambio de schema, tipos inesperados, constantes y fechas inválidas', () => {
    expect(validateContract(PARALELO_RATE_CONTRACT, json('paralelo-bo/rate.schema-changed.json'))).toEqual([
      "$: falta 'median'",
    ]);
    expect(validateContract(DOLARAPI_DOLARES_CONTRACT, { casa: 'oficial' })).toEqual([
      '$: se esperaba array, llegó object',
    ]);
    expect(
      validateContract(PARALELO_HISTORY_CONTRACT, { currencyPair: 'USD/ARS', points: [{ t: 'x' }] }),
    ).toEqual(['$.currencyPair: se esperaba "USD/BOB", llegó "USD/ARS"', "$.points[0]: falta 'v'"]);
    expect(validateContract(PARALELO_RATE_CONTRACT, { timestamp: 'ayer', median: '12.02' })).toEqual([
      '$.timestamp: no es una fecha-hora válida',
      '$.median: se esperaba number | null, llegó string',
    ]);
  });
});
