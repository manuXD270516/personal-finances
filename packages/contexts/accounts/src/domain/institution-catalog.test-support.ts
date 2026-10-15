import type { ProviderTermsLookup } from './institution-catalog.js';

/**
 * Constructores de catálogos FICTICIOS para las pruebas (add-exchange-house-rate-providers): nombres inventados
 * ("Banco Andino Demo"…), nunca entidades reales. Devuelven JSON crudo (`unknown`) como llegaría de un archivo, para
 * ejercitar la validación estructural.
 */

type Json = Record<string, unknown>;

export const DEMO_EVALUATED_ON = '2026-10-15';

export const status = (value: string, extra: Json = {}): Json => ({
  status: value,
  evaluatedOn: DEMO_EVALUATED_ON,
  ...extra,
});

export function demoEntry(code: string, overrides: Json = {}): Json {
  return {
    code,
    name: `Entidad ${code} Demo`,
    legalName: `Entidad ${code} Demo S.A. (ficticia)`,
    category: 'MULTIPLE_BANK',
    kind: 'BANK',
    website: null,
    listing: { status: 'ACTIVE', since: null },
    verification: { status: 'CONFIRMED', note: null },
    support: {
      rates: status('IN_VERIFICATION'),
      statementImport: status('PENDING_SAMPLE'),
    },
    ...overrides,
  };
}

export function demoCatalog(
  entries: readonly Json[],
  census: readonly { category: string; count: number }[],
  overrides: Json = {},
): Json {
  return {
    fictitious: true,
    country: 'BO',
    catalogVersion: '2026-09-30',
    source: {
      name: 'Registro Demo (ficticio)',
      url: 'https://example.invalid/registro-demo',
      cutoffDate: '2026-09-30',
      retrievedOn: '2026-10-15',
    },
    census: census.map((c) => ({ ...c, source: 'Registro Demo' })),
    entries: [...entries],
    ...overrides,
  };
}

/** El catálogo de tres entradas de los scenarios (BAD banco múltiple, CID cooperativa, BAL billetera). */
export function threeEntryCatalog(overrides: Json = {}): Json {
  return demoCatalog(
    [
      demoEntry('BAD', { name: 'Banco Andino Demo' }),
      demoEntry('CID', {
        name: 'Cooperativa Illimani Demo',
        category: 'SAVINGS_COOP',
        support: {
          rates: status('NOT_ELIGIBLE', { reason: 'NO_PUBLICATION' }),
          statementImport: status('PENDING_SAMPLE'),
        },
      }),
      demoEntry('BAL', {
        name: 'Billetera Altiplano Demo',
        category: 'MOBILE_PAYMENT',
        kind: 'WALLET_PROVIDER',
        support: {
          rates: status('NOT_APPLICABLE'),
          statementImport: status('GENERIC_ONLY'),
        },
      }),
    ],
    [
      { category: 'MULTIPLE_BANK', count: 1 },
      { category: 'SAVINGS_COOP', count: 1 },
      { category: 'MOBILE_PAYMENT', count: 1 },
    ],
    overrides,
  );
}

/** Proveedores ficticios: `INSTRATE_VERIFIED` (términos verificados) y `INSTRATE_UNVERIFIED`/`INSTRATE_REJECTED`. */
export const demoTerms: ProviderTermsLookup = (id) =>
  id === 'INSTRATE_VERIFIED' || id === 'INSTRATE_DEMO'
    ? 'VERIFIED'
    : id === 'INSTRATE_REJECTED'
      ? 'REJECTED'
      : id === 'INSTRATE_UNVERIFIED'
        ? 'UNVERIFIED'
        : null;
