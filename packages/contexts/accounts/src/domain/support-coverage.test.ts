import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_CATEGORIES,
  PENDING_STATUSES,
  RESOLVED_STATUSES,
  STATUSES_OF_DIMENSION,
  validateCatalog,
  type InstitutionCatalog,
  type SupportStatus,
} from './institution-catalog.js';
import { demoCatalog, demoEntry, demoTerms, status } from './institution-catalog.test-support.js';
import { computeSupportCoverage, percentHalfEven } from './support-coverage.js';

function catalogOf(
  rows: readonly {
    code: string;
    rates: string;
    reason?: string;
    statementImport?: string;
    listing?: 'ACTIVE' | 'DELISTED';
  }[],
  censusCount = rows.filter((r) => (r.listing ?? 'ACTIVE') === 'ACTIVE').length,
): InstitutionCatalog {
  const entries = rows.map((r) =>
    demoEntry(r.code, {
      listing:
        r.listing === 'DELISTED'
          ? { status: 'DELISTED', since: '2026-06-30' }
          : { status: 'ACTIVE', since: null },
      support: {
        rates: status(r.rates, {
          ...(r.rates === 'NOT_ELIGIBLE' ? { reason: r.reason ?? 'NO_PUBLICATION' } : {}),
          ...(r.rates === 'SUPPORTED' ? { providerIds: ['INSTRATE_VERIFIED'] } : {}),
        }),
        statementImport: status(r.statementImport ?? 'GENERIC_ONLY', {
          ...(r.statementImport === 'NOT_ELIGIBLE' ? { reason: 'IMAGE_ONLY_STATEMENT' } : {}),
        }),
      },
    }),
  );
  const result = validateCatalog(demoCatalog(entries, [{ category: 'MULTIPLE_BANK', count: censusCount }]), {
    terms: demoTerms,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.catalog;
}

describe('SupportCoverage (accounts/institutions: medición del soporte completo)', () => {
  it('[TC-ACCOUNTS-INSTCATALOG-007] soporte incompleto: tasas con 2 resueltas y 1 pendiente = 66.67 % y 1 NOT_ELIGIBLE aparte con su razón', () => {
    const catalog = catalogOf([
      { code: 'BAD', rates: 'IN_VERIFICATION' },
      { code: 'CID', rates: 'NOT_ELIGIBLE', reason: 'NO_PUBLICATION' },
      { code: 'BAL', rates: 'NOT_APPLICABLE' },
    ]);
    const c = computeSupportCoverage(catalog);
    expect(c.byCategory).toEqual([
      { category: 'MULTIPLE_BANK', census: 3, entries: 3, censusCoveragePct: '100.00' },
    ]);
    const rates = c.byDimension.find((d) => d.dimension === 'rates');
    expect(rates).toMatchObject({ resolved: 2, pending: 1, resolvedPct: '66.67' });
    expect(rates?.notEligible).toEqual([{ reason: 'NO_PUBLICATION', count: 1 }]);
    expect(c.censusCoveragePct).toBe('100.00');
    expect(c.complete).toBe(false);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-007] el desglose por estado y razón cuenta cada combinación', () => {
    const catalog = catalogOf([
      { code: 'AAA', rates: 'NOT_ELIGIBLE', reason: 'NO_PUBLICATION' },
      { code: 'BBB', rates: 'NOT_ELIGIBLE', reason: 'NO_PUBLICATION' },
      { code: 'CCC', rates: 'NOT_ELIGIBLE', reason: 'TERMS_PROHIBIT_AUTOMATION' },
      { code: 'DDD', rates: 'SUPPORTED' },
    ]);
    const rates = computeSupportCoverage(catalog).byDimension.find((d) => d.dimension === 'rates');
    expect(rates?.byStatus).toEqual(
      expect.arrayContaining([
        { status: 'NOT_ELIGIBLE', reason: 'NO_PUBLICATION', count: 2 },
        { status: 'NOT_ELIGIBLE', reason: 'TERMS_PROHIBIT_AUTOMATION', count: 1 },
        { status: 'SUPPORTED', reason: null, count: 1 },
      ]),
    );
    expect(rates?.notEligible).toEqual([
      { reason: 'NO_PUBLICATION', count: 2 },
      { reason: 'TERMS_PROHIBIT_AUTOMATION', count: 1 },
    ]);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-007] soporte completo: censo 100 % y ninguna entrada activa pendiente en ninguna dimensión', () => {
    const catalog = catalogOf([
      { code: 'BAD', rates: 'SUPPORTED' },
      { code: 'CID', rates: 'NOT_ELIGIBLE', reason: 'NO_PUBLICATION', statementImport: 'PENDING_SAMPLE' },
      { code: 'BAL', rates: 'NOT_APPLICABLE' },
    ]);
    // Con una importación pendiente no es completo; resolviéndola sí.
    expect(computeSupportCoverage(catalog).complete).toBe(false);
    const done = catalogOf([
      { code: 'BAD', rates: 'SUPPORTED' },
      { code: 'CID', rates: 'NOT_ELIGIBLE', reason: 'NO_PUBLICATION' },
      { code: 'BAL', rates: 'NOT_APPLICABLE' },
    ]);
    const c = computeSupportCoverage(done);
    expect(c.complete).toBe(true);
    expect(c.byDimension.every((d) => d.pending === 0 && d.resolvedPct === '100.00')).toBe(true);
  });

  it('[TC-ACCOUNTS-INSTCATALOG-008] las entradas retiradas (DELISTED) no cuentan como pendientes', () => {
    const catalog = catalogOf(
      [
        { code: 'BAD', rates: 'SUPPORTED' },
        { code: 'BAL', rates: 'NOT_APPLICABLE' },
        { code: 'CID', rates: 'IN_VERIFICATION', listing: 'DELISTED' },
      ],
      2,
    );
    const c = computeSupportCoverage(catalog);
    expect(c.complete).toBe(true);
    const rates = c.byDimension.find((d) => d.dimension === 'rates');
    expect(rates).toMatchObject({ resolved: 2, pending: 0, resolvedPct: '100.00' });
    expect(rates?.byStatus.some((s) => s.status === 'IN_VERIFICATION')).toBe(false);
  });

  it('cobertura del censo parcial y catálogo vacío: porcentajes HALF_EVEN a 2 decimales', () => {
    // Censo de 3 con 2 entradas = 66.67 %; no es válido para publicar, pero la medición lo informa.
    const partial = computeSupportCoverage({
      ...catalogOf([
        { code: 'AAA', rates: 'SUPPORTED' },
        { code: 'BBB', rates: 'SUPPORTED' },
      ]),
      census: [{ category: 'MULTIPLE_BANK', count: 3, source: null }],
    });
    expect(partial.byCategory[0]).toMatchObject({ census: 3, entries: 2, censusCoveragePct: '66.67' });
    expect(partial.censusCoveragePct).toBe('66.67');
    expect(partial.complete).toBe(false);
    // Un censo declarado sin entradas = 0.00 %; sin censo ni entradas = 100.00 % (nada que cubrir).
    const emptyCatalog = { ...catalogOf([{ code: 'AAA', rates: 'SUPPORTED' }]), entries: [] };
    const empty = computeSupportCoverage(emptyCatalog);
    expect(empty.byCategory[0]).toMatchObject({ censusCoveragePct: '0.00' });
    const none = computeSupportCoverage({ ...emptyCatalog, census: [] });
    expect(none.censusCoveragePct).toBe('100.00');
    expect(none.byDimension.every((d) => d.resolvedPct === '100.00')).toBe(true);
  });

  it('percentHalfEven redondea al par en los empates y solo con aritmética exacta', () => {
    expect(percentHalfEven(2, 3)).toBe('66.67');
    expect(percentHalfEven(1, 3)).toBe('33.33');
    expect(percentHalfEven(0, 5)).toBe('0.00');
    expect(percentHalfEven(5, 5)).toBe('100.00');
    // 1/8 = 12.5 % exacto; 1/16 = 6.25 % exacto; 1/32 = 3.125 % → empate en el tercer decimal: al par (3.12).
    expect(percentHalfEven(1, 8)).toBe('12.50');
    expect(percentHalfEven(1, 32)).toBe('3.12');
    // 3/32 = 9.375 % → al par (9.38).
    expect(percentHalfEven(3, 32)).toBe('9.38');
    expect(percentHalfEven(0, 0)).toBe('100.00');
  });

  it('[TC-ACCOUNTS-INSTCATALOG-007] PBT: resolved + pending = entradas activas y el porcentaje es HALF_EVEN a 2 decimales', () => {
    const ratesArb = fc.constantFrom(...STATUSES_OF_DIMENSION.rates);
    const importArb = fc.constantFrom(...STATUSES_OF_DIMENSION.statementImport);
    const listingArb = fc.constantFrom<'ACTIVE' | 'DELISTED'>('ACTIVE', 'ACTIVE', 'DELISTED');
    fc.assert(
      fc.property(
        fc.array(fc.record({ rates: ratesArb, imp: importArb, listing: listingArb }), {
          minLength: 0,
          maxLength: 60,
        }),
        (rows) => {
          const catalog = catalogOf(
            rows.map((r, i) => ({
              code: `E${String(i).padStart(3, '0')}`,
              rates: r.rates,
              statementImport: r.imp,
              listing: r.listing,
            })),
          );
          const active = rows.filter((r) => r.listing === 'ACTIVE');
          const c = computeSupportCoverage(catalog);
          for (const d of c.byDimension) {
            expect(d.resolved + d.pending).toBe(active.length);
            const expectResolved = active.filter((r) => {
              const s: SupportStatus = d.dimension === 'rates' ? r.rates : r.imp;
              return RESOLVED_STATUSES.includes(s);
            }).length;
            expect(d.resolved).toBe(expectResolved);
            expect(d.resolvedPct).toBe(percentHalfEven(d.resolved, active.length));
            expect(d.resolvedPct).toMatch(/^\d{1,3}\.\d{2}$/);
            expect(d.byStatus.reduce((acc, s) => acc + s.count, 0)).toBe(active.length);
          }
          const pendingAny = c.byDimension.some((d) => d.pending > 0);
          expect(c.complete).toBe(!pendingAny && c.censusCoveragePct === '100.00');
        },
      ),
      { numRuns: 100 },
    );
  }, 30_000);

  it('los estados pendientes y resueltos son una partición de los estados', () => {
    expect([...RESOLVED_STATUSES, ...PENDING_STATUSES].sort()).toEqual(
      [
        'GENERIC_ONLY',
        'IN_VERIFICATION',
        'NOT_APPLICABLE',
        'NOT_ELIGIBLE',
        'PENDING_SAMPLE',
        'SUPPORTED',
      ].sort(),
    );
    expect(CATALOG_CATEGORIES).toHaveLength(10);
  });
});
